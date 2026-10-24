// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { FirstRunGuide } from '@/components/build/FirstRunGuide'
import { FIRST_RUN_KEY } from '@/lib/build/first-run'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — FirstRunGuide (components/build/FirstRunGuide.tsx,
 * 53 lines, reached live via components/build/screens/Workspace.tsx) had
 * zero test coverage. Uses real window.localStorage and the real
 * FIRST_RUN_KEY constant from lib/build/first-run.ts (already independently
 * tested in first-run.test.ts) rather than guessing the storage key.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

async function flush() {
  await act(async () => { await Promise.resolve() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  window.localStorage.clear()
})

describe('FirstRunGuide — real visibility/dismiss/persistence coverage (#1204)', () => {
  it('shows the real guide once mounted when genuinely never dismissed before', async () => {
    window.localStorage.clear()
    render(React.createElement(FirstRunGuide))
    await flush()

    expect(host.querySelector('[role="status"]')).not.toBeNull()
    expect(host.textContent).toContain('your first build')
    expect(host.textContent).toContain('Watch me work')
  })

  it('never shows the guide when the real localStorage already has the dismissal key set', async () => {
    window.localStorage.setItem(FIRST_RUN_KEY, '1')
    render(React.createElement(FirstRunGuide))
    await flush()

    expect(host.innerHTML).toBe('')
  })

  it('clicking "Got it" sets the real FIRST_RUN_KEY in real localStorage and hides the guide', async () => {
    window.localStorage.clear()
    render(React.createElement(FirstRunGuide))
    await flush()

    const dismissBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Got it') as HTMLButtonElement
    await act(async () => { dismissBtn.click() })

    expect(window.localStorage.getItem(FIRST_RUN_KEY)).toBe('1')
    expect(host.innerHTML).toBe('')
  })

  it('never shows the guide on a fresh mount in a session where it was already dismissed earlier', async () => {
    window.localStorage.clear()
    render(React.createElement(FirstRunGuide))
    await flush()
    const dismissBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Got it') as HTMLButtonElement
    await act(async () => { dismissBtn.click() })
    act(() => { root.unmount() })
    host.remove()

    render(React.createElement(FirstRunGuide))
    await flush()

    expect(host.innerHTML).toBe('')
  })
})
