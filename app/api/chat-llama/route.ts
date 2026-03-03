import { NextRequest } from 'next/server'
import { streamText } from 'ai'
import { llamaModel } from '@/lib/llama-provider'
import { auth } from '@/app/(auth)/auth'
import { getChatCountByIP, createAnonymousChatLog } from '@/lib/db/queries'
import { anonymousEntitlements } from '@/lib/entitlements'
import { ChatSDKError } from '@/lib/errors'

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')

  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  if (realIP) {
    return realIP
  }

  return '::1'
}

export async function POST(request: NextRequest) {
  try {
    const { message, chatId, attachments } = await request.json()

    if (!message) {
      return new ChatSDKError('invalid_request', 'Message is required').toResponse()
    }

    // Check authentication and rate limits
    const session = await auth()
    let clientIP = ''

    if (!session) {
      // Anonymous user rate limiting
      clientIP = getClientIP(request)
      const chatCount = await getChatCountByIP({
        ipAddress: clientIP,
        differenceInHours: 24,
      })

      // Temporarily bypass rate limit for LLAMA testing
      // if (chatCount >= anonymousEntitlements.maxMessagesPerDay) {
      //   return new ChatSDKError('rate_limit:chat').toResponse()
      // }
    }

    console.log('LLAMA API request:', {
      message,
      chatId,
      userId: session?.user?.id || 'anonymous',
      ip: clientIP,
    })

    // Use LLAMA for text generation instead of v0
    const result = await streamText({
      model: llamaModel,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful AI assistant that generates UI components and helps with web development. When asked to create UI components, provide React/Next.js code with Tailwind CSS styling.',
        },
        {
          role: 'user',
          content: message,
        },
      ],
      temperature: 0.7,
      maxTokens: 2000,
    })

    // Log anonymous chat if needed (disabled for testing)
    // if (!session && clientIP) {
    //   await createAnonymousChatLog({
    //     chatId: chatId || `llama-${Date.now()}`,
    //     ipAddress: clientIP,
    //   })
    // }

    // Return the streaming response from LLAMA using AI SDK v5
    // In AI SDK v5, streamText returns an object with textStream property
    const stream = result.textStream
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('LLAMA Chat API Error:', error)

    if (error instanceof Error) {
      return new ChatSDKError('server_error', error.message).toResponse()
    }

    return new ChatSDKError('server_error', 'Failed to process request').toResponse()
  }
}