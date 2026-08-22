/**
 * Server-side Google Ads conversion reporting (#207). The Builder has no Google Ads
 * credentials; core does. So we POST conversion events to core's public
 * /api/v1/events/track, which records them + uploads to Google Ads keyed by gclid
 * (google_ads_click_id) — feeding Smart Bidding real paid outcomes.
 *
 * Called from the server-verified conversion moments (subscribe, lead) with the
 * gclid read from the ax_gclid cookie the client captured on ad landing.
 */

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

type ConversionEvent = {
  eventType: string
  eventName: string
  sessionId: string
  gclid?: string
  value?: number
  currency?: string
  email?: string
  slug?: string
  plan?: string
}

/**
 * Report a conversion to core → Google Ads. Best-effort, never throws into the
 * request path. No-op (returns false) if there's no gclid — an organic conversion
 * has no ad click to attribute, so there's nothing to upload to Ads.
 */
export async function reportConversion(e: ConversionEvent): Promise<boolean> {
  if (!e.gclid) return false // no ad click → nothing to attribute to Google Ads
  try {
    const res = await fetch(`${CORE}/api/v1/events/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: e.eventType,
        event_name: e.eventName,
        session_id: e.sessionId || `builder-${e.slug || 'anon'}`,
        conversion_value: e.value,
        currency: e.currency || 'USD',
        google_ads_click_id: e.gclid,
        form_data: { source: 'builder', slug: e.slug, plan: e.plan, email: e.email },
      }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Read the gclid the client captured on ad landing, from the ax_gclid cookie. */
export function gclidFromRequest(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|; )ax_gclid=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : undefined
}
