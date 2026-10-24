// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { OnboardingVideo } from '@/components/build/OnboardingVideo'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom doesn't implement real media playback.
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

/**
 * #1204 (Coverage Phase 4) — OnboardingVideo (components/build/OnboardingVideo.tsx,
 * 127 lines, reached live via components/build/screens/Live.tsx) had zero
 * test coverage.
 */

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
  vi.clearAllMocks()
})

describe('OnboardingVideo — real placeholder/playback coverage (#1204)', () => {
  it('shows the real "coming soon" placeholder (never a raw black box) when there is genuinely no src', () => {
    render(React.createElement(OnboardingVideo, { src: '' }))

    expect(byTestId('onboarding-video-placeholder')).not.toBeNull()
    expect(byTestId('onboarding-video-wrap')?.getAttribute('data-placeholder')).toBe('true')
    expect(host.textContent).toContain('A short walkthrough is on its way')
    expect(byTestId('onboarding-video-el')).toBeNull()
  })

  it('renders the real native <video> element with the real src/poster when genuinely provided', () => {
    render(React.createElement(OnboardingVideo, { src: '/videos/onboarding.mp4', poster: '/images/poster.jpg' }))

    const video = byTestId<HTMLVideoElement>('onboarding-video-el')!
    expect(video.getAttribute('src')).toBe('/videos/onboarding.mp4')
    expect(video.getAttribute('poster')).toBe('/images/poster.jpg')
    expect(byTestId('onboarding-video-wrap')?.hasAttribute('data-placeholder')).toBe(false)
    expect(host.textContent).toContain('Watch how Cody builds and runs companies autonomously')
  })

  it('never sets a poster attribute on the real video when genuinely none is given', () => {
    render(React.createElement(OnboardingVideo, { src: '/videos/onboarding.mp4', poster: '' }))
    expect(byTestId<HTMLVideoElement>('onboarding-video-el')!.hasAttribute('poster')).toBe(false)
  })

  it('shows the real play overlay button only while genuinely not playing', () => {
    render(React.createElement(OnboardingVideo, { src: '/videos/onboarding.mp4' }))
    expect(byTestId('onboarding-video-play-btn')).not.toBeNull()
  })

  it('a real play-button click calls the real video.play() and hides the overlay once the real onPlaying event fires', async () => {
    render(React.createElement(OnboardingVideo, { src: '/videos/onboarding.mp4' }))

    const video = byTestId<HTMLVideoElement>('onboarding-video-el')!
    const playBtn = byTestId<HTMLButtonElement>('onboarding-video-play-btn')!

    await act(async () => { playBtn.click(); await Promise.resolve() })
    expect(video.play).toHaveBeenCalled()

    await act(async () => { video.dispatchEvent(new Event('playing')) })
    expect(byTestId('onboarding-video-play-btn')).toBeNull()
  })

  it('a real second click while genuinely playing calls video.pause() instead of play()', async () => {
    render(React.createElement(OnboardingVideo, { src: '/videos/onboarding.mp4' }))

    const video = byTestId<HTMLVideoElement>('onboarding-video-el')!
    Object.defineProperty(video, 'paused', { value: false, configurable: true })
    const playBtn = byTestId<HTMLButtonElement>('onboarding-video-play-btn')!

    await act(async () => { playBtn.click() })

    expect(video.pause).toHaveBeenCalled()
    expect(video.play).not.toHaveBeenCalled()
  })

  it('the real overlay reappears once the real video genuinely pauses', async () => {
    render(React.createElement(OnboardingVideo, { src: '/videos/onboarding.mp4' }))
    const video = byTestId<HTMLVideoElement>('onboarding-video-el')!

    await act(async () => { video.dispatchEvent(new Event('playing')) })
    expect(byTestId('onboarding-video-play-btn')).toBeNull()

    await act(async () => { video.dispatchEvent(new Event('pause')) })
    expect(byTestId('onboarding-video-play-btn')).not.toBeNull()
  })

  it('the real overlay reappears once the real video genuinely ends', async () => {
    render(React.createElement(OnboardingVideo, { src: '/videos/onboarding.mp4' }))
    const video = byTestId<HTMLVideoElement>('onboarding-video-el')!

    await act(async () => { video.dispatchEvent(new Event('playing')) })
    await act(async () => { video.dispatchEvent(new Event('ended')) })

    expect(byTestId('onboarding-video-play-btn')).not.toBeNull()
  })

  it('never crashes when the real video.play() promise genuinely rejects (e.g. autoplay policy)', async () => {
    render(React.createElement(OnboardingVideo, { src: '/videos/onboarding.mp4' }))
    const video = byTestId<HTMLVideoElement>('onboarding-video-el')!
    ;(video.play as any).mockRejectedValueOnce(new Error('NotAllowedError'))

    const playBtn = byTestId<HTMLButtonElement>('onboarding-video-play-btn')!
    await expect(act(async () => { playBtn.click(); await Promise.resolve(); await Promise.resolve() })).resolves.not.toThrow()
  })
})
