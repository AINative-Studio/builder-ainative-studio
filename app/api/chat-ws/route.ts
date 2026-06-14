import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { nanoid } from 'nanoid'
import { verifyAndEnhancePrompt } from '@/lib/component-verifier'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'
import { enhancePromptWithMockData } from '@/lib/mock-data-generator'
import { updatePreviewPartial, storePreview, getChatData } from '@/lib/preview-store'
import { validateGeneratedCode } from '@/lib/code-validator'
import { stripGradients } from '@/lib/gradient-blocker'
import { fetchContextualImages, formatImagesForPrompt, getFallbackImages } from '@/lib/services/unsplash.service'
import { extractComponentCode } from '@/lib/agent/component-generation-tool'
import { addComponentToMemory, formatMemoryForPrompt } from '@/lib/services/memory.service'
import { runOrchestratorAgent } from '@/lib/agent/subagents'
import { parsePRDForBuildSteps } from '@/lib/prd-parser'
import { analyzeComplexity, getComplexityReport } from '@/lib/agent/complexity-analyzer'
import { createChunkPlan, getChunkPlanSummary } from '@/lib/agent/chunk-planner'
import { executeChunkPlan, getGenerationSummary } from '@/lib/agent/multi-pass-generator'
import { mergeChunks, getMergeSummary } from '@/lib/agent/chunk-merger'
import { generateAINativeFileSet } from '@/lib/ainative-file-generator'
import { selectTheme, formatThemeForPrompt, applyThemeToPrompt } from '@/lib/theme-system'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'
import { storeFiles as storeFilesV2 } from '@/lib/preview-store-v2'
import { logModelConfiguration } from '@/lib/config/model-validator'

// Log model configuration on first module load
logModelConfiguration()

// Use Meta API ONLY when explicitly enabled via USE_META_API=true
// Default to AINative API which is more reliable
const isLocal = process.env.USE_META_API === 'true'

// Meta Llama API client (for local development / benchmarking)
const metaClient = new OpenAI({
  apiKey: process.env.META_API_KEY || '',
  baseURL: process.env.META_BASE_URL || 'https://api.llama.com/compat/v1',
})

