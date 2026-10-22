/**
 * A2UI Polling Endpoint
 *
 * Long-polling transport for A2UI updates, and the consumer side of the
 * per-chat action queue.
 *
 * #1193: this route used to own a private in-memory `messageQueues` Map that
 * `POST /api/a2ui/action` could not reach, which is why forwarding an action
 * "to the agent" was a no-op. Both routes now share lib/a2ui/action-queue so
 * an action posted to /api/a2ui/action is genuinely drained here.
 *
 * Attaching to this endpoint registers the caller as this chat's agent
 * consumer, which is what makes /api/a2ui/action able to report real
 * delivery instead of guessing.
 *
 * @route GET /api/a2ui/poll?chatId=xxx
 */

import { NextRequest } from 'next/server'
import {
  enqueueAgentMessage,
  subscribeAgentConsumer,
  takePendingActions,
} from '@/lib/a2ui/action-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Upper bound on a client-supplied long-poll window. */
const MAX_POLL_TIMEOUT_MS = 60_000

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const chatId = searchParams.get('chatId')
  const requested = parseInt(searchParams.get('timeout') || '30000', 10)
  const timeout = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 0), MAX_POLL_TIMEOUT_MS)
    : 30000

  if (!chatId) {
    return Response.json(
      { error: 'chatId parameter is required' },
      { status: 400 }
    )
  }

  // Registering before the wait is what lets /api/a2ui/action accept actions
  // for this chat: an agent is now demonstrably listening.
  subscribeAgentConsumer(chatId)

  const startTime = Date.now()
  const checkInterval = 100

  // Drain anything already queued before waiting at all.
  const immediate = takePendingActions(chatId)
  if (immediate.length > 0) {
    return Response.json({ messages: immediate, hasMore: false })
  }

  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval))

    const messages = takePendingActions(chatId)
    if (messages.length > 0) {
      // Keep the registration fresh for the client's next poll.
      subscribeAgentConsumer(chatId)
      return Response.json({ messages, hasMore: false })
    }
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

  let message: any
  try {
    message = await request.json()
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON' },
      { status: 400 }
    )
  }

  const queued = enqueueAgentMessage(chatId, {
    type: message?.type ?? 'state',
    payload: message?.payload ?? message ?? null,
    timestamp: message?.timestamp,
    messageId: message?.messageId,
  })

  return Response.json({ success: true, messageId: queued.messageId })
}
