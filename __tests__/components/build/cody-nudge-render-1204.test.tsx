// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { PrimitiveNudge } from '@/lib/build/primitives'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — CodyNudge (components/build/CodyNudge.tsx, 25
 * lines, reached live via components/build/CodyFeed.tsx and
 * components/build/CodyChatPanel.tsx) had zero test coverage.
 */

const h = vi.hoisted(() => ({ dispatch: vi.fn() }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ dispatch: h.dispatch }) }))

import { CodyNudge } from '@/components/build/CodyNudge'

function makeNudge(overrides: Partial<PrimitiveNudge> = {}): PrimitiveNudge {
  return { prim: 'ZeroMemory', text: 'I can wire in persistent memory for your users.', cta: 'Add memory', ...overrides }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  h.dispatch.mockClear()
  vi.useRealTimers()
})

describe('CodyNudge — real accept/dismiss/routing coverage (#1204)', () => {
  it('renders the real primitive name, pitch text, and CTA label', () => {
    const nudge = makeNudge({ prim: 'ZeroVoice', text: 'I can add voice calls.', cta: 'Add voice' })
    render(React.createElement(CodyNudge, { view: 'prd', nudge }))

    expect(host.textContent).toContain('Cody suggests · ZeroVoice')
    expect(host.textContent).toContain('I can add voice calls.')
    expect(host.querySelector('.m-nudge-accept')?.textContent).toBe('Add voice')
  })

  it('accepting a nudge with no real "to" target dispatches only NUDGE accepted, never navigates', async () => {
    const nudge = makeNudge()
    render(React.createElement(CodyNudge, { view: 'prd', nudge }))

    const acceptBtn = host.querySelector('.m-nudge-accept') as HTMLButtonElement
    await act(async () => { acceptBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'NUDGE', view: 'prd', state: 'accepted' })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('accepting a nudge with a real "to" target dispatches NUDGE accepted immediately, then GOTO_VIEW after the real 500ms delay', async () => {
    vi.useFakeTimers()
    const nudge = makeNudge({ to: 'dataModel' })
    render(React.createElement(CodyNudge, { view: 'prd', nudge }))

    const acceptBtn = host.querySelector('.m-nudge-accept') as HTMLButtonElement
    await act(async () => { acceptBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'NUDGE', view: 'prd', state: 'accepted' })
    expect(h.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GOTO_VIEW' }))

    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_VIEW', view: 'dataModel' })
  })

  it('"Not now" dispatches the real NUDGE dismissed action for the real given view, never accepted', async () => {
    const nudge = makeNudge()
    render(React.createElement(CodyNudge, { view: 'memoryPolicy', nudge }))

    const dismissBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Not now') as HTMLButtonElement
    await act(async () => { dismissBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'NUDGE', view: 'memoryPolicy', state: 'dismissed' })
    expect(h.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'accepted' }))
  })
})
