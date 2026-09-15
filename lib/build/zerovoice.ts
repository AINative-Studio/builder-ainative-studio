/**
 * ZeroVoice provisioning client (#415, child of #414).
 *
 * Unlike every other primitive provisioned in this pass, ZeroVoice numbers
 * carry a REAL, non-trivial recurring cost (~$1.15/month per number + usage
 * — confirmed via ZeroVoice's own ops docs) and its own live infra (a real
 * Twilio purchase, confirmed via source read of
 * AINative-Studio/ZeroVoice's app/routers/numbers.py::purchase_number_new).
 * This is why it is NOT auto-provisioned in provision/route.ts's checkout
 * flow the way ZeroPipeline/ZeroCommerce/ZeroForms/AgentFlow are — it is
 * gated behind ZEROVOICE_PROVISION_ENABLED (default off, mirrors
 * railwayDeployEnabled()'s pattern), paid-tier only, and requires an
 * explicit founder-triggered action (a real button click), never something
 * that fires automatically on every paid checkout.
 *
 * Real, confirmed contract (see #415, verified against ZeroVoice's live
 * openapi.json AND its real router source, not just docs):
 *   1. POST /api/v1/numbers/search
 *      body: { country: string, number_type: 'local'|'toll_free'|'mobile',
 *              area_code?, contains?, limit? (default 20, max 50) }
 *      → { available_numbers: [{ phone_number, friendly_name, ... }], total_count }
 *   2. POST /api/v1/numbers/purchase
 *      body: { phone_number: string, friendly_name? }
 *      → { number: { id, e164, friendly_name, type, status, capabilities,
 *                     purchase_date, created_at, twilio_sid }, message }
 *   Auth: same unified AINative founder JWT bearer used by
 *   zeropipeline.ts/zerocommerce.ts/zeroforms.ts/agentflow.ts.
 *
 * IDEMPOTENCY — real, confirmed risk, handled here (#415's own open
 * question): the real API has NO Idempotency-Key support anywhere (checked
 * exhaustively against the live openapi.json — zero mentions), and its
 * purchase handler (read directly from source) does a real Twilio purchase
 * with no pre-existing-number check of its own. A naive retry on a
 * transient failure would genuinely buy and bill a SECOND number. This
 * client checks GET /api/v1/numbers/list for an existing number for this
 * tenant BEFORE ever calling search+purchase, and treats an existing number
 * as success rather than provisioning a duplicate.
 */

const ZV_BASE = process.env.ZEROVOICE_API_URL || 'https://zerovoice-production.up.railway.app/api/v1'

/**
 * Cost-safety gate (#415 requirement 2) — mirrors railwayDeployEnabled()'s
 * pattern exactly: a real, non-trivial recurring cost must be opt-in at the
 * environment level, default OFF, independent of and in addition to the
 * paid-tier + explicit-founder-action checks the caller (the connect route)
 * separately enforces.
 */
export function zeroVoiceProvisionEnabled(): boolean {
  return process.env.ZEROVOICE_PROVISION_ENABLED === 'true'
}

export interface ZeroVoiceResult {
  ok: boolean
  numberId?: string
  e164?: string
  reason?: string
  status?: number
}

interface ExistingNumber {
  id: string
  e164: string
  status: string
}

/**
 * Check whether this tenant already has a real ZeroVoice number provisioned.
 * Returns the first one found (a company only ever needs one), or null on
 * any failure/absence — never throws. This is the application-level
 * idempotency guard the real API doesn't provide itself.
 */
