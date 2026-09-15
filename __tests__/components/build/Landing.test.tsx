// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom doesn't implement real media playback — HTMLMediaElement.play()
  // throws "not implemented" unless stubbed.
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

/**
 * Landing (Updated_builder_landing design, 2026-09-14) — the four-beat
 * scrollytelling hero plus Cody's beam-down sequence and real ambient audio
 * (replacing the earlier Unsplash-photo/no-audio version).
 */

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: {}, dispatch: dispatchMock }),
}))

const useSessionMock = vi.fn(() => ({ status: 'unauthenticated' }))
vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}))

import { Landing } from '@/components/build/screens/Landing'

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
  useSessionMock.mockReturnValue({ status: 'unauthenticated' } as any)
})

describe('Landing — new scrollytelling design', () => {
  it('renders the BUILDER nav title and both hero CTAs', () => {
    render(<Landing />)
    expect(host.textContent).toContain('BUILDER')
    expect(host.querySelector('[data-testid="landing-get-started"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="landing-get-started-2"]')).toBeTruthy()
  })

  it('shows Sign in when signed out, Open Builder when authenticated', () => {
    render(<Landing />)
    expect(host.querySelector('[data-testid="landing-signin"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="landing-open-builder"]')).toBeFalsy()

    act(() => { root.unmount() })
    host.remove()
    useSessionMock.mockReturnValue({ status: 'authenticated' } as any)
    render(<Landing />)
    expect(host.querySelector('[data-testid="landing-open-builder"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="landing-signin"]')).toBeFalsy()
  })

  it('"Get started" dispatches GOTO_SCREEN to start, scrolled to top', () => {
    render(<Landing />)
    const btn = host.querySelector('[data-testid="landing-get-started"]') as HTMLButtonElement
    act(() => { btn.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'start' })
  })

  it('renders the new beat copy: hero, You Are Not Alone, cofounder-from-another-world, close-out', () => {
    render(<Landing />)
    expect(host.textContent).toContain('The Company That Builds Itself')
    expect(host.textContent).toContain('You Are Not Alone')
    expect(host.textContent).toContain('A cofounder from another world.')
    expect(host.textContent).toContain('Build a company tonight.')
  })

  it('renders Cody\'s beam-down sequence (ship, beam, 8-bit sprite)', () => {
    render(<Landing />)
    expect(host.querySelector('.m-land-ship')).toBeTruthy()
    expect(host.querySelector('.m-land-beam')).toBeTruthy()
    const sprite = host.querySelector('.m-land-cody-sprite img') as HTMLImageElement
    expect(sprite).toBeTruthy()
    expect(sprite.src).toContain('ainative-8bit-cody-transparent-512.png')
  })

  it('sound starts off, and the toggle flips its label/dot state', () => {
    render(<Landing />)
    const toggle = host.querySelector('[data-testid="landing-sound-toggle"]') as HTMLButtonElement
    expect(toggle.textContent).toContain('Sound off')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    act(() => { toggle.click() })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('footer legal links point to the real ainative.studio pages', () => {
    render(<Landing />)
    const html = host.innerHTML
    expect(html).toContain('href="https://ainative.studio/terms"')
    expect(html).toContain('href="https://ainative.studio/privacy"')
    expect(html).toContain('href="https://ainative.studio/acceptable-use"')
  })
})
