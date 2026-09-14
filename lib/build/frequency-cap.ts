/**
 * Generic per-key frequency cap (#742), extracted as a small, reusable helper
 * so any future proactive-outreach caller — starting with this issue's own
 * nightly-loop comms policy, and expected to be adopted by #743's agile-
 * standup / pair-programming digest cron — shares ONE rate-limit primitive
 * instead of each hand-rolling its own sliding-window map.
 *
 * Deliberately NOT the same code as lib/build/otp.ts's `checkOtpRateLimit`:
 * that one is registration-specific (phone + IP, short window, multiple
 * attempts allowed per window). This is the more general shape a periodic
 * OUTREACH cap needs — "at most once per key within a window" — e.g. "no
 * more than one proactive comms send per company per day," regardless of how
 * many times the nightly loop itself runs that day. Same in-memory
 * per-process posture as otp.ts's limiter (acceptable for Builder's current
 * single-instance deploy; a future multi-instance deploy should move this to
 * the same Upstash-backed limiter lib/middleware/rate-limit.ts already wires
 * up — noted there too).
 */

const lastSeenByKey = new Map<string, number>()

export interface FrequencyCapResult {
  ok: boolean
  reason?: 'rate_limited'
  /** ms remaining until this key is allowed again, only set when blocked. */
  retryAfterMs?: number
}

/**
 * Check whether `key` may fire again given `windowMs` since its last allowed
 * fire, WITHOUT recording a new fire. Use this to preview before doing other
 * work (e.g. before composing an email) — pair with `recordFrequencyCapHit`
 * once the send actually succeeds, so a failed send doesn't consume the cap.
 */
export function checkFrequencyCap(key: string, windowMs: number): FrequencyCapResult {
  const last = lastSeenByKey.get(key)
  if (last === undefined) return { ok: true }
  const elapsed = Date.now() - last
  if (elapsed < windowMs) {
    return { ok: false, reason: 'rate_limited', retryAfterMs: windowMs - elapsed }
  }
  return { ok: true }
}

/** Record that `key` fired now, starting a fresh `windowMs` cooldown. */
export function recordFrequencyCapHit(key: string): void {
  lastSeenByKey.set(key, Date.now())
}

/**
 * Convenience wrapper: checks the cap and, if allowed, immediately records
 * the hit (atomic from the caller's point of view) — the common case for a
 * caller that always wants to consume the cap the moment it's granted rather
 * than only after a subsequent action succeeds.
 */
export function tryConsumeFrequencyCap(key: string, windowMs: number): FrequencyCapResult {
  const result = checkFrequencyCap(key, windowMs)
  if (result.ok) recordFrequencyCapHit(key)
  return result
}

/** Test-only reset of the in-memory store. */
export function __resetFrequencyCapForTests(): void {
  lastSeenByKey.clear()
}