async function findExistingNumber(jwt: string): Promise<ExistingNumber | null> {
  try {
    const res = await fetch(`${ZV_BASE}/numbers/list?limit=1`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` },
      // ZeroVoice's own AINative-token fallback (its #612 fix) can now make
      // up to 3 real attempts against core with backoff (0.5s + 1.5s) before
      // answering — worst case ~26s. 15s here would abort before ZeroVoice
      // even finishes retrying, surfacing OUR OWN timeout as a false
      // "search threw" failure instead of the real, honest upstream answer.
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const items = Array.isArray(data?.items) ? data.items : []
    const first = items[0]
    if (!first?.id || !first?.e164) return null
    return { id: String(first.id), e164: String(first.e164), status: String(first.status || '') }
  } catch {
    return null
  }
}

/**
 * Real result of a number search — distinguishes a genuine empty result
 * (ZeroVoice answered, no numbers matched) from an auth/infra failure (a
 * non-2xx response or a thrown/aborted request). Collapsing these into the
 * same "no numbers found" outcome was a real bug: a live 401 from
 * ZeroVoice's own auth layer (confirmed live, 2026-09-14 — see ZeroVoice#612)
 * was silently reported to founders as "no available numbers," masking a
 * real, fixable auth failure as if it were a genuine inventory gap.
 */
interface SearchResult {
  phoneNumber: string | null
  /** Present only when the search itself failed (not a genuine empty result). */
  failureReason?: string
}

/**
 * Search for one available number matching the requested country/type.
 * Never throws — a failure is reported via `failureReason`, distinct from a
 * genuine empty result (`phoneNumber: null`, no `failureReason`).
 */
async function searchOneAvailableNumber(
  jwt: string,
  countryCode: string,
  type: 'local' | 'toll_free' | 'mobile',
): Promise<SearchResult> {
  try {
    const res = await fetch(`${ZV_BASE}/numbers/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: countryCode, number_type: type, limit: 1 }),
      // Same real reason as findExistingNumber's timeout above — ZeroVoice's
      // own AINative-verify fallback (#612) can legitimately take ~26s worst
      // case with its own retries before answering.
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[zerovoice] search failed status=${res.status} body=${body.slice(0, 500)}`)
      return { phoneNumber: null, failureReason: `search_failed_${res.status}` }
    }
    const data = await res.json().catch(() => null)
    const first = Array.isArray(data?.available_numbers) ? data.available_numbers[0] : null
    const phoneNumber = first?.phone_number
    if (!phoneNumber) {
      console.warn(`[zerovoice] search returned 2xx but no usable number: ${JSON.stringify(data).slice(0, 500)}`)
    }
    return { phoneNumber: typeof phoneNumber === 'string' && phoneNumber ? phoneNumber : null }
  } catch (e: any) {
    console.error(`[zerovoice] search threw: ${String(e?.message || e).slice(0, 300)}`)
    return { phoneNumber: null, failureReason: `search_threw` }
  }
}

/**
 * Provision (idempotently) a real ZeroVoice phone number for a company using
 * the founder's JWT. Never throws — a failure (auth, no available numbers,
 * a real API error) is surfaced as a structured, honest result so the
 * caller can leave the card simulated rather than fabricate success.
 *
 * REAL RECURRING COST: every successful call to this function that returns
 * a NEW number (not an existing one) incurs real, ongoing billing. Callers
 * MUST gate this behind explicit founder confirmation and the paid-tier +
 * ZEROVOICE_PROVISION_ENABLED checks — this function itself does not
 * enforce those, by design (it's a pure provisioning client, same as every
 * other primitive client in this codebase; the gating is the caller's
 * responsibility, matching how railwayDeployEnabled() callers gate
 * separately from the deploy client itself).
 */
export async function provisionZeroVoiceNumber(
  jwt: string,
  slug: string,
  countryCode: string = 'US',
  type: 'local' | 'toll_free' | 'mobile' = 'local',
): Promise<ZeroVoiceResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }

  // Idempotency guard: an existing number for this tenant is success, never
  // a reason to purchase a second one.
  const existing = await findExistingNumber(jwt)
  if (existing) {
    return { ok: true, numberId: existing.id, e164: existing.e164 }
  }

  const searchResult = await searchOneAvailableNumber(jwt, countryCode, type)
  if (!searchResult.phoneNumber) {
    // Preserve the real reason when the search itself failed (auth/infra) —
    // never report a genuine failure as if it were an honest empty result.
    return { ok: false, reason: searchResult.failureReason || 'no_available_numbers' }
  }
  const phoneNumber = searchResult.phoneNumber

  try {
    const res = await fetch(`${ZV_BASE}/numbers/purchase`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phoneNumber, friendly_name: slug || undefined }),
      // Same real reason as findExistingNumber/searchOneAvailableNumber's
      // timeouts above — ZeroVoice's own AINative-verify fallback (#612) can
      // legitimately take ~26s worst case with its own retries.
      signal: AbortSignal.timeout(35000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.message || data?.detail || data?.error || res.status).slice(0, 160) }
    }
    const number = data?.number
    if (!number?.id || !number?.e164) {
      return { ok: false, reason: 'purchase_response_missing_number' }
    }
    return { ok: true, numberId: String(number.id), e164: String(number.e164), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}

export interface ZeroVoiceSmsResult {
  ok: boolean
  sid?: string
  reason?: string
  status?: number
}

export interface ZeroVoiceCallResult {
  ok: boolean
  callId?: string
  reason?: string
  status?: number
}

/**
 * Send a real SMS through ZeroVoice on a company's behalf (#733, child of
 * #414). Real, confirmed contract (verified live against ZeroVoice's own
 * openapi.json):
 *   POST /api/v1/sms/send
 *   body: { from_number, to_number, body, media_urls?, status_callback_url?,
 *           metadata? }
 *   → 2xx response body carries the created message (its id/sid field name
 *     is read defensively below since the live schema wasn't pinned down to
 *     one literal key in the audit — see the id/sid/message_sid fallback).
 *
 * `fromE164` MUST be one of the company's own provisioned ZeroVoice numbers
 * (never a shared/arbitrary number) — enforcing that is the caller's job
 * (see app/api/build/company-comms/route.ts, which resolves it from the
 * registry rather than trusting client input). This function itself never
 * throws and never fabricates success: any missing field, non-2xx response,
 * or network error surfaces as a structured `{ok:false, reason}`, mirroring
 * `provisionZeroVoiceNumber`'s own error-handling style exactly.
 */
export async function sendZeroVoiceSms(
  jwt: string,
  fromE164: string,
  toE164: string,
  body: string,
): Promise<ZeroVoiceSmsResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }
  if (!fromE164) return { ok: false, reason: 'no_from_number' }
  if (!toE164) return { ok: false, reason: 'no_to_number' }
  if (!body || !body.trim()) return { ok: false, reason: 'empty_body' }

  try {
    const res = await fetch(`${ZV_BASE}/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_number: fromE164, to_number: toE164, body }),
      // Same real reason as findExistingNumber/searchOneAvailableNumber's
      // timeouts above — ZeroVoice's own AINative-verify fallback (#612) can
      // legitimately take ~26s worst case with its own retries.
      signal: AbortSignal.timeout(35000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: String(data?.message || data?.detail || data?.error || res.status).slice(0, 160),
      }
    }
    const sid = data?.sid || data?.id || data?.message_sid
    if (!sid) {
      return { ok: false, reason: 'send_response_missing_sid', status: res.status }
    }
    return { ok: true, sid: String(sid), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}

