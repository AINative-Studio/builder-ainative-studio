// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { PendingQuestion } from '@/lib/build/state'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — DecisionModal (components/build/DecisionModal.tsx,
 * 44 lines, reached live via components/build/WorkspaceShell.tsx) had zero
 * test coverage.
 */

const h = vi.hoisted(() => ({ dispatch: vi.fn(), state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state, dispatch: h.dispatch }) }))

function makeQuestion(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    q: 'How should we handle user data?',
    sub: 'This shapes your privacy posture going forward.',
    opts: [{ v: 'minimal', t: 'Collect the minimum' }, { v: 'full', t: 'Collect everything useful' }],
    ...overrides,
  }
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
  h.state = {}
})

describe('DecisionModal — real paused/pendingQ gating + dispatch coverage (#1204)', () => {
  it('renders nothing when genuinely not paused, even with a real pendingQ present', async () => {
    h.state = { paused: false, pendingQ: makeQuestion() }
    const { DecisionModal } = await import('@/components/build/DecisionModal')
    render(React.createElement(DecisionModal))

    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when paused but genuinely no pendingQ', async () => {
    h.state = { paused: true, pendingQ: null }
    const { DecisionModal } = await import('@/components/build/DecisionModal')
    render(React.createElement(DecisionModal))

    expect(host.innerHTML).toBe('')
  })

  it('renders the real question/sub/options once genuinely paused with a real pendingQ', async () => {
    const q = makeQuestion({ q: 'Pick a pricing model', sub: 'This sets your default plan.' })
    h.state = { paused: true, pendingQ: q }
    const { DecisionModal } = await import('@/components/build/DecisionModal')
    render(React.createElement(DecisionModal))

    expect(host.querySelector('h2')?.textContent).toBe('Pick a pricing model')
    expect(host.textContent).toContain('This sets your default plan.')
    const buttons = Array.from(host.querySelectorAll('.m-modal-opt'))
    expect(buttons.map((b) => b.textContent)).toEqual(['Collect the minimum', 'Collect everything useful'])
  })

  it('picking an option on a real data-related question dispatches ANSWER_Q with key "privacy"', async () => {
    const q = makeQuestion({ q: 'How should we handle user data?' })
    h.state = { paused: true, pendingQ: q }
    const { DecisionModal } = await import('@/components/build/DecisionModal')
    render(React.createElement(DecisionModal))

    const btn = Array.from(host.querySelectorAll('.m-modal-opt')).find((b) => b.textContent === 'Collect the minimum') as HTMLButtonElement
    await act(async () => { btn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'ANSWER_Q', key: 'privacy', value: 'minimal' })
  })

  it('picking an option on a real NON-data question dispatches ANSWER_Q with the generic key "answer"', async () => {
    const q = makeQuestion({
      q: 'Which go-to-market motion fits best?',
      opts: [{ v: 'plg', t: 'Product-led' }, { v: 'sales', t: 'Sales-led' }],
    })
    h.state = { paused: true, pendingQ: q }
    const { DecisionModal } = await import('@/components/build/DecisionModal')
    render(React.createElement(DecisionModal))

    const btn = Array.from(host.querySelectorAll('.m-modal-opt')).find((b) => b.textContent === 'Sales-led') as HTMLButtonElement
    await act(async () => { btn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'ANSWER_Q', key: 'answer', value: 'sales' })
  })

  it('the data-key detection is case-insensitive on the real question text', async () => {
    const q = makeQuestion({ q: 'DATA retention — how long should we keep it?', opts: [{ v: '30d', t: '30 days' }] })
    h.state = { paused: true, pendingQ: q }
    const { DecisionModal } = await import('@/components/build/DecisionModal')
    render(React.createElement(DecisionModal))

    const btn = host.querySelector('.m-modal-opt') as HTMLButtonElement
    await act(async () => { btn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'ANSWER_Q', key: 'privacy', value: '30d' })
  })

  it('renders every real option in the given order, including 3 options', async () => {
    const q = makeQuestion({ opts: [{ v: 'a', t: 'Option A' }, { v: 'b', t: 'Option B' }, { v: 'c', t: 'Option C' }] })
    h.state = { paused: true, pendingQ: q }
    const { DecisionModal } = await import('@/components/build/DecisionModal')
    render(React.createElement(DecisionModal))

    const buttons = Array.from(host.querySelectorAll('.m-modal-opt'))
    expect(buttons.map((b) => b.textContent)).toEqual(['Option A', 'Option B', 'Option C'])
  })
})
