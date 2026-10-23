'use client'

/**
 * VoiceToggle (#1290) — the "talk to Cody" entry point using Hume's EVI 3
 * (Empathic Voice Interface) voice SDK.
 *
 * This is a NEW, standalone capability — real-time conversational voice
 * inside the /build chat UI — distinct from the existing ZeroVoice
 * primitive (telephony: phone numbers, SMS/voice relay for a founder's
 * DEPLOYED company). Nothing here touches ZeroVoice.
 *
 * Feature-flagged off by configuration (#1290's explicit requirement): this
 * component calls POST /api/build/voice/token on mount purely to learn
 * whether Hume is configured (HUME_API_KEY + HUME_SECRET_KEY) — a 404
 * there means "not configured" and this renders nothing, rather than a
 * disabled husk. A real NEXT_PUBLIC_* duplicate flag was deliberately
 * avoided: it would have to be kept in sync with the two server secrets by
 * hand, and drift there would either hide a working feature or show a
 * broken button.
 *
 * Deliberately bounded first cut: one toggle button, no settings page, no
 * persisted voice history. Connecting requires @humeai/voice-react's
 * VoiceProvider as an ancestor — kept local to this component (mounted only
 * once we know voice is configured) rather than wrapping the whole app in a
 * provider that does nothing for the common (unconfigured) case.
 */

import { useEffect, useRef, useState } from 'react'
import { VoiceCall } from '@/components/build/VoiceCall'

export type VoiceAvailability = 'checking' | 'unavailable' | 'available'

/**
 * Pure helper (exported for tests): did the token-route probe come back as
 * "Hume is configured"? Anything other than a real 200 with an accessToken
 * means unavailable — this never renders a broken toggle for a transient
 * network hiccup either; it simply stays hidden until the next mount.
 */
export function voiceAvailabilityFromProbe(status: number, body: unknown): VoiceAvailability {
  if (status === 200 && body && typeof body === 'object' && (body as any).ok && (body as any).accessToken) {
    return 'available'
  }
  return 'unavailable'
}

interface VoiceToggleProps {
  /** Injected for tests; defaults to the real VoiceProvider/useVoice flow. */
  renderConnected?: (accessToken: string) => React.ReactNode
}

export function VoiceToggle({ renderConnected }: VoiceToggleProps) {
  const [availability, setAvailability] = useState<VoiceAvailability>('checking')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const probed = useRef(false)

  useEffect(() => {
    if (probed.current) return
    probed.current = true
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/build/voice/token', { method: 'POST' })
        const body = await res.json().catch(() => null)
        if (cancelled) return
        const avail = voiceAvailabilityFromProbe(res.status, body)
        setAvailability(avail)
        if (avail === 'available') setAccessToken((body as any).accessToken)
      } catch {
        if (!cancelled) setAvailability('unavailable')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (availability !== 'available' || !accessToken) {
    // Nothing renders — not even a disabled button — when voice isn't
    // configured, per #1290's explicit "ships safely when HUME_API_KEY
    // isn't set" requirement.
    return null
  }

  if (active) {
    return renderConnected
      ? <>{renderConnected(accessToken)}</>
      : <VoiceCall accessToken={accessToken} onEnd={() => setActive(false)} />
  }

  return (
    <button
      type="button"
      data-testid="voice-toggle"
      className="btn-ghost m-voice-toggle"
      aria-pressed={active}
      onClick={() => setActive((v) => !v)}
    >
      {active ? 'End voice chat' : 'Talk to Cody'}
    </button>
  )
}
