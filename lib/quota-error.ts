/**
 * Quota / billing error detection for generation paths.
 *
 * When the AINative account is out of monthly tokens, the upstream API returns
 * HTTP 402 with a `billing_error` / `monthly_token_limit_exceeded` payload.
 *
 * This matters because the generation route has a PRIMARY agent path (Cody) and
 * a FALLBACK standard-generation path. On a normal agent failure, falling
 * through to the fallback is correct. But on a QUOTA failure, the fallback bills
 * the SAME exhausted account — so it just burns more tokens and fails again
 * (a "doom loop" that accelerates burn precisely when the account is empty).
 *
 * Detecting the quota case lets callers fail fast with an actionable message
 * instead of doubling token spend on a request that cannot succeed.
 */

const QUOTA_MARKERS = [
  'monthly_token_limit_exceeded',
  'billing_error',
  'token allotment',
  'add credits to continue',
]

/**
 * Returns true if the given error text/object represents an upstream quota or
 * billing exhaustion (HTTP 402 monthly_token_limit_exceeded and friends).
 * Deliberately liberal on the text match, strict on the 402 status.
 */
export function isQuotaError(err: unknown): boolean {
  if (err == null) return false

  // Structured error with a status/code
  const anyErr = err as { status?: number; code?: number; statusCode?: number }
  const status = anyErr.status ?? anyErr.code ?? anyErr.statusCode
  if (status === 402) return true

  const text =
    typeof err === 'string'
      ? err
      : (() => {
          try {
            return JSON.stringify(err)
          } catch {
            return String((err as { message?: string })?.message ?? err)
          }
        })()

  const lower = text.toLowerCase()
  // A bare "402" in the text is only conclusive alongside a billing marker,
  // to avoid matching unrelated numbers.
  const has402 = /\b402\b/.test(lower)
  const hasMarker = QUOTA_MARKERS.some((m) => lower.includes(m))
  return hasMarker || (has402 && lower.includes('billing'))
}

/** User-facing message when generation cannot proceed due to account quota. */
export const QUOTA_USER_MESSAGE =
  'Generation is temporarily unavailable — the workspace has reached its monthly token limit. Please try again shortly while we top up capacity.'
