// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EnvSetup } from '@/components/env-setup'
import type { MissingEnvVar } from '@/lib/env-check'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — EnvSetup (components/env-setup.tsx, 84 lines,
 * reached live via app/page.tsx) had zero test coverage.
 */

function makeVar(overrides: Partial<MissingEnvVar> = {}): MissingEnvVar {
  return { name: 'DATABASE_URL', description: 'Database connection string', example: 'postgres://localhost/db', required: true, ...overrides }
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
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('EnvSetup — real .env content/copy coverage (#1204)', () => {
  it('renders the real NAME=example line for a var with a real example value', () => {
    render(React.createElement(EnvSetup, { missingVars: [makeVar({ name: 'API_KEY', example: 'sk-test-123' })] }))

    expect(host.querySelector('pre')?.textContent).toBe('API_KEY=sk-test-123')
  })

  it('renders a real bare NAME= line for a var with a genuinely empty example', () => {
    render(React.createElement(EnvSetup, { missingVars: [makeVar({ name: 'SECRET_TOKEN', example: '' })] }))

    expect(host.querySelector('pre')?.textContent).toBe('SECRET_TOKEN=')
  })

  it('joins multiple real vars with real newlines, preserving their given order', () => {
    render(React.createElement(EnvSetup, {
      missingVars: [makeVar({ name: 'A', example: '1' }), makeVar({ name: 'B', example: '' }), makeVar({ name: 'C', example: '3' })],
    }))

    expect(host.querySelector('pre')?.textContent).toBe('A=1\nB=\nC=3')
  })

  it('renders an empty pre block when missingVars is genuinely empty, without crashing', () => {
    render(React.createElement(EnvSetup, { missingVars: [] }))

    expect(host.querySelector('pre')?.textContent).toBe('')
  })

  it('clicking Copy writes the real exact .env content to the real clipboard and shows the real "Copied!" state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.useFakeTimers()

    render(React.createElement(EnvSetup, { missingVars: [makeVar({ name: 'X', example: 'y' })] }))

    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Copy to Clipboard')) as HTMLButtonElement
    await act(async () => { btn.click(); await Promise.resolve() })

    expect(writeText).toHaveBeenCalledWith('X=y')
    expect(host.textContent).toContain('Copied!')

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(host.textContent).not.toContain('Copied!')
    expect(host.textContent).toContain('Copy to Clipboard')

    vi.useRealTimers()
  })

  it('a real rejected clipboard write never crashes and never shows the Copied state', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(React.createElement(EnvSetup, { missingVars: [makeVar()] }))
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Copy to Clipboard')) as HTMLButtonElement
    await act(async () => { btn.click(); await Promise.resolve() })

    expect(host.textContent).not.toContain('Copied!')
    expect(host.textContent).toContain('Copy to Clipboard')
    consoleSpy.mockRestore()
  })

  it('shows the real "Setup Required" heading and the real restart hint', () => {
    render(React.createElement(EnvSetup, { missingVars: [makeVar()] }))

    expect(host.textContent).toContain('Setup Required')
    expect(host.textContent).toContain('restart your server')
  })
})