/**
 * Place a real outbound call through ZeroVoice on a company's behalf (#733,
 * child of #414). Real, confirmed contract (verified live against
 * ZeroVoice's own openapi.json):
 *   POST /api/v1/calls/outbound
 *   body: { from_number, to_number, record?, status_callback_url?,
 *           queue_id?, metadata? }
 *   → { id, from_number, to_number, direction, status, started_at,
 *       ended_at, ... }
 *
 * Same constraints as sendZeroVoiceSms: `fromE164` must be the company's own
 * provisioned ZeroVoice number (caller's responsibility to enforce), never
 * throws, never fabricates success.
 */
export async function makeZeroVoiceCall(
  jwt: string,
  fromE164: string,
  toE164: string,
  opts?: { record?: boolean },
): Promise<ZeroVoiceCallResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }
  if (!fromE164) return { ok: false, reason: 'no_from_number' }
  if (!toE164) return { ok: false, reason: 'no_to_number' }

  try {
    const res = await fetch(`${ZV_BASE}/calls/outbound`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_number: fromE164,
        to_number: toE164,
        ...(opts?.record ? { record: true } : {}),
      }),
      // Same real reason as findExistingNumber/searchOneAvailableNumber's
      // timeouts above — ZeroVoice's own AINative-verify fallback (#612) can
      // legitimately take ~26s worst case with its own retries.
      signal: AbortSignal.timeout(35000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: String(data?.message || data?.detail || data?.error || res.status).slice(0, 160),
      }
    }
    if (!data?.id) {
      return { ok: false, reason: 'call_response_missing_id', status: res.status }
    }
    return { ok: true, callId: String(data.id), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
