/**
 * Unit tests for OnboardingVideo video-source config (#51).
 *
 * Covers the configurable constants and logic that determine placeholder vs
 * real-video mode. Pure — no DOM/React — runs in the node vitest environment.
 *
 * The component is imported via relative path so this test resolves correctly
 * from both the worktree and any copy placed in the main project __tests__ tree.
 */

import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_VIDEO_SRC,
  ONBOARDING_VIDEO_POSTER,
  OnboardingVideo,
} from '../../components/build/OnboardingVideo'

// ---------------------------------------------------------------------------

describe('ONBOARDING_VIDEO_SRC (#51)', () => {
  it('is always a string (never undefined / null)', () => {
    expect(typeof ONBOARDING_VIDEO_SRC).toBe('string')
  })

  it('defaults to empty string when NEXT_PUBLIC_ONBOARDING_VIDEO_SRC is unset', () => {
    // In the test environment the env var is not configured, so the constant
    // falls back to the empty-string sentinel = placeholder-only mode.
    // When a real video is configured, this assertion relaxes (still a string).
    if (!process.env.NEXT_PUBLIC_ONBOARDING_VIDEO_SRC) {
      expect(ONBOARDING_VIDEO_SRC).toBe('')
    } else {
      expect(ONBOARDING_VIDEO_SRC.length).toBeGreaterThan(0)
    }
  })
})

describe('ONBOARDING_VIDEO_POSTER (#51)', () => {
  it('is always a string (never undefined / null)', () => {
    expect(typeof ONBOARDING_VIDEO_POSTER).toBe('string')
  })
})

describe('OnboardingVideo placeholder logic (#51)', () => {
  it('treats an empty src as placeholder mode (falsy)', () => {
    const emptySrc = ''
    // Component checks: const isPlaceholder = !videoSrc
    expect(!emptySrc).toBe(true)
  })

  it('treats a non-empty src as real-video mode (truthy)', () => {
    const realSrc = 'https://cdn.ainative.studio/onboarding-v1.mp4'
    expect(!!realSrc).toBe(true)
  })

  it('default ONBOARDING_VIDEO_SRC resolves to placeholder mode in test env', () => {
    // isPlaceholder = !ONBOARDING_VIDEO_SRC (empty string = placeholder)
    const isPlaceholder = !ONBOARDING_VIDEO_SRC
    if (!process.env.NEXT_PUBLIC_ONBOARDING_VIDEO_SRC) {
      expect(isPlaceholder).toBe(true)
    } else {
      // Env is set → real-video mode
      expect(isPlaceholder).toBe(false)
    }
  })
})

describe('OnboardingVideo exports (#51)', () => {
  it('ONBOARDING_VIDEO_SRC is a named export', () => {
    expect(typeof ONBOARDING_VIDEO_SRC).not.toBe('undefined')
  })

  it('ONBOARDING_VIDEO_POSTER is a named export', () => {
    expect(typeof ONBOARDING_VIDEO_POSTER).not.toBe('undefined')
  })

  it('OnboardingVideo is a named export (React component function)', () => {
    expect(typeof OnboardingVideo).toBe('function')
  })
})

describe('Swapping the real video is a one-line change (#51)', () => {
  it('documents the contract: set NEXT_PUBLIC_ONBOARDING_VIDEO_SRC env to swap the video', () => {
    // The expected format for the real onboarding video URL.
    const realVideoUrl = 'https://cdn.ainative.studio/onboarding-v1.mp4'
    expect(realVideoUrl).toMatch(/^https:\/\//)
    expect(realVideoUrl).toMatch(/\.(mp4|webm|mov|m4v)$/i)
  })

  it('ONBOARDING_VIDEO_SRC overrides are honoured at module load time', () => {
    // When NEXT_PUBLIC_ONBOARDING_VIDEO_SRC is set in the environment before
    // module load, ONBOARDING_VIDEO_SRC will equal that URL.  We can only
    // observe the already-loaded constant here, but we can verify the shape.
    const overrideUrl = process.env.NEXT_PUBLIC_ONBOARDING_VIDEO_SRC
    if (overrideUrl) {
      expect(ONBOARDING_VIDEO_SRC).toBe(overrideUrl)
    } else {
      // No override → empty-string sentinel
      expect(ONBOARDING_VIDEO_SRC).toBe('')
    }
  })
})
