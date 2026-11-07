/**
 * POST /poppy/conversations/{id}/messages — Send Message (#1842).
 * Personal Agent Protocol 0.4.
 *
 * Request:  { id, message: { author: { type: 'agent' }, text } }
 * Response: 202 { conversation_id }
 *
 * Ownership is enforced for real: loadConversation is given the verified
 * (client_id, user_id) from the Poppy-Session, and a conversation belonging
 * to anyone else returns `conversation_not_found` — identical to a
 * genuinely-missing conversation, so this never leaks the existence of
 * another user's conversation (spec: "Any mismatch results in rejection with
 * conversation_not_found").
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  preparePoppyPost,
  finishPoppyPost,
  readMessageText,
  poppyError,
  versionHeaders,
} from '@/lib/poppy/handler'
import { loadConversation, appendEvents, newEventId, type PoppyEvent } from '@/lib/poppy/conversations'
import { answerMessage } from '@/lib/poppy/capability'

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

  // A closed conversation cannot take new messages — report it honestly
  // instead of silently accepting a message nobody will ever read.
  if (conversation.status === 'closed') {
    return poppyError('conversation_closed', 409)
  }

  const text = readMessageText(context.body)
  const events: PoppyEvent[] = [
    {
      id: newEventId(),
      timestamp: new Date().toISOString(),
      type: 'message',
      message: { author: { type: 'agent' }, text },
    },
  ]

  // Real capability: answer from the real docs corpus. A conversation already
  // escalated to a human keeps its needs_human status and gets no automated
  // reply — answering over a pending handoff would be misleading.
  if (conversation.status !== 'needs_human') {
    const answer = answerMessage(text)
    events.push({
      id: newEventId(),
      timestamp: new Date().toISOString(),
      type: 'message',
      message: { author: { type: 'human' }, text: answer.text },
    })
  }

  const updated = await appendEvents(conversation, events)
  if (!updated) {
    return poppyError('temporarily_unavailable', 503, { reason: 'could not persist the message' })
  }

  return finishPoppyPost(context, 202, { conversation_id: conversation.conversationId })
}
