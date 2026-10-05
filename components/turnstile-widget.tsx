'use client'

import { useEffect, useId, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
        },
      ) => string
      remove: (widgetId: string) => void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const SCRIPT_ID = 'cf-turnstile-script'

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
  if (existing) {
    return new Promise((resolve) => existing.addEventListener('load', () => resolve()))
  }
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    document.head.appendChild(script)
  })
}

interface TurnstileWidgetProps {
  onVerify: (token: string) => void
  onExpire?: () => void
}

/**
 * Cloudflare Turnstile widget (#930). Renders nothing — and never blocks
 * the form — when NEXT_PUBLIC_TURNSTILE_SITE_KEY isn't set, so local dev
 * without the key configured still works.
 *
 * Accessibility (2026-10-05 audit): Turnstile's own "Success!" state change
 * inside its iframe is not announced to screen readers — there's no
 * aria-live ancestor around it, and the iframe's internals aren't ours to
 * fix. Added our own aria-live region, driven by the same onVerify callback
 * the form already uses, so a screen-reader user gets an explicit
 * announcement independent of whatever Turnstile's iframe does internally.
 */
export function TurnstileWidget({ onVerify, onExpire }: TurnstileWidgetProps) {
  const containerId = useId().replace(/:/g, '')
  const widgetIdRef = useRef<string | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false

    loadTurnstileScript().then(() => {
      if (cancelled || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(`#${containerId}`, {
        sitekey: siteKey,
        callback: (token: string) => {
          setVerified(true)
          onVerify(token)
        },
        'error-callback': () => {
          setVerified(false)
          onExpire?.()
        },
        'expired-callback': () => {
          setVerified(false)
          onExpire?.()
        },
      })
    })

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, containerId])

  if (!siteKey) return null

  return (
    <>
      <div id={containerId} data-testid="turnstile-widget" />
      <span className="sr-only" role="status" aria-live="polite" data-testid="turnstile-sr-status">
        {verified ? 'Verification complete.' : ''}
      </span>
    </>
  )
}
