/**
 * ACP (Agentic Commerce Protocol) outbound request signing (#1838) — the
 * Builder-side counterpart to core's `app.services.acp_signature` (core#9249,
 * G7). Builder forwards POST /checkout_sessions and
 * POST /agentic_commerce/delegate_payment requests to core's real,
 * Stripe-backed endpoints, and core requires every such request to carry a
 * `Signature` + `Timestamp` header pair before it will touch Stripe at all.
 *
 * MUST produce the exact same signature core's own `verify_acp_signature`
 * expects, or every forwarded request 401s. Read directly from core's
 * source (src/backend/app/services/acp_signature.py) rather than guessed:
 *
 *   canonical = f"{method.upper()}\n{path}\n{timestamp}\n".encode() + body
 *   signature = "sha256=" + hmac_sha256_hex(secret, canonical)
 *
 * `path` is the path CORE receives the request at (e.g. "/checkout_sessions"),
 * not whatever path Builder's own route lives at — the signature is only
 * valid for the literal upstream path, since that's what core's
 * `request.url.path` resolves to on its side.
 *
 * ACP_SIGNING_SECRET is the SAME shared secret core's ACP_SIGNING_SECRET
 * env var holds — per core's own acp_signature.py docstring, core has no
 * per-caller secret registry yet (a documented, known gap on core's side,
 * not something Builder can work around). Builder is a privileged internal
 * caller here (same org, same account), analogous to how it already holds
 * AINATIVE_API_KEY for other primitives.
 */

import { createHmac } from 'crypto'

export function signAcpRequest(params: {
  method: string
  path: string
  timestampSeconds: number
  body: string
}): { signature: string; timestamp: string } {
  const secret = process.env.ACP_SIGNING_SECRET || ''
  const timestamp = String(params.timestampSeconds)
  const canonicalPrefix = `${params.method.toUpperCase()}\n${params.path}\n${timestamp}\n`
  const canonical = Buffer.concat([Buffer.from(canonicalPrefix, 'utf-8'), Buffer.from(params.body, 'utf-8')])
  const digest = createHmac('sha256', secret).update(canonical).digest('hex')
  return { signature: `sha256=${digest}`, timestamp }
}

export function isAcpSigningConfigured(): boolean {
  return !!process.env.ACP_SIGNING_SECRET
}
