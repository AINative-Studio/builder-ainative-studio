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

  it('sound defaults ON (opt-out, not opt-in) — real playback still awaits a genuine gesture, and the toggle can turn it off', () => {
    render(<Landing />)
    const toggle = host.querySelector('[data-testid="landing-sound-toggle"]') as HTMLButtonElement
    // Default reads as "on" immediately, before any gesture — playback itself
    // is honestly labeled as pending ("tap to start") since a real browser
    // can't autoplay audio without one, but the PREFERENCE is on by default.
    expect(toggle.textContent).toContain('Sound')
    expect(toggle.textContent).not.toContain('Sound off')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')

    // The visitor can still explicitly opt out.
    act(() => { toggle.click() })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.textContent).toContain('Sound off')
  })

  it('footer legal links point to the real ainative.studio pages', () => {
    render(<Landing />)
    const html = host.innerHTML
    expect(html).toContain('href="https://ainative.studio/terms"')
    expect(html).toContain('href="https://ainative.studio/privacy"')
    expect(html).toContain('href="https://ainative.studio/acceptable-use"')
  })

  it('the volume fade survives a first rAF timestamp that arrives before performance.now(), instead of silently dying (real bug, 2026-09-14)', () => {
    // jsdom genuinely enforces HTMLMediaElement.volume's [0,1] range (throws
    // IndexSizeError outside it) — the same real constraint that broke this
    // live. The throw happens INSIDE the rAF callback, which React/the
    // browser swallow as an uncaught async error rather than propagating
    // synchronously to the caller — so "doesn't throw" is not a strong
    // enough assertion. The real, user-visible consequence was: the thrown
    // frame never schedules its next rAF, so the fade loop dies and the
    // drone stays silent forever. That observable end-state is what this
    // test actually pins down.
    //
    // rAF timestamps mark frame START, which can arrive fractionally BEFORE
    // the performance.now() captured mid-frame in startAudio(). Simulate that
    // exact race on the FIRST frame only: it fires with a timestamp 0.1ms
    // earlier than "now" reported at call time. Later frames advance real
    // time normally so a healthy fade can actually reach its target.
    // `new Audio(...)` elements aren't appended to the DOM, so capture the
    // drone instance directly off the real global Audio constructor.
    const created: HTMLAudioElement[] = []
    const RealAudio = window.Audio
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).Audio = class extends RealAudio {
      constructor(src?: string) { super(src); created.push(this as unknown as HTMLAudioElement) }
    }

    // `performance.now()` is captured as `start` INSIDE startAudio(), which
    // only runs once the toggle is clicked — but other code (React's own
    // scheduler, etc.) genuinely calls performance.now() before that point,
    // so a single mockReturnValueOnce(...) lands on the WRONG call. Mock it
    // to always return a fixed value instead, so `start` is deterministic
    // regardless of how many earlier calls happen first.
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000)
    let first = true
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      const t = first ? 999.9 : 100000 // second+ frame: far enough past `start` to hit k=1
      first = false
      cb(t)
      return 1
    })

    render(<Landing />)
    // Sound now defaults ON — real playback starts from the visitor's first
    // scroll/gesture (the arm-listener), not from clicking the toggle (which
    // would now turn a default-on sound OFF). Simulate that first gesture.
    act(() => { window.dispatchEvent(new Event('scroll')) })

    const drone = created[0] // first Audio() constructed is the drone loop
    expect(drone).toBeTruthy()
    // A dead-on-first-frame fade leaves volume stuck at (or near) 0. A
    // healthy fade reaches its 0.6 target once later frames advance time.
    expect(drone.volume).toBeCloseTo(0.6, 5)

    rafSpy.mockRestore()
    nowSpy.mockRestore()
    window.Audio = RealAudio
  })
})
