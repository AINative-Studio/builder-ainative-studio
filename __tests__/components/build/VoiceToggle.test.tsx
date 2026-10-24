// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { VoiceToggle, voiceAvailabilityFromProbe, resolveVoiceProvider } from '@/components/build/VoiceToggle'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * VoiceToggle (#1290, provider selection added in #1468) — the "talk to
 * Cody" entry point. Must render NOTHING (not even a disabled button) when
 * the selected provider isn't configured server-side, so the feature ships
 * safely before any provider's env vars exist in an environment. Never
 * pulls in a live voice SDK directly — those live in VoiceCall.tsx /
 * VoiceCallElevenLabs.tsx, deliberately untested per the issue's own scope
 * note about not unit-testing live audio I/O.
 *
 * Provider routing hits POST /api/build/voice/token-elevenlabs (ElevenLabs)
 * or POST /api/build/voice/token (Hume) depending on resolveVoiceProvider's
 * read of VOICE_PROVIDER, defaulting to elevenlabs per Toby's Oct 24 2026
 * decision.
 */

let host: HTMLElement
let root: Root

function render(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

describe('voiceAvailabilityFromProbe', () => {
  it('is "available" only for a real 200 with a credential', () => {
    expect(voiceAvailabilityFromProbe(200, { ok: true, accessToken: 'tok' })).toBe('available')
    expect(voiceAvailabilityFromProbe(200, { ok: true, signedUrl: 'wss://x' })).toBe('available')
  })

  it('is "unavailable" for a 404 (not configured)', () => {
    expect(voiceAvailabilityFromProbe(404, { ok: false, error: 'VOICE_NOT_CONFIGURED' })).toBe('unavailable')
  })

  it('is "unavailable" for a 502 (provider call failed)', () => {
    expect(voiceAvailabilityFromProbe(502, { ok: false, error: 'TOKEN_FETCH_FAILED' })).toBe('unavailable')
  })

  it('is "unavailable" for a 200 body missing any credential field', () => {
    expect(voiceAvailabilityFromProbe(200, { ok: true })).toBe('unavailable')
  })

  it('is "unavailable" for a null/malformed body', () => {
    expect(voiceAvailabilityFromProbe(200, null)).toBe('unavailable')
  })
})

describe('resolveVoiceProvider', () => {
  it('defaults to elevenlabs when unset', () => {
    expect(resolveVoiceProvider(undefined)).toBe('elevenlabs')
  })

  it('selects hume when explicitly set', () => {
    expect(resolveVoiceProvider('hume')).toBe('hume')
  })
})

describe('VoiceToggle', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('renders nothing while the configuration probe is in flight', () => {
    ;(global.fetch as any).mockReturnValue(new Promise(() => {})) // never resolves
    render(<VoiceToggle />)
    expect(host.querySelector('[data-testid="voice-toggle"]')).toBeNull()
  })

  it('[only ElevenLabs configured] probes the elevenlabs token route and renders the toggle', async () => {
    ;(global.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/build/voice/token-elevenlabs') {
        return Promise.resolve({ status: 200, json: async () => ({ ok: true, signedUrl: 'wss://real' }) })
      }
      return Promise.resolve({ status: 404, json: async () => ({ ok: false, error: 'VOICE_NOT_CONFIGURED' }) })
    })
    render(<VoiceToggle voiceProvider="elevenlabs" />)
    await flush()
    expect(global.fetch).toHaveBeenCalledWith('/api/build/voice/token-elevenlabs', { method: 'POST' })
    const btn = host.querySelector('[data-testid="voice-toggle"]')
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toBe('Talk to Cody')
  })

  it('[only Hume configured, VOICE_PROVIDER=hume] probes the hume token route and renders the toggle', async () => {
    ;(global.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/build/voice/token') {
        return Promise.resolve({ status: 200, json: async () => ({ ok: true, accessToken: 'real-token' }) })
      }
      return Promise.resolve({ status: 404, json: async () => ({ ok: false, error: 'VOICE_NOT_CONFIGURED' }) })
    })
    render(<VoiceToggle voiceProvider="hume" />)
    await flush()
    expect(global.fetch).toHaveBeenCalledWith('/api/build/voice/token', { method: 'POST' })
    const btn = host.querySelector('[data-testid="voice-toggle"]')
    expect(btn).not.toBeNull()
  })

  it('[both configured, default VOICE_PROVIDER] prefers elevenlabs', async () => {
    ;(global.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/build/voice/token-elevenlabs') {
        return Promise.resolve({ status: 200, json: async () => ({ ok: true, signedUrl: 'wss://real' }) })
      }
      if (url === '/api/build/voice/token') {
        return Promise.resolve({ status: 200, json: async () => ({ ok: true, accessToken: 'real-token' }) })
      }
      throw new Error(`unexpected url ${url}`)
    })
    render(<VoiceToggle />)
    await flush()
    expect(global.fetch).toHaveBeenCalledWith('/api/build/voice/token-elevenlabs', { method: 'POST' })
    expect(global.fetch).not.toHaveBeenCalledWith('/api/build/voice/token', { method: 'POST' })
  })

  it('[both configured, VOICE_PROVIDER=hume explicitly] uses hume', async () => {
    ;(global.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/build/voice/token-elevenlabs') {
        return Promise.resolve({ status: 200, json: async () => ({ ok: true, signedUrl: 'wss://real' }) })
      }
      if (url === '/api/build/voice/token') {
        return Promise.resolve({ status: 200, json: async () => ({ ok: true, accessToken: 'real-token' }) })
      }
      throw new Error(`unexpected url ${url}`)
    })
    render(<VoiceToggle voiceProvider="hume" />)
    await flush()
    expect(global.fetch).toHaveBeenCalledWith('/api/build/voice/token', { method: 'POST' })
    expect(global.fetch).not.toHaveBeenCalledWith('/api/build/voice/token-elevenlabs', { method: 'POST' })
  })

  it('[neither configured] renders nothing', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 404,
      json: async () => ({ ok: false, error: 'VOICE_NOT_CONFIGURED' }),
    })
    render(<VoiceToggle />)
    await flush()
    expect(host.querySelector('[data-testid="voice-toggle"]')).toBeNull()
  })

  it('renders nothing when the probe request itself throws', async () => {
    ;(global.fetch as any).mockRejectedValue(new Error('network down'))
    render(<VoiceToggle />)
    await flush()
    expect(host.querySelector('[data-testid="voice-toggle"]')).toBeNull()
  })

  it('only probes the token route once even if re-rendered', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, signedUrl: 'wss://real' }),
    })
    render(<VoiceToggle />)
    await flush()
    act(() => root.render(<VoiceToggle />))
    await flush()
    expect((global.fetch as any).mock.calls.length).toBe(1)
  })

  it('clicking the toggle swaps in the injected connected view with the minted credential', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, signedUrl: 'wss://real' }),
    })
    render(
      <VoiceToggle
        renderConnected={(credential) => <div data-testid="connected-stub">{credential}</div>}
      />
    )
    await flush()
    const btn = host.querySelector('[data-testid="voice-toggle"]') as HTMLButtonElement
    act(() => btn.click())
    const stub = host.querySelector('[data-testid="connected-stub"]')
    expect(stub).not.toBeNull()
    expect(stub?.textContent).toBe('wss://real')
  })
})
