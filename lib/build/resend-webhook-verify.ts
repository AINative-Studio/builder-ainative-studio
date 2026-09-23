/**
 * Resend webhook signature verification (#840).
 *
 * Resend signs its webhook deliveries using Svix (confirmed against Resend's
 * own current docs, resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 * — Resend's own SDK example is literally `resend.webhooks.verify(...)`,
 * documented as a thin wrapper over the `svix` library's own manual-
 * verification algorithm, resend.com/docs/dashboard/webhooks/introduction
 * confirms every delivery carries a `svix-id` header). Rather than pull in
 * the `svix` npm package as a new dependency for three headers' worth of
 * HMAC-SHA256, this reimplements Svix's own documented, publicly-specified
 * manual-verification algorithm (docs.svix.com/receiving/verifying-payloads/
 * how-manual) directly against Node's built-in `crypto` — the same "no new
 * dependency, verify the documented primitive directly" approach this
 * codebase already takes for its OTHER webhook signature schemes (see
 * app/api/webhooks/ad-budget-confirmed/route.ts's own HMAC verification).
 *
 * Algorithm (verified against Svix's own docs, not guessed):
 *  1. The webhook secret is `whsec_<base64>` — strip the prefix, base64-decode
 *     the rest to get the raw HMAC key bytes.
 *  2. The signed content is the raw bytes `${svix-id}.${svix-timestamp}.${body}`
 *     (dot-joined, RAW body — never a re-serialized JSON.stringify, which can
 *     silently produce different bytes than what was actually signed).
 *  3. HMAC-SHA256(key, signedContent), base64-encoded.
 *  4. `svix-signature` is a SPACE-delimited list of `v1,<base64sig>` entries
 *     (Svix supports signature rotation) — the computed signature must match
 *     AT LEAST ONE entry, compared with a constant-time comparison.
 *
 * Also enforces Svix's own recommended timestamp tolerance (5 minutes) as
 * defense-in-depth against a replayed-but-otherwise-valid-signature delivery,
 * same posture as ad-budget-confirmed's MAX_AGE_SECONDS check.
 */

import { createHmac, timingSafeEqual } from 'crypto'

const TOLERANCE_SECONDS = 5 * 60

export interface SvixHeaders {
  id: string | null
  timestamp: string | null
  signature: string | null
}

function decodeSecret(secret: string): Buffer | null {
  const withoutPrefix = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  try {
    return Buffer.from(withoutPrefix, 'base64')
  } catch {
    return null
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Verify a Resend/Svix webhook delivery against the RAW request body bytes.
 * Returns true only when every check passes: secret configured, all three
 * headers present, timestamp within tolerance, and at least one signature in
 * the (possibly multi-entry) `svix-signature` header matches.
 */
export function verifyResendWebhook(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
): boolean {
  if (!secret) return false // fail closed: an unset secret trusts no one
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false

  const key = decodeSecret(secret)
  if (!key) return false

  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = createHmac('sha256', key).update(signedContent).digest('base64')

  // svix-signature can carry multiple space-delimited `v{n},<sig>` entries
  // (key rotation) — a match against ANY of them is a valid signature.
  const candidates = signature.split(' ').map((entry) => {
    const comma = entry.indexOf(',')
    return comma === -1 ? entry : entry.slice(comma + 1)
  })
  return candidates.some((candidate) => {
    try {
      return safeEqual(candidate, expected)
    } catch {
      return false
    }
  })
}
