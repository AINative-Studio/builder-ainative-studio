/**
 * A2UI Polling Endpoint
 *
 * Long-polling alternative to WebSocket for A2UI updates.
 * Useful for environments where WebSocket is not available.
 *
 * @route GET /api/a2ui/poll?chatId=xxx
 */

import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// In-memory message queue (replace with Redis in production)
const messageQueues = new Map<string, any[]>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const chatId = searchParams.get('chatId')
  const timeout = parseInt(searchParams.get('timeout') || '30000', 10)

  if (!chatId) {
    return Response.json(
      { error: 'chatId parameter is required' },
      { status: 400 }
    )
  }

  // Wait for messages with timeout
  const startTime = Date.now()
  const checkInterval = 100 // Check every 100ms

  while (Date.now() - startTime < timeout) {
    const queue = messageQueues.get(chatId)
    if (queue && queue.length > 0) {
      const messages = queue.splice(0) // Get all messages
      return Response.json({
        messages,
        hasMore: false,
      })
    }

    // Wait before checking again
    await new Promise((resolve) => setTimeout(resolve, checkInterval))
  }

  // Timeout - return empty
  return Response.json({
    messages: [],
    hasMore: false,
  })
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const chatId = searchParams.get('chatId')

  if (!chatId) {
    return Response.json(
      { error: 'chatId parameter is required' },
      { status: 400 }
    )
  }

  const message = await request.json()

  // Add message to queue
  if (!messageQueues.has(chatId)) {
    messageQueues.set(chatId, [])
  }
  messageQueues.get(chatId)!.push(message)

  return Response.json({ success: true })
}
