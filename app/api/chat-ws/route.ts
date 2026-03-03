import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { nanoid } from 'nanoid'
import { verifyAndEnhancePrompt } from '@/lib/component-verifier'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'
import { enhancePromptWithMockData } from '@/lib/mock-data-generator'
import { updatePreviewPartial, storePreview, getChatData } from '@/lib/preview-store'
import { validateGeneratedCode } from '@/lib/code-validator'
import { fetchContextualImages, formatImagesForPrompt, getFallbackImages } from '@/lib/services/unsplash.service'
import { COMPONENT_GENERATION_TOOL, extractComponentCode, validateComponentGeneration } from '@/lib/agent/component-generation-tool'
import { getConversationMemory, addComponentToMemory, formatMemoryForPrompt } from '@/lib/services/memory.service'
import { runOrchestratorAgent } from '@/lib/agent/subagents'
import { parsePRDForBuildSteps } from '@/lib/prd-parser'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(request: NextRequest) {
  try {
    const { message, chatId } = await request.json()

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

          // Build enhanced system prompt with images + memory context
          const memoryContext = formatMemoryForPrompt(responseId)
          const enhancedSystemPrompt = PROFESSIONAL_SYSTEM_PROMPT + imagePrompt + memoryContext

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
            // Use standard streaming with Tool Use API
          // Use prompt caching for 90% cost reduction on system prompt
          const stream = await anthropic.messages.stream({
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
            max_tokens: 8000,
            temperature: 1,  // Must be 1 when using extended thinking
            thinking: {
              type: 'enabled',
              budget_tokens: 2000  // Allow Claude to think before generating (improves quality significantly)
            },
            system: [
              {
                type: 'text',
                text: enhancedSystemPrompt,
                cache_control: { type: 'ephemeral' }  // Cache system prompt for 5 minutes
              }
            ],
            messages: conversationMessages,
            tools: [COMPONENT_GENERATION_TOOL],  // Enable structured outputs via Tool Use API
          })

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
          } // End of streaming mode (else block)

          // Validate generated code before storing
          let validation = validateGeneratedCode(fullContent)
          let finalContent = fullContent
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
                max_tokens: 8000,
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

            // Store clean code response (without including the user's PRD text)
            storePreview(responseId, cleanCodeResponse, message, { usage: tokenUsage })

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

          controller.close()
        } catch (error) {
          console.error('Streaming error:', error)
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: 'Stream failed'
          })}\n\n`))
          controller.close()
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