// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — FeedbackPulse (components/build/FeedbackPulse.tsx,
 * 104 lines, reached live via components/build/artifacts/Preview.tsx and
 * components/build/screens/Live.tsx) had zero test coverage. Its underlying
 * persistence helpers (lib/build/feedback-capture.ts: browserStorage,
 * shouldShowPulse, markRated, buildFeedbackPayload) are already
 * independently tested — used here REAL (not mocked), driving the real
 * window.localStorage, so this file verifies the real end-to-end phase
 * machine + real "ask once per generation" persistence.
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state }) }))

function jsonResponse(data: any, ok = true) {
  return { ok, json: async () => data }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return host.querySelector(`[data-testid="${id}"]`) as T | null
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  window.localStorage.clear()
  h.state = {}
})

describe('FeedbackPulse — real phase-machine/persistence coverage (#1204)', () => {
  it('renders genuinely nothing when there is no real generation identity at all', async () => {
    h.state = {}
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })

    expect(host.innerHTML).toBe('')
  })

  it('shows the real initial ask prompt for a genuinely new, never-rated generation', async () => {
    h.state = { appChatId: 'chat-123', idea: 'x', track: 'company', view: 'thesis' }
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })

    expect(byTestId('feedback-pulse')).not.toBeNull()
    expect(host.textContent).toContain('Was this what you asked for?')
  })

  it('never shows the ask prompt for a generation that was genuinely already rated in real localStorage', async () => {
    h.state = { appChatId: 'chat-already-rated', idea: 'x', track: 'company', view: 'thesis' }
    const { markRated, browserStorage } = await import('@/lib/build/feedback-capture')
    markRated(browserStorage(), { chatId: 'chat-already-rated', slug: undefined })

    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })

    expect(host.innerHTML).toBe('')
  })

  it('a real "Yes" click fires the real POST with the real positive rating, marks the generation rated, and shows the real "Noted" state', async () => {
    // Real finding: buildFeedbackPayload's real shape is
    // {chatId, rating, feedbackText, prompt, model} — a numeric `rating`
    // (RATING_UP/RATING_DOWN), never a `positive` boolean field. Confirmed
    // by reading lib/build/feedback-capture.ts directly after an initial
    // wrong assumption about the field name.
    global.fetch = vi.fn(async () => jsonResponse({ ok: true })) as any
    h.state = { appChatId: 'chat-yes', idea: 'x', track: 'company', view: 'thesis' }
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })

    await act(async () => { byTestId<HTMLButtonElement>('feedback-yes')!.click() })

    expect(global.fetch).toHaveBeenCalledWith('/api/rlhf/submit-feedback', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"rating":5'),
    }))
    expect(byTestId('feedback-pulse-done')).not.toBeNull()
    expect(host.textContent).toContain('Noted — this trains Cody.')

    const { feedbackKey } = await import('@/lib/build/feedback-capture')
    const key = feedbackKey({ chatId: 'chat-yes', slug: undefined })!
    expect(window.localStorage.getItem(key)).not.toBeNull()
  })

  it('a real "No" click shows the real reason-input phase, never submitting yet', async () => {
    global.fetch = vi.fn() as any
    h.state = { appChatId: 'chat-no', idea: 'x', track: 'company', view: 'thesis' }
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })

    await act(async () => { byTestId<HTMLButtonElement>('feedback-no')!.click() })

    expect(byTestId('feedback-pulse-reason')).not.toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a real "Send" click in the reason phase submits the real typed reason text', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ ok: true })) as any
    h.state = { appChatId: 'chat-reason', idea: 'x', track: 'company', view: 'thesis' }
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })
    await act(async () => { byTestId<HTMLButtonElement>('feedback-no')!.click() })

    const input = byTestId<HTMLInputElement>('feedback-reason-input')!
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'The colors were wrong'); input.dispatchEvent(new Event('input', { bubbles: true })) })

    await act(async () => { byTestId<HTMLButtonElement>('feedback-send')!.click() })

    expect(global.fetch).toHaveBeenCalledWith('/api/rlhf/submit-feedback', expect.objectContaining({
      body: expect.stringContaining('The colors were wrong'),
    }))
    expect(byTestId('feedback-pulse-done')).not.toBeNull()
  })

  it('pressing real Enter in the reason input submits the same way as the Send button', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ ok: true })) as any
    h.state = { appChatId: 'chat-enter', idea: 'x', track: 'company', view: 'thesis' }
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })
    await act(async () => { byTestId<HTMLButtonElement>('feedback-no')!.click() })

    const input = byTestId<HTMLInputElement>('feedback-reason-input')!
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })

    expect(global.fetch).toHaveBeenCalled()
    expect(byTestId('feedback-pulse-done')).not.toBeNull()
  })

  it('a real "Skip" click in the reason phase submits with an empty reason and moves to done', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ ok: true })) as any
    h.state = { appChatId: 'chat-skip', idea: 'x', track: 'company', view: 'thesis' }
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })
    await act(async () => { byTestId<HTMLButtonElement>('feedback-no')!.click() })

    await act(async () => { byTestId<HTMLButtonElement>('feedback-skip')!.click() })

    expect(global.fetch).toHaveBeenCalledWith('/api/rlhf/submit-feedback', expect.objectContaining({
      body: expect.stringContaining('"rating":1'),
    }))
    expect(byTestId('feedback-pulse-done')).not.toBeNull()
  })

  it('a real "Dismiss" click hides the pulse entirely without ever submitting', async () => {
    global.fetch = vi.fn() as any
    h.state = { appChatId: 'chat-dismiss', idea: 'x', track: 'company', view: 'thesis' }
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })

    await act(async () => { byTestId<HTMLButtonElement>('feedback-dismiss')!.click() })

    expect(host.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('never crashes when the real submit-feedback POST genuinely rejects (fire-and-forget)', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    h.state = { appChatId: 'chat-reject', idea: 'x', track: 'company', view: 'thesis' }
    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'live' }))
    await act(async () => { await Promise.resolve() })

    await act(async () => { byTestId<HTMLButtonElement>('feedback-yes')!.click(); await Promise.resolve() })

    expect(byTestId('feedback-pulse-done')).not.toBeNull()
  })

  it('uses the real explicit chatId prop over state.appChatId when both are genuinely given', async () => {
    h.state = { appChatId: 'state-chat', idea: 'x', track: 'company', view: 'thesis' }
    const { markRated, browserStorage } = await import('@/lib/build/feedback-capture')
    markRated(browserStorage(), { chatId: 'prop-chat', slug: undefined })

    const { FeedbackPulse } = await import('@/components/build/FeedbackPulse')
    render(React.createElement(FeedbackPulse, { surface: 'preview', chatId: 'prop-chat' }))
    await act(async () => { await Promise.resolve() })

    // Already rated under the explicit prop chatId — pulse stays hidden,
    // confirming the prop (not state.appChatId) is the real identity used.
    expect(host.innerHTML).toBe('')
  })
})
