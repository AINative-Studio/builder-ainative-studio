/**
 * GET /poppy/conversations/{id}/events — Read Events (#1842).
 * Personal Agent Protocol 0.4.
 *
 * Response: 200 { conversation_id, events[], state, cursor }
 *
 * Query params (spec): `cursor` (read only events after it; without one it
 * reads from the start) and `wait` (max seconds to hold the response).
 *
 * ── STREAMING SCOPE, stated plainly ───────────────────────────────────────
 * This is a real non-streaming poll. `cursor` is fully implemented — it
 * genuinely resumes after the named event, which is what makes repeated
 * polling correct and non-duplicating. `wait` is parsed and VALIDATED but
 * deliberately not honored as a long-poll hold: Builder's replies are
 * generated synchronously inside the POST that triggers them (pure local
 * retrieval, no queue, no async worker), so by the time an agent can issue
 * this GET the reply is already stored and there is nothing to wait for.
 * Holding the connection would add latency and burn a serverless execution
 * slot to return the identical payload. The spec permits returning
 * immediately. If Builder later gains genuinely asynchronous events (a real
 * human replying to a handoff), `wait` becomes meaningful and should then be
 * implemented for real rather than left as a no-op.
 *
 * A GET carries no body `id`, so request deduplication does not apply — it is
 * a safe, idempotent read by definition.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyPoppySession, checkProtocolVersion, SUPPORTED_PROTOCOL_VERSION } from '@/lib/poppy/session'
import { poppyError, poppyJson, storageUnavailable, versionHeaders } from '@/lib/poppy/handler'
import { loadConversation } from '@/lib/poppy/conversations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Spec example uses `wait=10`; cap it so a caller can't pin a worker open. */
const MAX_WAIT_SECONDS = 60

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: 'GET, OPTIONS', ...versionHeaders() },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params

  if (!checkProtocolVersion(request.headers.get('poppy-version')).ok) {
    return poppyError('version_mismatch', 409, { protocol_version: SUPPORTED_PROTOCOL_VERSION })
  }

  const verified = await verifyPoppySession(request.headers.get('poppy-session'), {
    method: request.method,
    url: request.url,
  })
  if (!verified.ok) {
    return poppyError(verified.code, 400, { reason: verified.reason })
  }

  // Checked only after the session verifies, so an unauthenticated caller
  // never learns anything about Builder's internal configuration state.
  const unavailable = storageUnavailable()
  if (unavailable) return unavailable

  const url = new URL(request.url)
  const waitParam = url.searchParams.get('wait')
  if (waitParam !== null) {
    const wait = Number(waitParam)
    if (!Number.isFinite(wait) || wait < 0 || wait > MAX_WAIT_SECONDS) {
      return poppyError('invalid_request', 400, {
        reason: `wait must be a number between 0 and ${MAX_WAIT_SECONDS}`,
      })
    }
  }

  const conversation = await loadConversation(conversationId, {
    clientId: verified.session.clientId,
    userId: verified.session.userId,
  })
  if (!conversation) return poppyError('conversation_not_found', 404)

  // Cursor: return only events AFTER the named one. An unknown cursor is
  // treated as "from the start" rather than an error — the spec's own default
  // when no cursor is supplied, and the safe choice (an agent never silently
  // loses transcript because it presented a stale cursor).
  const cursor = url.searchParams.get('cursor')
  let events = conversation.events
  if (cursor) {
    const index = events.findIndex((e) => e.id === cursor)
    if (index >= 0) events = events.slice(index + 1)
  }

  return poppyJson(
    {
      conversation_id: conversation.conversationId,
      events,
      state: { status: conversation.status, needs_human: conversation.status === 'needs_human' },
      // The cursor an agent should present next time: the last event it has
      // now seen. Falls back to the incoming cursor when this page is empty,
      // so repeated polling of an idle conversation doesn't rewind.
      cursor: events.length > 0 ? events[events.length - 1].id : cursor || null,
    },
    200,
  )
}
