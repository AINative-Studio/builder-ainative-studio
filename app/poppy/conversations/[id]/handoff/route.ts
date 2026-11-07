/**
 * POST /poppy/conversations/{id}/handoff — Handoff Request (#1842).
 * Personal Agent Protocol 0.4.
 *
 * Request:  { id, message?: { author, text } }
 * Response: 202 { conversation_id }
 *
 * ── WHAT THIS REALLY DOES, AND WHAT IT DOES NOT ───────────────────────────
 * Builder has no live human support desk, ticketing system, or on-call queue
 * in this repo to route an escalation into — checked: the only notification
 * machinery that exists is lib/jobs/alerting (an ops/metrics cron) and
 * transactional email helpers, neither of which is a support inbox. So this
 * route does NOT pretend a human has been paged.
 *
 * What it really does, all of it verifiable:
 *   - flips the conversation's stored status to `needs_human` in ZeroDB,
 *   - appends a real `handoff_requested` event to the transcript carrying
 *     the agent's stated reason,
 *   - stops the automated doc-answer replies for that conversation (see the
 *     messages route — answering over a pending escalation would be
 *     misleading),
 *   - and logs it at warn level through the repo's real logger, so it lands
 *     in Railway logs where a human actually looks.
 *
 * The flag is genuinely surfaced: GET .../events returns
 * `state.needs_human: true`, so the asking agent can truthfully tell its
 * human "this is now queued for a person". Wiring it to a real support
 * channel is a follow-up that needs a support channel to exist first.
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
import { logger } from '@/lib/logger'

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
  if (conversation.status === 'closed') return poppyError('conversation_closed', 409)

  const reason = readMessageText(context.body)
  const event: PoppyEvent = {
    id: newEventId(),
    timestamp: new Date().toISOString(),
    type: 'handoff_requested',
    reason: reason || 'no reason given',
    ...(reason ? { message: { author: { type: 'agent' as const }, text: reason } } : {}),
  }

  const updated = await appendEvents(conversation, [event], 'needs_human')
  if (!updated) {
    return poppyError('temporarily_unavailable', 503, { reason: 'could not record the handoff' })
  }

  // Real, human-visible signal: Railway logs. Not a claim that anyone was paged.
  logger.warn('[poppy] handoff requested — conversation flagged needs_human', {
    conversationId: conversation.conversationId,
    clientId: context.session.clientId,
    reason: reason || 'no reason given',
  })

  return finishPoppyPost(context, 202, { conversation_id: conversation.conversationId })
}
