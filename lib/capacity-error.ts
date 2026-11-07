/**
 * Upstream-capacity error detection for multi-pass chunk generation.
 *
 * Real incident, 2026-11-04 (#1802): a Bedrock daily-token-quota 429 hit
 * EVERY phase of a multi-pass e-commerce product generation. The fallback-
 * model retry (#1804, multi-pass-generator.ts's RATE_LIMIT_FALLBACK_MODELS)
 * already stops this from being a total loss in most cases — but when every
 * phase (including every fallback attempt) is STILL rate-limit/overload
 * shaped, chunk-merger.ts's mergeChunks() throws a generic "Core structure
 * (Phase 1) failed or is missing" error that chat-ws/route.ts's outer catch
 * turned into an opaque `{ error: 'Stream failed' }` SSE event — giving the
 * founder zero indication this was a platform capacity limit, not their idea
 * or a code bug (the exact gap #1802 asks to close, mirroring the existing
 * `quota_exhausted` (402/billing) short-circuit in lib/quota-error.ts).
 */

/** Marker property set on the error thrown by chat-ws/route.ts when every
 *  chunk phase failed in a rate-limit/overload-shaped way, so the outer
 *  catch can tell this apart from a genuine code/validation failure without
 *  parsing the error message text. */
export const CAPACITY_EXHAUSTED_CODE = 'generation_capacity_exhausted'

/** Returns true for an error tagged with CAPACITY_EXHAUSTED_CODE. */
export function isCapacityExhaustedError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  return (err as { code?: unknown }).code === CAPACITY_EXHAUSTED_CODE
}

/** Throw this (via `throw new Error(...)` + assigning `.code`, done by
 *  makeCapacityExhaustedError below) instead of letting chunk-merger's
 *  generic "cannot merge" error propagate, whenever every generated chunk
 *  failed in a rate-limit/overload-shaped way. */
export function makeCapacityExhaustedError(): Error {
  const err = new Error('All generation phases failed due to upstream capacity limits') as Error & { code: string }
  err.code = CAPACITY_EXHAUSTED_CODE
  return err
}

/** User-facing message when generation fails because every attempt (primary
 *  model and every fallback) hit upstream rate limiting/overload — distinct
 *  from QUOTA_USER_MESSAGE (lib/quota-error.ts), which is for the account's
 *  OWN monthly token limit (402/billing), a different, founder-actionable
 *  cause. This one is purely upstream capacity: nothing the founder can fix
 *  by upgrading, so the message says to retry instead. */
export const CAPACITY_USER_MESSAGE =
  "We're at capacity right now — every attempt to build this hit a temporary upstream limit. Nothing is wrong with your idea; please try again in a few minutes."
