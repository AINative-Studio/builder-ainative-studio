import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { auth } from '@/app/(auth)/auth'
import { nanoid } from 'nanoid'
import { storePreview } from '@/lib/preview-store'
import { verifyAndEnhancePrompt } from '@/lib/component-verifier'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'
import { enhancePromptWithMockData } from '@/lib/mock-data-generator'
import { logGeneration, getActivePromptVersion } from '@/lib/services/rlhf.service'
import { buildEnhancedPrompt } from '@/lib/services/prompt-builder.service'
import { getActiveDesignTokens } from '@/lib/services/design-tokens.service'

// LLAMA Configuration using OpenAI SDK directly
const llama = new OpenAI({
  apiKey: process.env.META_API_KEY!,
  baseURL: process.env.META_BASE_URL || 'https://api.llama.com/compat/v1',
})

// Available components for LLAMA to use
const AVAILABLE_COMPONENTS = [
  'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
  'Input', 'Label', 'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback',
  'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell', 'Separator'
]

export async function POST(request: NextRequest) {
  try {
    const { message, chatId, attachments, streaming } = await request.json()

    if (!message) {
      return Response.json({ error: 'Message is required' }, { status: 400 })
    }

    const session = await auth()
    const userId = session?.user?.id || 'anonymous'
    const generationStartTime = Date.now()

    // US-016: A/B Testing - Get active prompt version
    let systemPrompt = PROFESSIONAL_SYSTEM_PROMPT
    let promptVersionId: string | null = null

    try {
      const activePrompt = await getActivePromptVersion('system')
      if (activePrompt) {
        systemPrompt = activePrompt.content
        promptVersionId = activePrompt.id
        console.log(`🧪 Using A/B test prompt version: ${activePrompt.version}`)
      }
    } catch (error) {
      console.warn('Failed to get active prompt version, using default:', error)
    }

    // Get previous messages if this is a continuation of an existing chat
    let previousMessages: Array<{ role: 'user' | 'assistant', content: string }> = []
    if (chatId) {
      const { getChatData } = await import('@/lib/preview-store')
      const chatData = getChatData(chatId)
      if (chatData && chatData.messages) {
        previousMessages = chatData.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
        console.log(`📜 Retrieved ${previousMessages.length} previous messages for chat ${chatId}`)
      }
    }

    // EPIC 5: TEMPLATE MATCHING (US-036, US-037)
    console.log('🎯 Checking for template match...')
    let templateMatch = null
    let customizedTemplateCode = null

    try {
      const { getTemplateMatcherService } = await import('@/lib/services/template-matcher.service')
      const { getTemplateCustomizerService } = await import('@/lib/services/template-customizer.service')
      const { db } = await import('@/lib/db')
      const { templates } = await import('@/lib/db/schema')
      const { eq } = await import('drizzle-orm')

      const templateMatcher = getTemplateMatcherService()
      const matchResult = await templateMatcher.matchTemplate(message, true)

      console.log('📋 Template match result:', {
        category: matchResult.templateCategory,
        confidence: matchResult.confidence,
        matchType: matchResult.matchType
      })

      // If confidence is high enough, use template
      if (matchResult.confidence >= 0.7 && matchResult.templateCategory) {
        // Fetch template from database
        const [template] = await db
          .select()
          .from(templates)
          .where(eq(templates.category, matchResult.templateCategory))
          .orderBy(templates.usage_count)
          .limit(1)

        if (template) {
          templateMatch = {
            templateId: template.id,
            templateName: template.name,
            category: template.category,
            confidence: matchResult.confidence
          }

          console.log('✅ Using template:', templateMatch)

          // Customize template with user's prompt
          const customizer = getTemplateCustomizerService()
          const customizationResult = await customizer.customize(
            template.code,
            template.metadata.placeholders,
            message,
            template.category
          )

          if (customizationResult.success) {
            customizedTemplateCode = customizationResult.customizedCode
            console.log('✨ Template customized successfully:', {
              placeholdersReplaced: customizationResult.placeholdersReplaced.length,
              placeholdersNotFound: customizationResult.placeholdersNotFound.length
            })

            // Increment template usage count (US-039)
            await db
              .update(templates)
              .set({ usage_count: template.usage_count + 1 })
              .where(eq(templates.id, template.id))
          }
        }
      }
    } catch (error) {
      console.warn('Template matching failed, proceeding with normal generation:', error)
    }

    // EPIC 4: ENHANCED PROMPT ENGINEERING PIPELINE
    console.log('🚀 Starting enhanced prompt engineering pipeline...')

    // Get active design tokens for user (if available)
    let designTokens = null
    if (userId !== 'anonymous') {
      try {
        designTokens = await getActiveDesignTokens(userId)
      } catch (error) {
        console.warn('Failed to load design tokens:', error)
      }
    }

    // Build enhanced prompt with all improvements
    const promptEnhancement = await buildEnhancedPrompt(message, designTokens)

    console.log('📊 Enhanced prompt metadata:', {
      originalLanguage: promptEnhancement.metadata.originalLanguage,
      wasTranslated: promptEnhancement.metadata.wasTranslated,
      detectedUIType: promptEnhancement.metadata.detectedUIType,
      uiTypeConfidence: promptEnhancement.metadata.uiTypeConfidence,
      examplesCount: promptEnhancement.metadata.examplesCount,
      examplesMethod: promptEnhancement.metadata.examplesMethod,
      componentDocsInjected: promptEnhancement.metadata.componentDocsInjected,
      tokenBudget: promptEnhancement.metadata.tokenBudget.breakdown,
      wasTruncated: promptEnhancement.metadata.wasTruncated,
      processingTimeMs: promptEnhancement.metadata.processingTimeMs
    })

    // Use enhanced prompt and system prompt
    const enhancedPrompt = promptEnhancement.enhancedPrompt
    const enhancedSystemPrompt = promptEnhancement.systemPrompt

    console.log('LLAMA API request:', {
      originalMessage: message,
      enhancedPromptLength: enhancedPrompt.length,
      systemPromptLength: enhancedSystemPrompt.length,
      chatId: chatId || nanoid(),
      userId,
      streaming,
      previousMessageCount: previousMessages.length,
      promptVersionId: promptVersionId || 'default',
      epic4Enabled: true
    })

    // Build conversation messages array
    const conversationMessages = [
      {
        role: 'system' as const,
        content: enhancedSystemPrompt
      },
      ...previousMessages,
      {
        role: 'user' as const,
        content: enhancedPrompt
      }
    ]

    // If streaming requested, return streaming response
    if (streaming) {
      // EPIC 5: Use customized template if available (US-037)
      if (customizedTemplateCode) {
        console.log('📦 Using pre-customized template instead of LLAMA generation')
        const encoder = new TextEncoder()
        const responseId = chatId || nanoid()
        const readable = new ReadableStream({
          async start(controller) {
            try {
              const { updatePreviewPartial } = await import('@/lib/preview-store')

              // Send chatId immediately
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                chatId: responseId,
                demo: `/preview/${responseId}`,
                usingTemplate: true,
                templateName: templateMatch?.templateName
              })}\n\n`))

              // Simulate streaming by sending the template in chunks
              const chunkSize = 50
              for (let i = 0; i < customizedTemplateCode.length; i += chunkSize) {
                const chunk = customizedTemplateCode.slice(i, i + chunkSize)
                const partial = customizedTemplateCode.slice(0, i + chunkSize)

                updatePreviewPartial(responseId, partial)
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`))

                // Small delay to simulate streaming
                await new Promise(resolve => setTimeout(resolve, 10))
              }

              // Store the complete response
              storePreview(responseId, customizedTemplateCode, message)

              // US-011: Log generation (US-039: with template info)
              const generationTimeMs = Date.now() - generationStartTime
              if (userId !== 'anonymous') {
                logGeneration({
                  chatId: responseId,
                  userId,
                  prompt: message,
                  generatedCode: customizedTemplateCode,
                  promptVersionId,
                  model: 'template',
                  templateUsed: templateMatch?.templateName || null,
                  generationTimeMs,
                }).catch(err => {
                  console.error('Failed to log generation:', err)
                })
              }

              // Send final event
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                done: true,
                chatId: responseId,
                demo: `/preview/${responseId}`,
                usingTemplate: true
              })}\n\n`))

              controller.close()
            } catch (error) {
              console.error('Template streaming error:', error)
              controller.error(error)
            }
          }
        })

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      }

      // Normal LLAMA streaming generation
      console.log('Starting LLAMA streaming generation...')
      const model = process.env.LLAMA_MODEL || 'Llama-4-Maverick-17B-128E-Instruct-FP8'
      const stream = await llama.chat.completions.create({
        model,
        messages: conversationMessages,
        temperature: 0.7,
        max_tokens: 3000,
        stream: true,
      })

      // Create a TransformStream to handle the streaming response
      const encoder = new TextEncoder()
      const responseId = chatId || nanoid()
      const readable = new ReadableStream({
        async start(controller) {
          try {
            let fullContent = ''
            const { updatePreviewPartial } = await import('@/lib/preview-store')

            // Send chatId immediately so preview can start
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              chatId: responseId,
              demo: `/preview/${responseId}`
            })}\n\n`))

            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || ''
              if (content) {
                fullContent += content

                // Store partial content for real-time preview
                updatePreviewPartial(responseId, fullContent)

                // Send the chunk to the client
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`))
              }
            }

            // Store the complete response with chat history
            storePreview(responseId, fullContent, message)

            // US-011: Log generation to database (async)
            const generationTimeMs = Date.now() - generationStartTime
            if (fullContent && userId !== 'anonymous') {
              logGeneration({
                chatId: responseId,
                userId,
                prompt: message,
                generatedCode: fullContent,
                promptVersionId,
                model,
                templateUsed: templateMatch?.templateName || null,
                generationTimeMs,
              }).catch(err => {
                console.error('Failed to log generation:', err)
              })
            }

            // Send final event with chat ID and demo URL
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              done: true,
              chatId: responseId,
              demo: `/preview/${responseId}`
            })}\n\n`))

            controller.close()
          } catch (error) {
            console.error('Streaming error:', error)
            controller.error(error)
          }
        }
      })

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      })
    }

    // Non-streaming mode (fallback)
    console.log('Starting LLAMA generation with professional prompt...')
    const model = process.env.LLAMA_MODEL || 'Llama-4-Maverick-17B-128E-Instruct-FP8'
    const result = await llama.chat.completions.create({
      model,
      messages: conversationMessages,
      temperature: 0.7,
      max_tokens: 3000,
    })
    console.log('LLAMA generation completed! Generated:', result.choices[0].message.content?.substring(0, 100) + '...')

    const generatedContent = result.choices[0].message.content
    const generationTimeMs = Date.now() - generationStartTime

    // Return the response in v0-compatible format
    const responseId = chatId || nanoid()

    // Create local preview URL using the chat ID
    let demoUrl = null
    if (generatedContent) {
      // Store the content with the chat ID so /api/preview/[id] can find it
      // Also store the user message for chat history
      storePreview(responseId, generatedContent, message)
      // Use our local preview page with iframe
      demoUrl = `/preview/${responseId}`
      console.log('Created local preview with chat ID:', responseId)
    }

    // US-011: Log generation to database (async, don't block response)
    if (generatedContent && userId !== 'anonymous') {
      logGeneration({
        chatId: responseId,
        userId,
        prompt: message,
        generatedCode: generatedContent,
        promptVersionId,
        model,
        templateUsed: null,
        generationTimeMs,
      }).catch(err => {
        console.error('Failed to log generation:', err)
      })
    }

    return Response.json({
      id: responseId,
      demo: demoUrl,
      messages: [
        {
          id: nanoid(),
          role: 'assistant',
          content: generatedContent,
          experimental_content: generatedContent
        }
      ]
    })
  } catch (error) {
    console.error('LLAMA Chat API Error:', error)
    return Response.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}