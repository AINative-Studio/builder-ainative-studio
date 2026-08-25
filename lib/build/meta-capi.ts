/**
 * Server-side Meta Conversions API (CAPI) reporting (#207 · Meta). The browser
 * Pixel can be blocked (ad-blockers, ITP, no-JS); CAPI reports the same conversion
 * server-to-server so Meta still attributes it. Mirrors lib/build/conversions.ts:
 * best-effort, never throws into the request path, and a full no-op unless BOTH
 * META_CAPI_ACCESS_TOKEN and NEXT_PUBLIC_META_PIXEL_ID are configured.
 *
 * Dedup: pass the SAME eventId here and to the browser trackMeta() call for a given
 * conversion — Meta counts the Pixel/CAPI pair once. When we only have the server
 * side (e.g. Stripe return with no live browser), CAPI still reports it standalone.
 */

import { createHash } from 'crypto'

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || ''
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || ''
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
// Optional test-events code from Meta Events Manager (leave unset in prod).
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || ''

/** True only when both the pixel id and the CAPI token are configured. */
export function metaCapiEnabled(): boolean {
  return Boolean(PIXEL_ID && ACCESS_TOKEN)
}

/** Meta Standard Event names we mirror off the GA4 funnel. */
export type MetaCapiEventName =
  | 'Lead'
  | 'CompleteRegistration'
  | 'InitiateCheckout'
  | 'Purchase'

export type MetaCapiEvent = {
  eventName: MetaCapiEventName
  eventId: string // MUST match the browser Pixel event_id for dedup
  email?: string
  value?: number
  currency?: string
  /** Meta `_fbc` click id (fb.1.<ts>.<fbclid>), from the cookie. */
  fbc?: string
  /** Meta `_fbp` browser id, from the cookie. */
  fbp?: string
  clientIp?: string
  userAgent?: string
  eventSourceUrl?: string
  /** Extra custom_data (e.g. { slug, plan }). */
  custom?: Record<string, unknown>
}

const sha256 = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex')

/**
 * Report a conversion to Meta CAPI. Best-effort, never throws. No-op (returns
 * false) when CAPI isn't configured — mirrors reportConversion()'s guarding.
 */
export async function reportMetaConversion(e: MetaCapiEvent): Promise<boolean> {
  if (!metaCapiEnabled()) return false // no pixel id / token → nothing to send

  const userData: Record<string, unknown> = {}
  if (e.email) userData.em = [sha256(e.email)]
  if (e.fbc) userData.fbc = e.fbc
  if (e.fbp) userData.fbp = e.fbp
  if (e.clientIp) userData.client_ip_address = e.clientIp
  if (e.userAgent) userData.client_user_agent = e.userAgent

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: e.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: e.eventId,
        action_source: 'website',
        ...(e.eventSourceUrl ? { event_source_url: e.eventSourceUrl } : {}),
        user_data: userData,
        custom_data: {
          ...(typeof e.value === 'number' ? { value: e.value } : {}),
          currency: e.currency || 'USD',
          ...(e.custom || {}),
        },
      },
    ],
    ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

/** Read the Meta `_fbc` click id the client captured on ad landing. */
export function fbcFromRequest(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|; )_fbc=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : undefined
}

/** Read the Meta `_fbp` browser id fbq set on this browser. */
export function fbpFromRequest(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|; )_fbp=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : undefined
}
