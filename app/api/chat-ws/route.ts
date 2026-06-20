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
  // llama-4-maverick REMOVED — AINative caps at 512 tokens, ALWAYS truncated
  // 'llama-4-maverick': { provider: isLocal ? 'meta' : 'ainative', modelId: 'llama-4-maverick', tier: 'free' },
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
            // BLOCK maverick — AINative caps it at 512 tokens (ALWAYS truncated)
            const safeModel = requestedModel === 'llama-4-maverick' ? DEFAULT_MODEL : requestedModel
            const modelConfig = MODEL_CONFIG[safeModel] || { provider: 'ainative', modelId: DEFAULT_MODEL }
            const provider = modelConfig.provider
            const modelId = modelConfig.modelId
            const client = provider === 'meta' ? metaClient : ainativeClient
            console.log(`🤖 Using model: ${modelId} (provider: ${provider}, env: ${isLocal ? 'local' : 'cloud'})`)

            // ============ ALL MODELS VIA OPENAI-COMPATIBLE API (Meta or AINative) ============
            // Use the full professional system prompt (enhancedSystemPrompt) which includes:
            // - 580-line PROFESSIONAL_SYSTEM_PROMPT with AIKit components, AX standards, design rules
            // - Theme colors injected into all examples via applyThemeToPrompt()
            // - Unsplash hero images if available
            // - Memory context from previous generations
            //
            // The old 35-line hardcoded prompt capped at 60 lines was the #1 quality bottleneck.
            // Open-source models (ministral-14b, kimi-k2, nous-coder) handle 4K+ system prompts fine.
            const llmSystemPrompt = enhancedSystemPrompt + `

## SANDPACK ENVIRONMENT — AVAILABLE IMPORTS (use ONLY these)

**npm packages (installed):** react, react-dom, lucide-react, recharts@2.15.0, clsx, tailwind-merge
**shadcn/ui components (from './components/ui/...'):** button, card, badge, input, tabs, label, table, separator, dialog, select, progress, checkbox, accordion, alert, toast, popover, avatar
**AIKit components (from './components/aikit'):** MetricCard, AIKitPriceCard, AIKitRating, AgentCard, SwarmView, SafetyBadge, GuardrailPanel, ChatBubble, StreamingIndicator, CodeDisplay, TokenUsageBar, ConnectionStatus, AIKitHeader, AIKitSidebar, AIKitTable, AIKitTimeline, AIKitBanner, AIKitAvatar, Skeleton, SkeletonCard, EmptyState, AIKitProductCard, AIKitPagination, AIKitBreadcrumb, AIKitStepper, VideoPlayer, StreamingText, MediaGallery, AgentTimeline
**Icons (from 'lucide-react'):** Any Lucide icon

**DO NOT import:** framer-motion, @radix-ui/*, date-fns, react-hook-form, zod, @tanstack/*, react-router-dom, axios, react-icons, sonner, next/link, next/image
**DO NOT import from:** @ainative/*, @/components/*, aikit (npm) — use relative paths only

## CRITICAL SYNTAX RULES
- Write \`function ComponentName() {\` — always include parentheses
- Keep ALL strings on single lines. Close every quote.
- Close every JSX tag. Every <div> has </div>.
- Use "USD" not "$" in string values.
- export default function App() — always export default.`

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
                  const timer = setTimeout(() => ctrl.abort(), 90_000)
                  const response = await client.chat.completions.create(
                    { model: tryModel, max_tokens: 8192, temperature: 0.7, messages: singleTurnMessages },
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
          console.log('[VALIDATION] Running validateGeneratedCode, fullContent length:', fullContent.length)
          let validation = validateGeneratedCode(fullContent)
          // CRITICAL: Use the VALIDATED/FIXED code, not the original raw content
          // validation.code has markdown extracted and auto-fixes applied
          let finalContent = validation.code
          console.log('[VALIDATION] Result:', validation.valid ? '✅ valid' : '❌ invalid', 'finalContent:', finalContent.length, 'chars')
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
              // Keep to 2 messages (system + user) to avoid multi-turn 512-token cap
              const retryMessages = [
                { role: 'system' as const, content: 'Fix the syntax errors in the code below. Return ONLY valid, complete React code wrapped in ```jsx markers. Ensure all JSX tags are properly closed, all strings are terminated, and all brackets match.' },
                { role: 'user' as const, content: `Here is the broken code:\n\`\`\`jsx\n${fullContent.slice(0, 6000)}\n\`\`\`\n\n${retryPrompt}` }
              ]
              for (const retryModel of retryModels) {
                try {
                  const retryResponse = await ainativeClient.chat.completions.create({
                    model: retryModel,
                    max_tokens: 8192,
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

            // Store the invalid code with error marker — wrap in markdown so iframe preview can extract it
            const wrappedInvalidCode = `\`\`\`jsx\n${finalContent}\n\`\`\``
            storePreview(responseId, wrappedInvalidCode, message, { validationError: validation.error, usage: tokenUsage })

            // Still send files for Sandpack (it has its own error boundary)
            try {
              const parsedFiles = parseMultiFileOutput(finalContent, message)
              if (Object.keys(parsedFiles).length > 0) {
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'files',
                  files: parsedFiles
                })}\n\n`))
              }
            } catch (parseErr) {
              console.warn('Failed to parse files for Sandpack on validation error path:', parseErr)
            }

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
            // Write RLHF training data directly (before any async imports that might hang)
            try {
              const _fs = eval('require')('fs')
              const _path = eval('require')('path')
              const _dir = _path.join(process.cwd(), 'data')
              if (!_fs.existsSync(_dir)) _fs.mkdirSync(_dir, { recursive: true })
              _fs.appendFileSync(_path.join(_dir, 'rlhf-training-data.jsonl'), JSON.stringify({
                messages: [
                  { role: 'system', content: (enhancedSystemPrompt || '').slice(0, 5000) },
                  ...(previousMessages || []),
                  { role: 'user', content: enhancedPrompt || message },
                  { role: 'assistant', content: (finalContent || '').slice(0, 20000) },
                ],
                metadata: {
                  chat_id: responseId, model: usedModel,
                  status: validation.valid ? 'success' : 'validation_error',
                  validation_valid: validation.valid, generation_time_ms: genTimeMs,
                  code_length: finalContent?.length || 0, theme: selectedTheme?.name,
                  temperature: 0.7, max_tokens: 8192, provider: isLocal ? 'meta' : 'ainative',
                  retry_attempted: retryAttempted, created_at: new Date().toISOString(),
                },
              }) + '\n')
              console.log(`[RLHF] 📝 Training data saved: ${responseId} (${finalContent.length} chars)`)
            } catch (_rlhfErr: any) {
              console.warn('[RLHF] Local JSONL failed:', _rlhfErr?.message || _rlhfErr)
            }

            console.log('[PERSIST] Starting fire-and-forget block for', responseId)
            try {
              const { saveGeneration, logGenerationEvent } = await import('@/lib/zerodb-store')
              const { storeSSRPreview } = await import('@/lib/preview-store')
              const { logGeneration: logGenToDrizzle } = await import('@/lib/services/rlhf.service')
              const isShowcase = finalContent.length > 1000
              const usedModel = requestedModel || DEFAULT_MODEL
              const genTimeMs = Date.now() - generationStartTime

              // Save code to ZeroDB
              saveGeneration({
                chatId: responseId,
                prompt: message,
                generatedCode: finalContent,
                model: usedModel,
                codeLength: finalContent.length,
                isShowcase,
              }).catch(e => console.warn('[ZeroDB save failed]', e))

              // Auto-populate showcase with quality generations (validation passed + substantial code)
              if (validation.valid && finalContent.length > 3000) {
                import('@/lib/showcase-store').then(({ addToShowcase }) => {
                  const added = addToShowcase(message, responseId, finalContent.length, finalContent)
                  if (added) console.log(`🏆 Added to showcase: ${responseId} (${finalContent.length} chars)`)
                }).catch(() => {})
              }

              // RLHF: Log generation event for tracking + learning
              logGenerationEvent({
                chatId: responseId,
                prompt: message,
                model: usedModel,
                theme: selectedTheme.name,
                codeLength: finalContent.length,
                passedValidation: validation.valid,
                generationTimeMs: genTimeMs,
                retryCount: retryAttempted ? 1 : 0,
                finishReason: 'stop',
              }).catch(e => console.warn('[RLHF log failed]', e))

              // RLHF: Write local JSONL training data (guaranteed, synchronous)
              try {
                const rlhfFs = eval('require')('fs')
                const rlhfPath = eval('require')('path')
                const rlhfDir = rlhfPath.join(process.cwd(), 'data')
                if (!rlhfFs.existsSync(rlhfDir)) rlhfFs.mkdirSync(rlhfDir, { recursive: true })
                const rlhfFile = rlhfPath.join(rlhfDir, 'rlhf-training-data.jsonl')
                const rlhfRow = {
                  messages: [
                    { role: 'system', content: llmSystemPrompt.slice(0, 5000) },
                    ...(previousMessages || []),
                    { role: 'user', content: enhancedPrompt },
                    { role: 'assistant', content: finalContent.slice(0, 20000) },
                  ],
                  metadata: {
                    chat_id: responseId, model: usedModel,
                    status: validation.valid ? 'success' : 'validation_error',
                    validation_valid: validation.valid,
                    generation_time_ms: genTimeMs,
                    code_length: finalContent.length,
                    theme: selectedTheme.name,
                    temperature: 0.7, max_tokens: 8192,
                    provider: isLocal ? 'meta' : 'ainative',
                    retry_attempted: retryAttempted,
                    created_at: new Date().toISOString(),
                  },
                }
                rlhfFs.appendFileSync(rlhfFile, JSON.stringify(rlhfRow) + '\n')
                console.log(`[RLHF] 📝 Training data saved: ${responseId} (${finalContent.length} chars)`)
              } catch (rlhfErr: any) {
                console.warn('[RLHF] Local JSONL failed:', rlhfErr?.message || rlhfErr)
              }

              // RLHF: Also try Drizzle DB (may fail locally)
              console.log('[RLHF] 🔄 Calling logGenToDrizzle for', responseId)
              logGenToDrizzle({
                chatId: responseId,
                userId: 'anonymous', // TODO: get from session
                prompt: message,
                generatedCode: finalContent,
                model: usedModel,
                generationTimeMs: genTimeMs,
                templateUsed: null,
                // Fine-tuning data
                systemPrompt: enhancedSystemPrompt,
                fullConversation: [
                  { role: 'system', content: (enhancedSystemPrompt || '').slice(0, 5000) },
                  ...(previousMessages || []),
                  { role: 'user', content: enhancedPrompt },
                  { role: 'assistant', content: finalContent.slice(0, 10000) },
                ],
                tokenUsage: tokenUsage || undefined,
                modelConfig: {
                  temperature: 0.7,
                  max_tokens: 8192,
                  provider: isLocal ? 'meta' : 'ainative',
                },
                validationResult: {
                  valid: validation.valid,
                  error: validation.valid ? undefined : validation.error,
                  retryAttempted,
                },
                status: validation.valid ? 'success' : 'validation_error',
                theme: selectedTheme.name,
                codeLength: finalContent.length,
              }).catch(e => console.warn('[RLHF Drizzle log failed]', e))

              // SSR build in background — when done, the next iframe refresh shows instant content
              import('@/lib/sandbox-builder').then(({ buildInSandbox }) => {
                buildInSandbox(finalContent).then(ssrResult => {
                  if (ssrResult.success) {
                    storeSSRPreview(responseId, ssrResult.html)
                    console.log(`🏗️ SSR ready for ${responseId}: ${ssrResult.html.length}b in ${ssrResult.buildTimeMs}ms`)
                  }
                }).catch(() => {})
              }).catch(() => {})
            } catch (persistErr: any) {
              console.error('[PERSIST] Fire-and-forget block failed:', persistErr?.message || persistErr)
            }
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

          // RLHF: Log failure for training data
          import('@/lib/services/rlhf.service').then(({ logGenerationFailure }) => {
            logGenerationFailure({
              chatId: responseId,
              userId: 'anonymous',
              prompt: message,
              model: requestedModel || DEFAULT_MODEL,
              error: error instanceof Error ? error.message : String(error),
              systemPrompt: enhancedSystemPrompt?.slice(0, 5000),
              generationTimeMs: Date.now() - generationStartTime,
            }).catch(() => {})
          }).catch(() => {})

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