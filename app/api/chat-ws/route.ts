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
import { selectTheme, formatThemeForPrompt } from '@/lib/theme-system'
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
const ainativeBaseURL = process.env.AINATIVE_API_URL || 'https://api.ainative.studio/v1'
const ainativeClient = new OpenAI({
  apiKey: process.env.ZERODB_API_KEY || '',
  baseURL: ainativeBaseURL,
})

// Get the appropriate client based on environment
function getLLMClient(): OpenAI {
  return isLocal ? metaClient : ainativeClient
}

// Default model — Llama Maverick on production (fast + reliable via Meta API)
// DeepSeek 4 Flash is higher quality but DigitalOcean backend is unreliable (30-50% timeout)
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'Llama-4-Maverick-17B-128E-Instruct-FP8'

// Model routing config — all models route through AINative API
const MODEL_CONFIG: Record<string, { provider: 'meta' | 'ainative'; modelId: string }> = {
  // Top tier — DigitalOcean hosted, high token output, no truncation
  'kimi-k2': { provider: 'ainative', modelId: 'kimi-k2' },
  'deepseek-4-flash': { provider: 'ainative', modelId: 'deepseek-4-flash' },
  'qwen3-coder-flash': { provider: 'ainative', modelId: 'qwen3-coder-flash' },
  // Llama Models (Meta API — 512 token cap, needs continuation)
  'llama-4-maverick': { provider: isLocal ? 'meta' : 'ainative', modelId: 'Llama-4-Maverick-17B-128E-Instruct-FP8' },
  'llama-3.3-70b': { provider: 'ainative', modelId: 'Llama-3.3-70B-Instruct' },
  // Code Specialists
  'qwen-coder-32b': { provider: 'ainative', modelId: 'qwen-coder-32b' },
  'nouscoder-14b': { provider: 'ainative', modelId: 'nouscoder-14b' },
  // General
  'gemma-9b': { provider: 'ainative', modelId: 'gemma-9b' },
  // Reasoning
  'deepseek-r1-distill-qwen-7b': { provider: 'ainative', modelId: 'deepseek-r1-distill-qwen-7b' },
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

          // REAL STEP 3: Fetch contextual hero images
          const images = await fetchContextualImages(message, 3)
          const imagePrompt = formatImagesForPrompt(images.length > 0 ? images : getFallbackImages())

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
          const memoryContext = formatMemoryForPrompt(responseId)
          const enhancedSystemPrompt = PROFESSIONAL_SYSTEM_PROMPT + themePrompt + imagePrompt + memoryContext

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
            // System prompt — generates proper React functional components (NOT raw HTML)
            const llmSystemPrompt = `You are a senior React developer. Generate a COMPLETE, SINGLE-FILE React functional component.

CRITICAL RULES:
1. Output a REACT COMPONENT — NOT raw HTML. Must have: import React, function declaration, return JSX, export default.
2. Wrap output in \`\`\`jsx markers. No explanations before or after.
3. ALL imports at the top: React hooks, Lucide icons, shadcn/ui components, Recharts.
4. ONE default export function component. All code in ONE file.
5. Use useState/useEffect for interactivity. Include realistic mock data arrays.
6. Use Tailwind CSS classes for ALL styling. No inline styles. No CSS files.

STRUCTURE (follow exactly):
\`\`\`jsx
import React, { useState } from 'react'
import { Icon1, Icon2 } from 'lucide-react'

const mockData = [...]  // realistic sample data

export default function AppName() {
  const [state, setState] = useState(initialValue)
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* semantic HTML: header, main, section, footer */}
      {/* Tailwind: rounded-xl, shadow-sm, gap-6, etc */}
    </div>
  )
}
\`\`\`

AVAILABLE IMPORTS:
- 'lucide-react': any icon (Users, DollarSign, TrendingUp, Search, Plus, etc.)
- '@/components/ui/button': Button
- '@/components/ui/card': Card, CardHeader, CardTitle, CardContent
- '@/components/ui/badge': Badge
- '@/components/ui/input': Input
- '@/components/ui/tabs': Tabs, TabsList, TabsTrigger, TabsContent
- 'recharts': BarChart, LineChart, PieChart, XAxis, YAxis, Tooltip, ResponsiveContainer
- '@/components/aikit': MetricCard (for stat displays)

DESIGN: Modern, clean. bg-gray-50 background, white cards with shadow-sm and rounded-xl, generous spacing (p-6, gap-4).`

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
              const MODELS_TO_TRY = [modelId, 'Llama-3.3-70B-Instruct', 'Llama-4-Maverick-17B-128E-Instruct-FP8']
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

          // Strip any gradient classes that slipped through
          fullContent = stripGradients(fullContent)

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
              const retryModels = [DEFAULT_MODEL, 'Llama-3.3-70B-Instruct', 'qwen3-coder-flash']
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

            // Persist to ZeroDB + SSR build + showcase (fire-and-forget)
            try {
              const { saveGeneration } = await import('@/lib/zerodb-store')
              const { addToShowcase } = await import('@/lib/showcase-store')
              const { buildInSandbox } = await import('@/lib/sandbox-builder')
              const isShowcase = finalContent.length > 3000

              // SSR build in sandbox (async, don't block response)
              buildInSandbox(finalContent).then(ssrResult => {
                if (ssrResult.success) {
                  console.log(`🏗️ SSR preview built: ${ssrResult.html.length}b in ${ssrResult.buildTimeMs}ms`)
                }
                // Save to ZeroDB with SSR HTML
                saveGeneration({
                  chatId: responseId,
                  prompt: message,
                  generatedCode: finalContent,
                  model: requestedModel || DEFAULT_MODEL,
                  codeLength: finalContent.length,
                  isShowcase,
                  ssrHtml: ssrResult.success ? ssrResult.html : undefined,
                }).catch(() => {})
              }).catch(() => {
                // SSR failed — save without HTML
                saveGeneration({
                  chatId: responseId,
                  prompt: message,
                  generatedCode: finalContent,
                  model: requestedModel || DEFAULT_MODEL,
                  codeLength: finalContent.length,
                  isShowcase,
                }).catch(() => {})
              })

              addToShowcase(message, responseId, finalContent.length, finalContent)
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