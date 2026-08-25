'use client'

/**
 * Meta (Facebook) Pixel + client-side Standard Events (#207 · Meta). Mirrors
 * google-analytics.tsx: an afterInteractive <Script> boots `fbq` and fires a
 * PageView, and trackMeta() fires the funnel Standard Events (Lead,
 * CompleteRegistration, InitiateCheckout, Purchase).
 *
 * Deduplication: every server-side CAPI event and its browser Pixel twin share an
 * `event_id`. When both arrive, Meta counts them once. Pass the SAME event_id to
 * trackMeta() (browser) and to the CAPI call (server) for a given conversion.
 *
 * Silent no-op when NEXT_PUBLIC_META_PIXEL_ID is unset — renders nothing and
 * trackMeta() short-circuits, so the build/runtime is unaffected until Toby
 * provides the pixel id.
 */

import Script from 'next/script'

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || ''

export default function MetaPixel() {
  if (!PIXEL_ID) return null // no pixel configured → render nothing (silent no-op)
  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window,document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${PIXEL_ID}');
            fbq('track', 'PageView');
          `,
        }}
      />
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  )
}

/** Meta Standard Event names we mirror off the GA4 funnel. */
export type MetaEventName =
  | 'Lead'
  | 'CompleteRegistration'
  | 'InitiateCheckout'
  | 'Purchase'

/**
 * Fire a Meta Standard Event from the browser. `eventId` MUST match the id used
 * on the matching server-side CAPI call so Meta dedups the pair. Silent no-op when
 * the pixel isn't configured or fbq hasn't loaded.
 */
export function trackMeta(
  event: MetaEventName,
  params?: Record<string, unknown>,
  eventId?: string
) {
  if (!PIXEL_ID) return
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', event, params || {}, eventId ? { eventID: eventId } : undefined)
  }
}

/** A stable-enough client event id for Pixel/CAPI dedup. */
export function newMetaEventId(prefix = 'evt'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

declare global {
  interface Window {
    fbq: (
      command: string,
      event: string,
      params?: Record<string, unknown>,
      options?: { eventID?: string }
    ) => void
    _fbq: unknown
  }
}
