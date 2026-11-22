/**
 * CORS headers for Builder's ACP (Agentic Commerce Protocol) endpoints
 * (#2173, AX/agent-readiness scan 2026-11-19; widened #2183; corrected
 * against the real checker #2205).
 *
 * Both `/checkout_sessions` and `/agentic_commerce/delegate_payment` accept
 * ANY caller — there is no per-caller auth check on the incoming request
 * (Builder signs the OUTBOUND request to core itself, via
 * lib/build/acp-signature.ts; the caller never sends that signature).
 * `Access-Control-Allow-Origin: *` is therefore the honest value, matching
 * these routes' existing "anonymous caller" posture — never a credentialed
 * CORS response (which would also require dropping `*` for a reflected
 * origin + `Access-Control-Allow-Credentials`, a different trust model this
 * endpoint doesn't have).
 *
 * #2205 — #2173/#2183 both guessed at the required header list (grepping
 * this repo's own routes, then adding `Authorization` defensively) without
 * ever finding the REAL list the AX scanner checks against. Found by
 * reading the actual checker directly: core's
 * `app/services/ax_audit_service.py::check_acp`'s
 * `_ACP_REQUIRED_HEADERS = ("authorization", "api-version", "signature",
 * "timestamp", "idempotency-key")` — five specific headers, checked via
 * `all(h in allow_headers for h in _ACP_REQUIRED_HEADERS)` against the
 * lowercased `Access-Control-Allow-Headers` value. The prior list was
 * missing `Api-Version` and `Signature` entirely, which is the full,
 * confirmed reason this check kept failing after #2173/#2183 both
 * deployed and were independently verified live. `Content-Type` is kept
 * too — not required by this specific check, but still genuinely useful
 * to advertise since both routes' POST handlers accept a JSON body.
 */
export const ACP_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Authorization, Api-Version, Signature, Timestamp',
  'Access-Control-Max-Age': '600',
}
