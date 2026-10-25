// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — follow-up to sandpack-preview-conditional-deps.
 * test.tsx, which covers customSetup.dependencies detection only. The real
 * remaining gap: SandpackResilientTimeout (the real watchdog for Sandpack's
 * documented unpkg-hang gap, #1074/#1076 — a compile that never starts OR
 * never finishes) and SandpackErrorBoundary (the real render-crash fallback
 * + its Retry button). Same @codesandbox/sandpack-react mock boundary as
 * the existing file, extended so useSandpack().listen's callback is
 * capturable and callable from the test to simulate real 'start'/'done'
 * lifecycle messages.
 */

const h = vi.hoisted(() => ({ listeners: [] as Array<(msg: { type: string }) => void> }))

vi.mock('@codesandbox/sandpack-react', () => ({
  SandpackProvider: (props: any) => React.createElement('div', { 'data-testid': 'sandpack-provider' }, props.children),
  SandpackPreview: () => React.createElement('div', { 'data-testid': 'sandpack-preview-inner' }),
  SandpackLayout: (props: any) => React.createElement('div', null, props.children),
  useSandpack: () => ({
    listen: (cb: (msg: { type: string }) => void) => {
      h.listeners.push(cb)
      return () => { h.listeners.splice(h.listeners.indexOf(cb), 1) }
    },
  }),
}))

vi.mock('@/lib/sandpack/jsx-fixer', () => ({ fixJsxErrors: (code: string) => code }))
vi.mock('@/lib/sandpack/setup', () => ({ getBuiltinFiles: () => ({}) }))
vi.mock('@/lib/code-validator', () => ({ sanitizeForSandpack: (code: string) => code }))

import { SandpackPreview } from '@/components/chat/sandpack-preview'
import * as SandpackReactModule from '@codesandbox/sandpack-react'

function emit(type: string) {
  for (const cb of [...h.listeners]) cb({ type })
}

let host: HTMLElement
let root: Root

beforeEach(() => {
  h.listeners = []
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  act(() => { root?.unmount() })
  host.remove()
  vi.useRealTimers()
})

function renderWithTimeout(onTimeout: () => void, timeoutMs = 5000) {
  act(() => {
    root = createRoot(host)
    root.render(React.createElement(SandpackPreview, {
      files: { '/App.tsx': "export default function App(){ return null }" },
      timeoutMs,
      onTimeout,
    }))
  })
}

describe('SandpackResilientTimeout — real watchdog lifecycle (#1204)', () => {
  it('does not mount the watchdog at all when timeoutMs/onTimeout are omitted (existing opt-in-only behavior preserved)', () => {
    act(() => {
      root = createRoot(host)
      root.render(React.createElement(SandpackPreview, { files: { '/App.tsx': 'export default function App(){return null}' } }))
    })
    expect(h.listeners.length).toBe(0)
  })

  it('fires onTimeout if "start" never arrives within timeoutMs of mount (the self-hosted-bundler compile-never-began gap)', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    renderWithTimeout(onTimeout, 5000)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('does not fire while a genuine "start" has arrived and "done" follows before the (re-armed) timeout', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    renderWithTimeout(onTimeout, 5000)
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { emit('start') })
    act(() => { vi.advanceTimersByTime(3000) })
    act(() => { emit('done') })
    act(() => { vi.advanceTimersByTime(10000) })
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('fires onTimeout if "start" arrives but "done" never follows within timeoutMs (the documented unpkg-hang gap)', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    renderWithTimeout(onTimeout, 5000)
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { emit('start') }) // re-arms a fresh 5000ms window from here
    act(() => { vi.advanceTimersByTime(5000) })
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('never fires onTimeout twice even if the timer somehow outlives the first fire', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    renderWithTimeout(onTimeout, 1000)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onTimeout).toHaveBeenCalledTimes(1)
    act(() => { emit('done') })
    act(() => { vi.advanceTimersByTime(10000) })
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('cleans up its listener and timer on unmount without throwing', () => {
    vi.useFakeTimers()
    renderWithTimeout(vi.fn(), 5000)
    expect(() => { act(() => { root.unmount() }) }).not.toThrow()
    expect(h.listeners.length).toBe(0)
  })
})

describe('SandpackErrorBoundary — real render-crash fallback (#1204)', () => {
  // SandpackErrorBoundary wraps everything SandpackPreview renders
  // (SandpackProvider and its whole tree), so making the mocked
  // SandpackProvider throw exercises the REAL boundary — its own
  // getDerivedStateFromError + fallback render + Retry button — the same
  // path a genuine Sandpack render crash hits live.
  it('catches a real render error from inside the tree and shows the honest fallback message', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = SandpackReactModule.SandpackProvider
    ;(SandpackReactModule as any).SandpackProvider = () => {
      throw new Error('Unexpected token in generated code')
    }

    act(() => {
      root = createRoot(host)
      root.render(React.createElement(SandpackPreview, { files: { '/App.tsx': 'x' } }))
    })

    expect(host.textContent).toContain('Preview failed to render')
    expect(host.textContent).toContain('Unexpected token in generated code')
    expect(host.querySelector('button')?.textContent).toBe('Retry')

    ;(SandpackReactModule as any).SandpackProvider = original
    consoleError.mockRestore()
  })

  it('clicking Retry resets the boundary so a subsequent clean render can succeed', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = SandpackReactModule.SandpackProvider
    let shouldThrow = true
    ;(SandpackReactModule as any).SandpackProvider = (props: any) => {
      if (shouldThrow) throw new Error('transient crash')
      return React.createElement('div', { 'data-testid': 'sandpack-provider' }, props.children)
    }

    act(() => {
      root = createRoot(host)
      root.render(React.createElement(SandpackPreview, { files: { '/App.tsx': 'x' } }))
    })
    expect(host.textContent).toContain('Preview failed to render')

    shouldThrow = false
    const retryBtn = host.querySelector('button') as HTMLButtonElement
    act(() => { retryBtn.click() })

    expect(host.textContent).not.toContain('Preview failed to render')
    expect(host.querySelector('[data-testid="sandpack-provider"]')).not.toBeNull()

    ;(SandpackReactModule as any).SandpackProvider = original
    consoleError.mockRestore()
  })
})
