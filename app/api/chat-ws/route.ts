import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { nanoid } from 'nanoid'
import { verifyAndEnhancePrompt } from '@/lib/component-verifier'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'
import { enhancePromptWithMockData } from '@/lib/mock-data-generator'
import { updatePreviewPartial, storePreview, getChatData } from '@/lib/preview-store'
import { validateGeneratedCode } from '@/lib/code-validator'
import { stripGradients } from '@/lib/gradient-blocker'
import { fetchContextualImages, formatImagesForPrompt, getFallbackImages } from '@/lib/services/unsplash.service'
import { COMPONENT_GENERATION_TOOL, extractComponentCode, validateComponentGeneration } from '@/lib/agent/component-generation-tool'
import { getConversationMemory, addComponentToMemory, formatMemoryForPrompt } from '@/lib/services/memory.service'
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// AINative API client (OpenAI-compatible) for GPT models
const ainativeClient = new OpenAI({
  apiKey: process.env.ZERODB_API_KEY || '',
  baseURL: 'https://api.ainative.studio/v1',
})

// Model routing config — IDs match AINative API /api/v1/chat/completions
const MODEL_CONFIG: Record<string, { provider: 'anthropic' | 'ainative'; modelId: string }> = {
  // Direct Anthropic SDK (extended thinking + tool use)
  'claude-sonnet-4': { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
  'claude-opus-4': { provider: 'anthropic', modelId: 'claude-opus-4-20250514' },
  // Code Specialists (via AINative API — best for UI generation)
  'qwen-coder-32b': { provider: 'ainative', modelId: 'qwen-coder-32b' },
  'qwen-coder-7b': { provider: 'ainative', modelId: 'qwen-coder-7b' },
  'nouscoder-14b': { provider: 'ainative', modelId: 'nouscoder-14b' },
  // Premium (via AINative API)
  'claude-sonnet-4.5': { provider: 'ainative', modelId: 'claude-sonnet-4.5' },
  'claude-3-5-haiku': { provider: 'ainative', modelId: 'claude-3-5-haiku' },
  // Text / General (via AINative API)
  'qwen-7b': { provider: 'ainative', modelId: 'qwen-7b' },
  'gemma-9b': { provider: 'ainative', modelId: 'gemma-9b' },
  'gemma-2b': { provider: 'ainative', modelId: 'gemma-2b' },
  // Reasoning (via AINative API)
  'deepseek-r1-distill-qwen-7b': { provider: 'ainative', modelId: 'deepseek-r1-distill-qwen-7b' },
  'deepseek-r1-distill-llama-8b': { provider: 'ainative', modelId: 'deepseek-r1-distill-llama-8b' },
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
              anthropic,
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
            const modelConfig = MODEL_CONFIG[requestedModel] || MODEL_CONFIG['claude-sonnet-4']
            const provider = modelConfig.provider
            const modelId = modelConfig.modelId
            console.log(`🤖 Using model: ${modelId} (provider: ${provider})`)

          if (provider === 'ainative') {
            // ============ GPT/NOUS MODELS VIA AINATIVE MANAGED CHAT (SSE streaming) ============
            console.log(`🔄 Calling AINative Managed Chat API: ${modelId} (streaming)`)

            // Condensed prompt for non-Claude models (smaller context windows)
            const gptSystemPrompt = enhancedSystemPrompt.split('## FEW-SHOT EXAMPLES')[0] +
              '\n\nGenerate a complete, production-ready React component. Use Lucide icons, Tailwind CSS, and shadcn/ui components. Follow all AX requirements.'

            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'build_step', step: 'Generating with ' + modelId + '...' })}\n\n`))

            // Use the managed-chat streaming endpoint
            const aiNativeResponse = await fetch('https://api.ainative.studio/api/v1/managed-chat/completions', {
              method: 'POST',
              headers: {
                'X-API-Key': process.env.ZERODB_API_KEY || '',
                'Authorization': `Bearer ${process.env.ZERODB_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: modelId,
                messages: [
                  { role: 'system', content: gptSystemPrompt },
                  ...conversationMessages,
                ],
                max_tokens: 8000,
                temperature: 0.7,
                stream: true,
              }),
            })

            if (!aiNativeResponse.ok) {
              // Fallback to non-streaming /v1/chat/completions
              console.log(`⚠️ Managed chat failed (${aiNativeResponse.status}), falling back to /v1/chat/completions`)
              const fallbackResponse = await ainativeClient.chat.completions.create({
                model: modelId,
                max_tokens: 8000,
                temperature: 0.7,
                messages: [
                  { role: 'system', content: gptSystemPrompt },
                  ...conversationMessages,
                ],
              })
              fullContent = fallbackResponse.choices?.[0]?.message?.content || ''
            } else {
              // Parse SSE stream
              const reader = aiNativeResponse.body?.getReader()
              const decoder = new TextDecoder()
              if (reader) {
                let buffer = ''
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  buffer += decoder.decode(value, { stream: true })
                  const lines = buffer.split('\n')
                  buffer = lines.pop() || ''
                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      const data = line.slice(6).trim()
                      if (data === '[DONE]' || data === '') continue
                      try {
                        const parsed = JSON.parse(data)
                        const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || ''
                        if (content) {
                          fullContent += content
                          updatePreviewPartial(responseId, fullContent)
                          const now = Date.now()
                          if (now - lastUpdateTime > 500) {
                            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
                            lastUpdateTime = now
                          }
                        }
                      } catch (_) { /* skip unparseable chunks */ }
                    }
                    if (line.startsWith('event: done')) break
                  }
                }
              }
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

          } else {
            // ============ CLAUDE MODELS VIA ANTHROPIC SDK ============
          console.log(`🔑 Anthropic call: model=${modelId}, system=${enhancedSystemPrompt.length} chars, messages=${conversationMessages.length}, max_tokens=32000`)
          let stream: any
          try {
          stream = await anthropic.messages.stream({
            model: modelId,
            max_tokens: 32000,
            temperature: 1,  // Must be 1 when using extended thinking
            thinking: {
              type: 'enabled',
              budget_tokens: 2000
            },
            system: [
              {
                type: 'text',
                text: enhancedSystemPrompt,
                cache_control: { type: 'ephemeral' }
              }
            ],
            messages: conversationMessages,
            tools: [COMPONENT_GENERATION_TOOL],
          })
          } catch (apiError: any) {
            console.error('❌ ANTHROPIC API ERROR:', apiError?.status, apiError?.error || apiError?.message?.slice(0, 500))
            throw apiError
          }

          let toolUseInput: any = null
          let toolInputJson = ''

          for await (const chunk of stream) {
            // Skip thinking blocks - these are internal reasoning, not user-facing content
            if (chunk.type === 'content_block_start' && chunk.content_block.type === 'thinking') {
              continue
            }
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'thinking_delta') {
              continue
            }

            // Handle tool use (structured outputs)
            if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
              toolUseInput = { id: chunk.content_block.id, name: chunk.content_block.name, input: {} }
              toolInputJson = ''
            }

            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
              // Accumulate tool input JSON string (partial JSON arrives in chunks)
              if (toolUseInput && chunk.delta.partial_json) {
                toolInputJson += chunk.delta.partial_json
              }
            }

            // Handle text output (fallback if tool use fails)
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              const content = chunk.delta.text
              fullContent += content

              // Update preview store immediately (no throttling for true real-time)
              updatePreviewPartial(responseId, fullContent)

              // DON'T send code chunks to client during streaming (prevents code from showing in chat)
              // Users will see build steps instead, and final conversational message at the end

              // Send periodic refresh signal every 500ms
              const now = Date.now()
              if (now - lastUpdateTime > 500) {
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'refresh'
                })}\n\n`))
                lastUpdateTime = now
              }
            }
          }

          // Capture token usage after stream completes
          const finalMessage = await stream.finalMessage()

          // Check if output was truncated due to max_tokens
          if (finalMessage.stop_reason === 'max_tokens') {
            console.warn('⚠️ Output was TRUNCATED (hit max_tokens). Code may be incomplete.')
          }

          if (finalMessage.usage) {
            const usage = finalMessage.usage
            const totalTokens = usage.input_tokens + usage.output_tokens
            const estimatedCost = (usage.input_tokens * 0.003 + usage.output_tokens * 0.015) / 1000

            tokenUsage = {
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              cache_creation_input_tokens: usage.cache_creation_input_tokens,
              cache_read_input_tokens: usage.cache_read_input_tokens,
              total_tokens: totalTokens,
              estimated_cost: estimatedCost
            }

            console.log(`\n📊 TOKEN USAGE for ${responseId}:`)
            console.log(`   Input tokens: ${usage.input_tokens}`)
            console.log(`   Output tokens: ${usage.output_tokens}`)
            if (usage.cache_creation_input_tokens) {
              console.log(`   Cache creation tokens: ${usage.cache_creation_input_tokens}`)
            }
            if (usage.cache_read_input_tokens) {
              console.log(`   Cache read tokens: ${usage.cache_read_input_tokens} (90% cost savings!)`)
            }
            console.log(`   Total tokens: ${totalTokens}`)
            console.log(`   Estimated cost: $${estimatedCost.toFixed(4)}`)
          }

          // Extract code from tool use if available
          if (toolUseInput && toolInputJson) {
            try {
              // Parse accumulated JSON
              const componentResult = JSON.parse(toolInputJson)
              const structuredValidation = validateComponentGeneration(componentResult)

              if (!structuredValidation.valid) {
                console.warn('⚠️ Structured output validation failed:', structuredValidation.errors)
              }

              fullContent = extractComponentCode(componentResult)
              updatePreviewPartial(responseId, fullContent)

              // DON'T send code to client (prevents code from showing in chat)
              // The conversational message will be sent after validation
            } catch (parseError) {
              console.error('Failed to parse tool input JSON:', parseError)
              console.log('Accumulated JSON:', toolInputJson)
            }
          }
          } // End of Anthropic (else of provider routing)
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

Generate a corrected version of: ${message}`

              // Make retry API call
              const retryStream = await anthropic.messages.stream({
                model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
                max_tokens: 32000,
                temperature: 1,
                thinking: {
                  type: 'enabled',
                  budget_tokens: 2000
                },
                system: [
                  {
                    type: 'text',
                    text: enhancedSystemPrompt + '\n\nIMPORTANT: The previous generation failed validation. Pay extra attention to syntax correctness.',
                    cache_control: { type: 'ephemeral' }
                  }
                ],
                messages: [
                  ...previousMessages,
                  { role: 'user' as const, content: enhancedPrompt },
                  { role: 'assistant' as const, content: fullContent },
                  { role: 'user' as const, content: retryPrompt }
                ],
                tools: [COMPONENT_GENERATION_TOOL],
              })

              let retryContent = ''
              let retryToolInput: any = null
              let retryToolJson = ''

              for await (const chunk of retryStream) {
                // Skip thinking blocks
                if (chunk.type === 'content_block_start' && chunk.content_block.type === 'thinking') {
                  continue
                }
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'thinking_delta') {
                  continue
                }

                // Handle tool use
                if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
                  retryToolInput = { id: chunk.content_block.id, name: chunk.content_block.name, input: {} }
                  retryToolJson = ''
                }

                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
                  if (retryToolInput && chunk.delta.partial_json) {
                    retryToolJson += chunk.delta.partial_json
                  }
                }

                // Handle text output
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  retryContent += chunk.delta.text
                }
              }

              // Extract code from retry
              if (retryToolInput && retryToolJson) {
                try {
                  const componentResult = JSON.parse(retryToolJson)
                  retryContent = extractComponentCode(componentResult)
                } catch (parseError) {
                  console.error('Failed to parse retry tool input:', parseError)
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
                // Keep original content and let error handling below proceed
              }
            } catch (retryError) {
              console.error('Auto-retry API call failed:', retryError)
              // Keep original content and let error handling below proceed
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
          }

          try { controller.close() } catch (_) { /* already closed */ }
        } catch (error) {
          console.error('Streaming error:', error)
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