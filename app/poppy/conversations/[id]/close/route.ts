/**
 * POST /poppy/conversations/{id}/close — Close Conversation (#1842).
 * Personal Agent Protocol 0.4.
 *
 * Request:  { id }
 * Response: 202 { conversation_id }
 *
 * Marks the conversation `closed` in ZeroDB and appends a real `closed`
 * event, so a subsequent GET .../events shows the termination in the
 * transcript. After this, the messages and handoff routes return
 * `conversation_closed` (409) rather than silently accepting writes to a
 * finished conversation.
 *
 * Closing an already-closed conversation is idempotent at the protocol level
 * anyway (a retry with the same body `id` replays the stored 202), and a
 * *fresh* close request on a closed conversation also returns 202 rather
 * than an error — the caller's intent is already satisfied, so failing it
 * would be noise.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  preparePoppyPost,
  finishPoppyPost,
  poppyError,
  versionHeaders,
} from '@/lib/poppy/handler'
import { loadConversation, appendEvents, newEventId, type PoppyEvent } from '@/lib/poppy/conversations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: 'POST, OPTIONS', ...versionHeaders() },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params

  const prepared = await preparePoppyPost(request)
  if ('response' in prepared) return prepared.response
  const { context } = prepared

  const conversation = await loadConversation(conversationId, {
    clientId: context.session.clientId,
    userId: context.session.userId,
  })
  if (!conversation) return poppyError('conversation_not_found', 404)

  // Already closed → the caller's intent holds; acknowledge without a second
  // `closed` event cluttering the transcript.
  if (conversation.status === 'closed') {
    return finishPoppyPost(context, 202, { conversation_id: conversation.conversationId })
  }

  const event: PoppyEvent = {
    id: newEventId(),
    timestamp: new Date().toISOString(),
    type: 'closed',
    reason: 'closed by the Personal Agent',
  }

  const updated = await appendEvents(conversation, [event], 'closed')
  if (!updated) {
    return poppyError('temporarily_unavailable', 503, { reason: 'could not close the conversation' })
  }

  return finishPoppyPost(context, 202, { conversation_id: conversation.conversationId })
}