// AINative API client
// Use AINATIVE_API_URL to override (e.g. for direct core access)
const ainativeBaseURL = (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1'
const ainativeClient = new OpenAI({
  apiKey: process.env.AINATIVE_API_KEY || process.env.API_Key || process.env.ZERODB_API_KEY || '',
  baseURL: ainativeBaseURL,
})

// Get the appropriate client based on environment
function getLLMClient(): OpenAI {
  return isLocal ? metaClient : ainativeClient
}

// Model strategy (benchmarked 2026-06-13):
// FREE: nous-coder (16s, 9K chars, best theme compliance)
// PAID: kimi-k2.6 (71s, 23K chars, best quality — via DigitalOcean)
// ministral-14b: 933+ tokens complete output, no 512-cap
// llama-4-maverick capped at 512 tokens by AINative proxy — UNUSABLE
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'ministral-14b'
const PAID_MODEL = process.env.PAID_MODEL || 'kimi-k2.6'

// Fallback chains by tier
// NEVER use llama-4-maverick — AINative caps it at 512 tokens (ALWAYS truncated)
const FREE_FALLBACKS = ['ministral-14b', 'nous-coder', 'gpt-oss-20b']
const PAID_FALLBACKS = ['kimi-k2.6', 'nous-coder', 'nemotron-70b', 'ministral-14b']

// Model routing config — all models route through AINative API
const MODEL_CONFIG: Record<string, { provider: 'meta' | 'ainative'; modelId: string; tier: 'free' | 'paid' }> = {
  // === PAID TIER — best quality, longer output ===
  'kimi-k2.6': { provider: 'ainative', modelId: 'kimi-k2.6', tier: 'paid' },
  'kimi-k2': { provider: 'ainative', modelId: 'kimi-k2', tier: 'paid' },
  'nemotron-70b': { provider: 'ainative', modelId: 'nemotron-70b', tier: 'paid' },
  // === FREE TIER — fast, reliable ===
  'nous-coder': { provider: 'ainative', modelId: 'nous-coder', tier: 'free' },
  'gpt-oss-20b': { provider: 'ainative', modelId: 'gpt-oss-20b', tier: 'free' },
  'ministral-14b': { provider: 'ainative', modelId: 'ministral-14b', tier: 'free' },
  'llama-4-maverick': { provider: isLocal ? 'meta' : 'ainative', modelId: 'llama-4-maverick', tier: 'free' },
  'nemotron-super-49b': { provider: 'ainative', modelId: 'nemotron-super-49b', tier: 'free' },
  'cohere-command': { provider: 'ainative', modelId: 'cohere-command', tier: 'free' },
  // === INTERMITTENT — may come back online ===
  'codestral-22b': { provider: 'ainative', modelId: 'codestral-22b', tier: 'free' },
  'devstral': { provider: 'ainative', modelId: 'devstral', tier: 'free' },
  'deepseek-v3': { provider: 'ainative', modelId: 'deepseek-v3', tier: 'free' },
  'qwen3-32b': { provider: 'ainative', modelId: 'qwen3-32b', tier: 'free' },
}

export async function POST(request: NextRequest) {
  try {
    const { message, chatId, model: requestedModel } = await request.json()

    if (!message) {
      return Response.json({ error: 'Message is required' }, { status: 400 })
    }

    // Get previous messages if this is a continuation
    let previousMessages: Array<{ role: 'user' | 'assistant', content: string }> = []
    if (chatId) {
      const chatData = getChatData(chatId)
      if (chatData && chatData.messages) {
        previousMessages = chatData.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      }
    }

    const responseId = chatId || nanoid()

    // Create streaming response with REAL progress updates
    console.log('Starting LLAMA WebSocket-style streaming...')

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        // Helper to safely enqueue data (prevents "Controller is already closed" errors)
        const safeEnqueue = (data: Uint8Array) => {
          try {
            controller.enqueue(data)
          } catch (error) {
            // Silently ignore controller closed errors (client disconnected)
          }
        }

        // Send SSE keepalive every 15s to prevent Railway/HTTP2 from closing the stream
        // during long AI generation (can take 60-120s for complex apps)
        let keepaliveActive = true
        const keepaliveInterval = setInterval(() => {
          if (!keepaliveActive) return
          try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch (_) { /* closed */ }
        }, 15_000)

        try {
          let fullContent = ''
          let lastUpdateTime = Date.now()
          const generationStartTime = Date.now()
          let tokenUsage: any = undefined

          // Send initial metadata
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'init',
            chatId: responseId,
            demo: `/preview/${responseId}`
          })}\n\n`))

          // Parse user message to generate dynamic build steps
          const prdAnalysis = parsePRDForBuildSteps(message)
          console.log('📋 PRD Analysis:', {
            pages: prdAnalysis.pages,
            components: prdAnalysis.components,
            features: prdAnalysis.features,
            buildSteps: prdAnalysis.buildSteps
          })

          // Analyze complexity to determine if chunking is needed
          const complexityScore = analyzeComplexity(prdAnalysis, message)
          console.log('\n' + getComplexityReport(complexityScore))

          // Send dynamic build steps to client
          for (const step of prdAnalysis.buildSteps) {
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'build_step',
              step
            })}\n\n`))
            // Small delay to make steps visible (200ms between steps)
            await new Promise(resolve => setTimeout(resolve, 200))
          }

          const { enhancedPrompt: componentVerifiedPrompt } = verifyAndEnhancePrompt(message)

          // REAL STEP 2: Enhance with mock data (only for new chats)
          const shouldEnhance = previousMessages.length === 0
          let enhancedPrompt = componentVerifiedPrompt

          if (shouldEnhance) {
            enhancedPrompt = enhancePromptWithMockData(componentVerifiedPrompt)
          }

          // Skip Unsplash images — adds latency and open-source models ignore URLs
          // Use CSS gradients + blur glows instead (already in the theme prompt)
          const imagePrompt = ''

          // Build conversation messages
          const conversationMessages = [
            ...previousMessages,
            { role: 'user' as const, content: enhancedPrompt }
          ]

          // Select a color theme based on the prompt (variety instead of same purple every time)
          const selectedTheme = selectTheme(message)
          const themePrompt = formatThemeForPrompt(selectedTheme)
          console.log(`🎨 Theme selected: ${selectedTheme.name} (${selectedTheme.primary})`)

          // Build enhanced system prompt with theme + images + memory context
          // applyThemeToPrompt replaces THEME_PRIMARY/SECONDARY/ACCENT/DARK placeholders
          // so all code examples in the prompt use the actual selected theme colors
          const memoryContext = formatMemoryForPrompt(responseId)
          const themedPrompt = applyThemeToPrompt(PROFESSIONAL_SYSTEM_PROMPT, selectedTheme)
          const enhancedSystemPrompt = themedPrompt + themePrompt + imagePrompt + memoryContext

          // CHUNKING SYSTEM: Route to multi-pass generation if complexity requires it
          if (complexityScore.requiresChunking && previousMessages.length === 0) {
            console.log('\n🔄 COMPLEX APPLICATION DETECTED - Using multi-pass chunking strategy')
            console.log(`   Strategy: ${complexityScore.chunkingStrategy}`)
            console.log(`   Estimated tokens: ${complexityScore.estimatedTokens.toLocaleString()}`)

            // Create chunk plan
            const chunkPlan = createChunkPlan(message, prdAnalysis, complexityScore)
            console.log('\n' + getChunkPlanSummary(chunkPlan))

            // Execute chunk plan with progress streaming
            const chunks = await executeChunkPlan(
              chunkPlan,
              getLLMClient(),
              DEFAULT_MODEL,
              (phase, totalPhases, message, data) => {
                // Stream chunk progress to client
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'chunk_progress',
                  phase,
                  totalPhases,
                  message,
                  ...data
                })}\n\n`))

                console.log(`   [Phase ${phase}/${totalPhases}] ${message}`)
              }
            )

            // Log generation summary
            console.log('\n' + getGenerationSummary(chunks))

            // Merge all chunks into final application
            console.log('\n🔀 Merging chunks...')
            fullContent = mergeChunks(chunks)

            // Log merge summary
            console.log('\n' + getMergeSummary(chunks, fullContent))

            // Update preview with merged code
            updatePreviewPartial(responseId, fullContent)

            // Calculate total token usage from all chunks
            tokenUsage = {
              input_tokens: chunks.reduce((sum, c) => sum + c.tokenUsage.input, 0),
              output_tokens: chunks.reduce((sum, c) => sum + c.tokenUsage.output, 0),
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              total_tokens: chunks.reduce((sum, c) => sum + c.tokenUsage.total, 0),
              estimated_cost: 0 // Will be calculated below
            }

            tokenUsage.estimated_cost = (tokenUsage.input_tokens * 0.003 + tokenUsage.output_tokens * 0.015) / 1000

            console.log(`\n📊 TOTAL TOKEN USAGE (Multi-Pass):`)
            console.log(`   Input tokens: ${tokenUsage.input_tokens}`)
            console.log(`   Output tokens: ${tokenUsage.output_tokens}`)
            console.log(`   Total tokens: ${tokenUsage.total_tokens}`)
            console.log(`   Estimated cost: $${tokenUsage.estimated_cost.toFixed(4)}`)

          } else {
            // Use single-pass generation for simple applications or continuations
            console.log('\n✅ Simple application - Using single-pass generation')

            // Check if subagents mode is enabled
            const useSubagents = process.env.USE_SUBAGENTS === 'true'

          if (useSubagents) {
            // Use Subagents orchestrator for complex multi-step generation
            const orchestratorResult = await runOrchestratorAgent(
              enhancedPrompt,
              enhancedSystemPrompt,
              memoryContext
            )

            if (orchestratorResult.success) {
              fullContent = orchestratorResult.componentCode

              // Update preview store (but don't send code to chat client)
              updatePreviewPartial(responseId, fullContent)
            } else {
              throw new Error('Subagent orchestration failed')
            }
          } else {
            // Route to correct provider based on selected model
            const modelConfig = MODEL_CONFIG[requestedModel] || { provider: 'ainative', modelId: DEFAULT_MODEL }
            const provider = modelConfig.provider
            const modelId = modelConfig.modelId
            const client = provider === 'meta' ? metaClient : ainativeClient
            console.log(`🤖 Using model: ${modelId} (provider: ${provider}, env: ${isLocal ? 'local' : 'cloud'})`)

            // ============ ALL MODELS VIA OPENAI-COMPATIBLE API (Meta or AINative) ============
            // Compact system prompt focused on design quality + theme colors.
            // Open-source models (codestral, devstral, etc.) ignore long prompts.
            // Theme colors are injected directly into examples so the model copies them.
            const llmSystemPrompt = `Generate a React component. Follow this EXACT structure:

