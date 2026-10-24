'use client'

/**
 * VoiceToggle (#1290, provider selection added #1468) — the "talk to Cody"
 * entry point, backed by either ElevenLabs Conversational AI (default) or
 * Hume's EVI 3 (Empathic Voice Interface), selectable via VOICE_PROVIDER.
 *
 * This is a NEW, standalone capability — real-time conversational voice
 * inside the /build chat UI — distinct from the existing ZeroVoice
 * primitive (telephony: phone numbers, SMS/voice relay for a founder's
 * DEPLOYED company). Nothing here touches ZeroVoice.
 *
 * Provider selection (#1468, Toby's decision Oct 24 2026 — "ElevenLabs
 * replaces Hume as default, keep both"): one explicit env var,
 * VOICE_PROVIDER=elevenlabs|hume, defaulting to elevenlabs when unset.
 * Deliberately not a silent "pick whichever has keys set" — that drifts
 * unpredictably as more providers get configured over time.
 *
 * Feature-flagged off by configuration (#1290's explicit requirement): this
 * component calls POST on the selected provider's token route on mount
 * purely to learn whether that provider is configured — a 404 there means
 * "not configured" and this renders nothing, rather than a disabled husk.
 * A real NEXT_PUBLIC_* duplicate flag was deliberately avoided: it would
 * have to be kept in sync with the server secrets by hand, and drift there
 * would either hide a working feature or show a broken button.
 *
 * Deliberately bounded first cut: one toggle button, no settings page, no
 * persisted voice history, no user-facing provider picker UI (VOICE_PROVIDER
 * is a deploy-time config, not a runtime choice — that's a future
 * enhancement). Connecting requires the provider SDK's own context provider
 * as an ancestor — kept local to VoiceCall/VoiceCallElevenLabs (mounted
 * only once we know that provider is configured) rather than wrapping the
 * whole app in a provider that does nothing for the common (unconfigured)
 * case.
 */

import { useEffect, useRef, useState } from 'react'
import { VoiceCall } from '@/components/build/VoiceCall'
import { VoiceCallElevenLabs } from '@/components/build/VoiceCallElevenLabs'

export type VoiceAvailability = 'checking' | 'unavailable' | 'available'
export type VoiceProviderName = 'elevenlabs' | 'hume'

const TOKEN_ROUTE: Record<VoiceProviderName, string> = {
  elevenlabs: '/api/build/voice/token-elevenlabs',
  hume: '/api/build/voice/token',
}

/**
 * Pure helper (exported for tests): which provider should VoiceToggle probe
 * and render? Reads the explicit VOICE_PROVIDER value (any case), defaults
 * to 'elevenlabs' for unset/empty/unrecognized values. Does not know about
 * configuration — VoiceToggle itself falls back to "nothing renders" if the
 * selected provider's own token route 404s.
 */
export function resolveVoiceProvider(envValue: string | undefined): VoiceProviderName {
  return envValue?.toLowerCase() === 'hume' ? 'hume' : 'elevenlabs'
}

/**
 * Pure helper (exported for tests): did the token-route probe come back as
 * "this provider is configured"? Anything other than a real 200 with a
 * credential (accessToken for Hume, signedUrl for ElevenLabs) means
 * unavailable — this never renders a broken toggle for a transient network
 * hiccup either; it simply stays hidden until the next mount.
 */
export function voiceAvailabilityFromProbe(status: number, body: unknown): VoiceAvailability {
  const credential = body && typeof body === 'object' ? ((body as any).accessToken || (body as any).signedUrl) : null
  if (status === 200 && body && typeof body === 'object' && (body as any).ok && credential) {
    return 'available'
  }
  return 'unavailable'
}

interface VoiceToggleProps {
  /** Injected for tests; defaults to the real VOICE_PROVIDER env value. */
  voiceProvider?: VoiceProviderName
  /** Injected for tests; defaults to the real provider-specific connected view. */
  renderConnected?: (credential: string) => React.ReactNode
}

export function VoiceToggle({ voiceProvider, renderConnected }: VoiceToggleProps) {
  const provider = voiceProvider ?? resolveVoiceProvider(process.env.NEXT_PUBLIC_VOICE_PROVIDER || process.env.VOICE_PROVIDER)
  const [availability, setAvailability] = useState<VoiceAvailability>('checking')
  const [credential, setCredential] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const probed = useRef(false)

  useEffect(() => {
    if (probed.current) return
    probed.current = true
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(TOKEN_ROUTE[provider], { method: 'POST' })
        const body = await res.json().catch(() => null)
        if (cancelled) return
        const avail = voiceAvailabilityFromProbe(res.status, body)
        setAvailability(avail)
        if (avail === 'available') setCredential((body as any).accessToken || (body as any).signedUrl)
      } catch {
        if (!cancelled) setAvailability('unavailable')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (availability !== 'available' || !credential) {
    // Nothing renders — not even a disabled button — when the selected
    // provider isn't configured, per #1290's explicit "ships safely when
    // unconfigured" requirement (now per-provider, #1468).
    return null
  }

  if (active) {
    if (renderConnected) return <>{renderConnected(credential)}</>
    return provider === 'hume'
      ? <VoiceCall accessToken={credential} onEnd={() => setActive(false)} />
      : <VoiceCallElevenLabs signedUrl={credential} onEnd={() => setActive(false)} />
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
