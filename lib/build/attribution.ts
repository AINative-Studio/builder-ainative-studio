/**
 * Ad-click attribution (#207) — capture the Google Ads gclid (+ utm params) when a
 * visitor lands from an ad, and persist it so it survives the whole anonymous build
 * flow to the conversion moment (subscribe / lead). The gclid is the key that ties a
 * real paid subscription back to the exact ad click, so Google Ads Smart Bidding
 * optimizes toward paying customers — not clicks.
 *
 * Stored in a first-party cookie (90d, the Google Ads click lookback window) so it's
 * readable both client-side and by our API routes (server) at the conversion moment.
 */

const GCLID_COOKIE = 'ax_gclid'
const UTM_COOKIE = 'ax_utm'
const MAX_AGE = 90 * 24 * 60 * 60 // 90 days

function setCookie(name: string, value: string) {
  if (typeof document === 'undefined' || !value) return
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : undefined
}

/**
 * On landing: if the URL carries a gclid (or gbraid/wbraid — the iOS/web app click
 * ids), persist it. Also capture utm_* for campaign attribution. Idempotent — a
 * later pageview without a gclid won't clobber a captured one (last ad click wins).
 * Call once on mount.
 */
export function captureAttribution() {
  if (typeof window === 'undefined') return
  const q = new URLSearchParams(window.location.search)
  const gclid = q.get('gclid') || q.get('gbraid') || q.get('wbraid')
  if (gclid) setCookie(GCLID_COOKIE, gclid)
  const utm: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = q.get(k)
    if (v) utm[k] = v
  }
  if (Object.keys(utm).length) setCookie(UTM_COOKIE, JSON.stringify(utm))
}

/** The persisted gclid (from this session's ad landing), or undefined. */
export function getGclid(): string | undefined {
  return readCookie(GCLID_COOKIE)
}

/** The persisted utm params, or {}. */
export function getUtm(): Record<string, string> {
  try { return JSON.parse(readCookie(UTM_COOKIE) || '{}') } catch { return {} }
}
