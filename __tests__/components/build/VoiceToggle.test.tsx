// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { VoiceToggle, voiceAvailabilityFromProbe } from '@/components/build/VoiceToggle'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * VoiceToggle (#1290) — the "talk to Cody" entry point. Per the issue's own
 * explicit requirement, this must render NOTHING (not even a disabled
 * button) when Hume voice isn't configured server-side, so the feature
 * ships safely before HUME_API_KEY/HUME_SECRET_KEY exist in any
 * environment. Never pulls in the live @humeai/voice-react SDK directly —
 * that lives in VoiceCall.tsx, deliberately untested per the issue's own
 * scope note about not unit-testing live audio I/O.
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
  it('is "available" only for a real 200 with an accessToken', () => {
    expect(voiceAvailabilityFromProbe(200, { ok: true, accessToken: 'tok' })).toBe('available')
  })

  it('is "unavailable" for a 404 (not configured)', () => {
    expect(voiceAvailabilityFromProbe(404, { ok: false, error: 'VOICE_NOT_CONFIGURED' })).toBe('unavailable')
  })

  it('is "unavailable" for a 502 (Hume call failed)', () => {
    expect(voiceAvailabilityFromProbe(502, { ok: false, error: 'TOKEN_FETCH_FAILED' })).toBe('unavailable')
  })

  it('is "unavailable" for a 200 body missing an accessToken', () => {
    expect(voiceAvailabilityFromProbe(200, { ok: true })).toBe('unavailable')
  })

  it('is "unavailable" for a null/malformed body', () => {
    expect(voiceAvailabilityFromProbe(200, null)).toBe('unavailable')
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

  it('renders nothing when voice is not configured (404 VOICE_NOT_CONFIGURED)', async () => {
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

  it('renders the "Talk to Cody" toggle once voice is confirmed configured', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, accessToken: 'real-token' }),
    })
    render(<VoiceToggle />)
    await flush()
    const btn = host.querySelector('[data-testid="voice-toggle"]')
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toBe('Talk to Cody')
    expect(btn?.getAttribute('aria-pressed')).toBe('false')
  })

  it('only probes the token route once even if re-rendered', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, accessToken: 'real-token' }),
    })
    render(<VoiceToggle />)
    await flush()
    act(() => root.render(<VoiceToggle />))
    await flush()
    expect((global.fetch as any).mock.calls.length).toBe(1)
  })

  it('clicking the toggle swaps in the injected connected view with the minted token', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, accessToken: 'real-token' }),
    })
    render(<VoiceToggle renderConnected={(token) => <div data-testid="connected-stub">{token}</div>} />)
    await flush()
    const btn = host.querySelector('[data-testid="voice-toggle"]') as HTMLButtonElement
    act(() => btn.click())
    const stub = host.querySelector('[data-testid="connected-stub"]')
    expect(stub).not.toBeNull()
    expect(stub?.textContent).toBe('real-token')
  })
})
