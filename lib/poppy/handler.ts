/**
 * Shared request plumbing for the Poppy conversation routes (#1842).
 *
 * Every Poppy POST follows the same real sequence, so it lives here once
 * rather than being re-implemented (and drifting) across five routes:
 *
 *   1. Poppy-Version check            → 409 version_mismatch
 *   2. Poppy-Session verification     → 400 invalid_session / session_ended
 *   3. Body parse + `id` presence     → 400 invalid_request
 *   4. Request dedup lookup           → replay original, or 400 request_id_conflict
 *   5. (caller's real work)
 *   6. Record the response for replay
 *
 * These routes are PUBLIC and will be hit by arbitrary external callers as
 * soon as poppy.json is published, so every path returns structured JSON with
 * a spec-named error code and the correct status, and nothing here throws on
 * malformed input.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPoppySession,
  checkProtocolVersion,
  SUPPORTED_PROTOCOL_VERSION,
  type PoppySession,
  type JwksResolver,
} from '@/lib/poppy/session'
import {
  checkRequest,
  recordRequest,
  hashBody,
  isPoppyStorageConfigured,
} from '@/lib/poppy/conversations'

/** Spec errors are a flat `{ "error": "<code>" }` body. */
export function poppyError(
  code: string,
  status: number,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: code, ...extra }, { status, headers: versionHeaders() })
}

export function versionHeaders(): Record<string, string> {
  return { 'Poppy-Version': SUPPORTED_PROTOCOL_VERSION, 'Cache-Control': 'no-store' }
}

export function poppyJson(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: versionHeaders() })
}

/** Max accepted body size, to keep a hostile caller from ballooning memory. */
const MAX_BODY_BYTES = 64 * 1024
/** Max accepted message text; longer is truncated, not rejected. */
export const MAX_TEXT_LENGTH = 4000

export interface PoppyPostContext {
  session: PoppySession
  /** Parsed JSON body. */
  body: Record<string, unknown>
  /** The agent-chosen request id (spec: unique per User). */
  requestId: string
  /** Path used for dedup matching — no query string, per spec. */
  path: string
  bodyHash: string
}

/**
 * Run the common preamble for a Poppy POST. Returns either a ready-to-send
 * response (error or idempotent replay) or the verified context to work with.
 */
export async function preparePoppyPost(
  request: NextRequest,
  resolveJwks?: JwksResolver,
): Promise<{ response: NextResponse } | { context: PoppyPostContext }> {
  // 1. Protocol version
  if (!checkProtocolVersion(request.headers.get('poppy-version')).ok) {
    return {
      response: poppyError('version_mismatch', 409, {
        protocol_version: SUPPORTED_PROTOCOL_VERSION,
      }),
    }
  }

  // 2. Session (real ES256 + delegation-chain verification)
  const url = new URL(request.url)
  const verified = await verifyPoppySession(
    request.headers.get('poppy-session'),
    { method: request.method, url: request.url },
    resolveJwks,
  )
  if (!verified.ok) {
    // `reason` is diagnostic detail alongside the spec-named code — it helps a
    // real integrator debug without changing the machine-readable contract.
    return { response: poppyError(verified.code, 400, { reason: verified.reason }) }
  }

  // 2b. Storage. Checked only AFTER the session verifies, so an
  // unauthenticated caller never learns anything about Builder's internal
  // configuration state — an authenticated agent gets the honest 503.
  const unavailable = storageUnavailable()
  if (unavailable) return { response: unavailable }

  // 3. Body
  const raw = await request.text().catch(() => '')
  if (raw.length > MAX_BODY_BYTES) {
    return { response: poppyError('invalid_request', 413, { reason: 'request body too large' }) }
  }
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    body = parsed as Record<string, unknown>
  } catch {
    return { response: poppyError('invalid_request', 400, { reason: 'body must be a JSON object' }) }
  }

  const requestId = typeof body.id === 'string' ? body.id.trim() : ''
  if (!requestId) {
    return { response: poppyError('invalid_request', 400, { reason: 'body.id is required' }) }
  }

  // 4. Dedup — spec: match on id + path + body, ignoring query parameters
  const path = url.pathname
  const bodyHash = hashBody(raw)
  const outcome = await checkRequest({
    clientId: verified.session.clientId,
    userId: verified.session.userId,
    requestId,
    path,
    bodyHash,
  })
  if (outcome.kind === 'replay') {
    return { response: poppyJson(outcome.body, outcome.status) }
  }
  if (outcome.kind === 'conflict') {
    return { response: poppyError('request_id_conflict', 400) }
  }

  return { context: { session: verified.session, body, requestId, path, bodyHash } }
}

/** Store the response so an identical retry replays it instead of reprocessing. */
export async function finishPoppyPost(
  context: PoppyPostContext,
  status: number,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  await recordRequest({
    clientId: context.session.clientId,
    userId: context.session.userId,
    requestId: context.requestId,
    path: context.path,
    bodyHash: context.bodyHash,
    responseStatus: status,
    responseBody: body,
  })
  return poppyJson(body, status)
}

/** Pull and bound the agent's message text from a request body. */
export function readMessageText(body: Record<string, unknown>): string {
  const message = body.message
  if (!message || typeof message !== 'object') return ''
  const text = (message as Record<string, unknown>).text
  return typeof text === 'string' ? text.slice(0, MAX_TEXT_LENGTH) : ''
}

/** Honest 503 when ZeroDB isn't configured — never a fabricated success. */
export function storageUnavailable(): NextResponse | null {
  if (isPoppyStorageConfigured()) return null
  return poppyError('temporarily_unavailable', 503, {
    reason: 'conversation storage is not configured',
  })
}
