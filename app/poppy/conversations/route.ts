/**
 * POST /poppy/conversations — Start Conversation (#1842).
 * Personal Agent Protocol 0.4, https://personalagentprotocol.org/docs/0.4/spec
 *
 * This is the real endpoint advertised as `agent.protocols[].endpoint` in
 * /.well-known/poppy.json. An apex (non-/api) route, matching the pattern
 * already established by /checkout_sessions and /openapi.json for
 * protocol-mandated paths that external agents resolve directly.
 *
 * Request:  { id, message: { author: { type: 'agent' }, text, context? } }
 * Response: 201 { conversation_id }
 *
 * The agent's opening message is answered for real from Builder's live
 * guides + Help Center corpus (lib/poppy/capability.ts), and the answer is
 * stored as a `human`-authored event on the conversation so the very next
 * GET .../events returns it. "human" is the correct author type here per the
 * spec's two-value enum: the Company side of a Poppy conversation is the
 * non-agent party. The reply is real published documentation copy, not a
 * model generation.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  preparePoppyPost,
  finishPoppyPost,
  readMessageText,
  poppyError,
  versionHeaders,
} from '@/lib/poppy/handler'
import { createConversation, newEventId, type PoppyEvent } from '@/lib/poppy/conversations'
import { answerMessage } from '@/lib/poppy/capability'

export const runtime = 'nodejs'
/** Never cached: every POST mutates real stored state. */
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: 'POST, OPTIONS', ...versionHeaders() },
  })
}

export async function POST(request: NextRequest) {
  const prepared = await preparePoppyPost(request)
  if ('response' in prepared) return prepared.response
  const { context } = prepared

  const text = readMessageText(context.body)
  const now = new Date().toISOString()

  const events: PoppyEvent[] = [
    {
      id: newEventId(),
      timestamp: now,
      type: 'message',
      message: { author: { type: 'agent' }, text },
    },
  ]

  // Real capability: answer from the real docs corpus.
  const answer = answerMessage(text)
  events.push({
    id: newEventId(),
    timestamp: new Date().toISOString(),
    type: 'message',
    message: { author: { type: 'human' }, text: answer.text },
  })

  const conversation = await createConversation({
    clientId: context.session.clientId,
    userId: context.session.userId,
    events,
  })

  if (!conversation) {
    // Storage genuinely failed — report it honestly rather than returning a
    // conversation_id that was never persisted and would 404 on the next call.
    return poppyError('temporarily_unavailable', 503, {
      reason: 'could not persist the conversation',
    })
  }

  return finishPoppyPost(context, 201, { conversation_id: conversation.conversationId })
}