\`\`\`jsx
import React, { useState } from 'react'
import { Icon1, Icon2 } from 'lucide-react'

const items = [{id:1, name:"X", value:0}, {id:2, name:"Y", value:0}]

export default function App() {
  const [data] = useState(items)
  return (
    <div className="min-h-screen bg-[${selectedTheme.light}]">
      <header className="bg-[${selectedTheme.dark}] text-white p-4">
        <h1 className="text-xl font-bold">App Title</h1>
      </header>
      <main className="max-w-5xl mx-auto p-6">
        <div className="grid grid-cols-3 gap-4">
          {data.map(item => (
            <div key={item.id} className="bg-white rounded-xl shadow-sm p-4">
              <h3 className="font-semibold">{item.name}</h3>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
\`\`\`

RULES:
- MAXIMUM 60 LINES. Shorter is better. NEVER exceed 60 lines.
- The return() with JSX must come EARLY. Do NOT write long data arrays first.
- Keep data arrays SHORT (3-5 items, 1 line each).
- Use .map() for ALL repeated elements.
- Colors: bg-[${selectedTheme.primary}] bg-[${selectedTheme.dark}] bg-[${selectedTheme.light}]
- NEVER use bg-blue, bg-gray, bg-purple. Only hex colors above.
- Every <div> must have </div>. Every <section> must have </section>.`

            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'build_step', step: 'Generating with ' + modelId + '...' })}\n\n`))

            // Use non-streaming for AINative (streaming returns empty), streaming for Meta
            if (provider === 'meta') {
              try {
                const stream = await client.chat.completions.create({
                  model: modelId,
                  messages: [
                    { role: 'system', content: llmSystemPrompt },
                    ...conversationMessages,
                  ],
                  max_tokens: 16000,
                  temperature: 0.7,
                  stream: true,
                })

                for await (const chunk of stream) {
                  const content = chunk.choices?.[0]?.delta?.content || ''
                  if (content) {
                    fullContent += content
                    updatePreviewPartial(responseId, fullContent)
                    const now = Date.now()
                    if (now - lastUpdateTime > 500) {
                      safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
                      lastUpdateTime = now
                    }
                  }
                }
              } catch (streamError: any) {
                // Meta streaming failed — fall back to AINative non-streaming
                console.log(`⚠️ Meta streaming failed (${streamError?.message}), falling back to AINative`)
                const fallbackResponse = await ainativeClient.chat.completions.create({
                  model: modelId,
                  max_tokens: 16000,
                  temperature: 0.7,
                  messages: [
                    { role: 'system', content: llmSystemPrompt },
                    ...conversationMessages,
                  ],
                })
                fullContent = fallbackResponse.choices?.[0]?.message?.content || ''
              }
            } else {
              // AINative: single-turn generation (system+user only)
              // Multi-turn conversations get capped at 512 tokens by the API
              // Single-turn with system message gets full output (~1500-2500 tokens)
              console.log(`📡 Calling AINative API (single-turn): ${modelId}`)

              // Single-turn call with fallback chain
              // CRITICAL: Only system+user messages (2 messages). Multi-turn (>2) triggers 512-token cap.
              // Use tier-appropriate fallback chain
              const modelTier = MODEL_CONFIG[requestedModel]?.tier || 'free'
              const MODELS_TO_TRY = modelTier === 'paid'
                ? [modelId, ...PAID_FALLBACKS.filter(m => m !== modelId)]
                : [modelId, ...FREE_FALLBACKS.filter(m => m !== modelId)]
              const singleTurnMessages = [
                { role: 'system' as const, content: llmSystemPrompt },
                // Merge conversation history into a single user message to keep it 2-message single-turn
                { role: 'user' as const, content: previousMessages.length > 0
                  ? `Previous context:\n${previousMessages.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nNew request: ${enhancedPrompt}`
                  : enhancedPrompt
                },
              ]

              for (const tryModel of MODELS_TO_TRY) {
                try {
                  const ctrl = new AbortController()
                  const timer = setTimeout(() => ctrl.abort(), 60_000)
                  const response = await client.chat.completions.create(
                    { model: tryModel, max_tokens: 4096, temperature: 0.7, messages: singleTurnMessages },
                    { signal: ctrl.signal }
                  )
                  clearTimeout(timer)

                  fullContent = response.choices?.[0]?.message?.content || ''
                  const tokens = response.usage?.completion_tokens || 0
                  const finish = response.choices?.[0]?.finish_reason
                  console.log(`📊 ${tryModel}: ${fullContent.length} chars (${tokens} tok) finish=${finish}`)

                  // Handle truncation: if finish_reason=length, close the component
                  if (finish === 'length' && fullContent.length > 500) {
                    console.log('⚠️ Output truncated — applying closure fix')
                    // Find the last complete JSX line and close from there
                    const lines = fullContent.split('\n')
                    let cutPoint = lines.length
                    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
                      const line = lines[i].trim()
                      if (line.endsWith('>') || line.endsWith('/>') || line.endsWith('}') || line.endsWith(');')) {
                        cutPoint = i + 1
                        break
                      }
                    }
                    fullContent = lines.slice(0, cutPoint).join('\n')
                    // Count unclosed braces/parens and close them
                    const ob = (fullContent.match(/\{/g) || []).length
                    const cb = (fullContent.match(/\}/g) || []).length
                    const op = (fullContent.match(/\(/g) || []).length
                    const cp = (fullContent.match(/\)/g) || []).length
                    let closure = '\n'
                    for (let i = 0; i < op - cp; i++) closure += ')'
                    if (op > cp) closure += ';\n'
                    for (let i = 0; i < ob - cb; i++) closure += '}\n'
                    // Ensure there's a default export
                    if (!fullContent.includes('export default')) {
                      const funcMatch = fullContent.match(/(?:function|const)\s+([A-Z]\w+)/)
                      if (funcMatch) closure += `\nexport default ${funcMatch[1]};\n`
                    }
                    fullContent += closure
                    console.log(`📊 Truncation fixed: added ${ob-cb} braces, ${op-cp} parens`)
                  }

                  updatePreviewPartial(responseId, fullContent)
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))

                  if (fullContent.length > 500) break // Good enough output
                  console.log(`⚠️ Output too short (${fullContent.length} chars), trying next model...`)
                } catch (err: any) {
                  const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted')
                  console.log(`⚠️ ${tryModel} failed: ${isTimeout ? 'timeout' : err?.status || err?.message?.substring(0, 80)}`)
                  if (MODELS_TO_TRY.indexOf(tryModel) === MODELS_TO_TRY.length - 1) {
                    console.log('❌ All models failed')
                  }
                }
              }

              console.log(`📊 Final response: ${fullContent.length} chars`)
            }

            updatePreviewPartial(responseId, fullContent)
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))

            tokenUsage = {
              input_tokens: 0, output_tokens: 0,
              cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
              total_tokens: 0,
              estimated_cost: 0
            }

            console.log(`📊 ${modelId} generation complete: ${fullContent.length} chars`)

          } // End of provider routing + subagents else
          } // End of chunking else (single-pass)

          // NOTE: Gradient stripping removed — gradients add visual richness
          // (hero sections, backgrounds, accent elements) matching Bolt/Lovable quality

          // Validate generated code before storing
          let validation = validateGeneratedCode(fullContent)
          // CRITICAL: Use the VALIDATED/FIXED code, not the original raw content
          // validation.code has markdown extracted and auto-fixes applied
          let finalContent = validation.code
          let retryAttempted = false

          // AUTO-RETRY: If validation fails, automatically retry once with error feedback
          if (!validation.valid) {
            console.error('⚠️ Initial validation failed:', validation.error)
            console.log('🔄 Auto-retrying with error feedback...')

            try {
              // Build retry prompt with specific error details
              const retryPrompt = `The previous code generation had a syntax error that needs to be fixed:

ERROR: ${validation.error}

INVALID CODE:
${validation.code}

Please regenerate the component with these requirements:
1. Fix the syntax error: ${validation.error}
2. Avoid using invalid JavaScript identifiers (like 1px, 2em as variable names)
3. Ensure all JSX is valid and properly closed
4. Make sure the component function is properly defined and exported
5. Use only valid JavaScript/JSX syntax
6. Return ONLY the code wrapped in \`\`\`jsx and \`\`\` markers.

Generate a corrected version of: ${message}`

              // Try retry with fallback chain
              const retryModels = [DEFAULT_MODEL, 'gpt-oss-20b', 'ministral-14b']
              let retryContent = ''
              const retryMessages = [
                { role: 'system' as const, content: 'Fix the syntax errors in the code below. Return ONLY valid, complete React code wrapped in ```jsx markers. Ensure all JSX tags are properly closed, all strings are terminated, and all brackets match.' },
                ...previousMessages,
                { role: 'user' as const, content: enhancedPrompt },
                { role: 'assistant' as const, content: fullContent },
                { role: 'user' as const, content: retryPrompt }
              ]
              for (const retryModel of retryModels) {
                try {
                  const retryResponse = await ainativeClient.chat.completions.create({
                    model: retryModel,
                    max_tokens: 4096,
                    temperature: 0.7,
                    messages: retryMessages,
                  })
                  retryContent = retryResponse.choices?.[0]?.message?.content || ''
                  if (retryContent.length > 500) {
                    console.log(`✅ Retry succeeded with ${retryModel}: ${retryContent.length} chars`)
                    break
                  }
                } catch (retryErr: any) {
                  console.log(`⚠️ Retry with ${retryModel} failed: ${retryErr?.status || retryErr?.message?.substring(0, 50)}`)
                }
              }

              // Validate retry result
              const retryValidation = validateGeneratedCode(retryContent)

              if (retryValidation.valid) {
                console.log('✅ Auto-retry succeeded! Validation passed.')
                finalContent = retryContent
                validation = retryValidation
                retryAttempted = true

                // Update preview with fixed content
                updatePreviewPartial(responseId, finalContent)
              } else {
                console.error('❌ Auto-retry failed validation:', retryValidation.error)
              }
            } catch (retryError) {
              console.error('Auto-retry API call failed:', retryError)
            }
          }

          // Final validation check
          if (!validation.valid) {
            // Log validation error
            console.error('❌ Final validation failed (after retry):', validation.error)

            // Send validation error to client
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'validation_error',
              error: validation.error,
              message: retryAttempted
                ? 'The code generation failed validation even after auto-retry. Please try rephrasing your request.'
                : 'The generated code has syntax errors. Please try regenerating.'
            })}\n\n`))

            // Store the invalid code with error marker
            storePreview(responseId, finalContent, message, { validationError: validation.error, usage: tokenUsage })

            // Send completion with error flag
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              chatId: responseId,
              demo: `/preview/${responseId}`,
              hasValidationError: true
            })}\n\n`))
          } else {
            // Format assistant response for better conversation continuity
            // Store ONLY the code in a clean markdown wrapper (prevents PRD injection)
            // The user message is stored separately, we don't need to include it in the preview content
            const cleanCodeResponse = `\`\`\`jsx\n${finalContent}\n\`\`\``

            // Generate AINative file set (robots.txt, sitemap.xml, llms.txt, etc.)
            const ainativeFiles = generateAINativeFileSet(message, finalContent)
            console.log(`📁 Generated ${Object.keys(ainativeFiles).length} AINative files`)

            // Store clean code response + AINative files (legacy preview)
            storePreview(responseId, cleanCodeResponse, message, { usage: tokenUsage, ainativeFiles })

            // Parse into multi-file output for Sandpack
            const parsedFiles = parseMultiFileOutput(finalContent, message)
            console.log(`📦 Parsed ${Object.keys(parsedFiles).length} files for Sandpack:`, Object.keys(parsedFiles))

            // Store in V2 store
            storeFilesV2(responseId, parsedFiles, { usage: tokenUsage })

            // Send files to client for Sandpack preview
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'files',
              files: parsedFiles
            })}\n\n`))

            // Save to conversation memory for context
            addComponentToMemory(responseId, message, finalContent)

            // Send a clean conversational message to the chat (without code)
            // Make it context-aware based on what the user actually requested
            let itemType = 'component'
            let itemName = ''

            // Determine what was actually requested from PRD analysis
            if (prdAnalysis.pages.length > 0) {
              // Pages have {name, route} structure, extract just the names
              const pageNames = prdAnalysis.pages.map(p => p.name.replace(' Page', '').replace(' Interface', ''))
              itemType = prdAnalysis.pages.length > 1 ? 'pages' : 'page'
              itemName = pageNames.join(' and ')
            } else if (prdAnalysis.features.length > 0) {
              itemType = prdAnalysis.features.length > 1 ? 'features' : 'feature'
              itemName = prdAnalysis.features.join(' and ')
            } else if (prdAnalysis.components.length > 0) {
              itemType = prdAnalysis.components.length > 1 ? 'components' : 'component'
              itemName = prdAnalysis.components.map(c => c.replace(' Component', '')).join(' and ')
            }

            const conversationalMessage = previousMessages.length === 0
              ? (itemName
                  ? `I've created your ${itemName} and it's ready in the preview! Take a look at what I built for you.`
                  : `I've created your ${itemType} and it's ready in the preview! Take a look at what I built for you.`)
              : (itemName
                  ? `I've updated the ${itemName} based on your request. Check out the changes in the preview!`
                  : `I've updated the ${itemType} based on your request. Check out the changes in the preview!`)

            // Send the conversational message to display in chat
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'chunk',
              content: conversationalMessage
            })}\n\n`))

            // Send completion event
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              chatId: responseId,
              demo: `/preview/${responseId}`
            })}\n\n`))

            // Persist + RLHF logging + SSR build (fire-and-forget, non-blocking)
            try {
              const { saveGeneration, logGenerationEvent } = await import('@/lib/zerodb-store')
              const { addToShowcase } = await import('@/lib/showcase-store')
              const { storeSSRPreview } = await import('@/lib/preview-store')
              const isShowcase = finalContent.length > 1000

              // Save code to ZeroDB
              saveGeneration({
                chatId: responseId,
                prompt: message,
                generatedCode: finalContent,
                model: requestedModel || DEFAULT_MODEL,
                codeLength: finalContent.length,
                isShowcase,
              }).catch(e => console.warn('[ZeroDB save failed]', e))

              // RLHF: Log generation event for tracking + learning
              logGenerationEvent({
                chatId: responseId,
                prompt: message,
                model: requestedModel || DEFAULT_MODEL,
                theme: selectedTheme.name,
                codeLength: finalContent.length,
                passedValidation: validation.valid,
                generationTimeMs: Date.now() - generationStartTime,
                retryCount: retryAttempted ? 1 : 0,
                finishReason: 'stop',
              }).catch(e => console.warn('[RLHF log failed]', e))

              // Showcase auto-populate disabled — creates junk entries
              // addToShowcase(message, responseId, finalContent.length, finalContent)

              // SSR build in background — when done, the next iframe refresh shows instant content
              import('@/lib/sandbox-builder').then(({ buildInSandbox }) => {
                buildInSandbox(finalContent).then(ssrResult => {
                  if (ssrResult.success) {
                    storeSSRPreview(responseId, ssrResult.html)
                    console.log(`🏗️ SSR ready for ${responseId}: ${ssrResult.html.length}b in ${ssrResult.buildTimeMs}ms`)
                  }
                }).catch(() => {})
              }).catch(() => {})
            } catch (_) {}
          }

          keepaliveActive = false
          clearInterval(keepaliveInterval)
          try { controller.close() } catch (_) { /* already closed */ }
        } catch (error) {
          console.error('Streaming error:', error)
          keepaliveActive = false
          clearInterval(keepaliveInterval)
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: 'Stream failed'
          })}\n\n`))
          try { controller.close() } catch (_) { /* already closed */ }
        }
      }
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      }
    })

  } catch (error) {
    console.error('Chat WebSocket API Error:', error)
    return Response.json({ error: 'Failed to process request' }, { status: 500 })
  }
}