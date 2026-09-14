import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  checkFrequencyCap,
  recordFrequencyCapHit,
  tryConsumeFrequencyCap,
  __resetFrequencyCapForTests,
} from '@/lib/build/frequency-cap'

/**
 * lib/build/frequency-cap — generic per-key "at most once per window" cap
 * (#742), extracted so any proactive-outreach caller (this issue's nightly
 * comms policy, and #743's digest cron in future) shares one primitive.
 */

describe('frequency-cap', () => {
  beforeEach(() => {
    __resetFrequencyCapForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows the first check for a never-seen key', () => {
    expect(checkFrequencyCap('company-a', 60_000).ok).toBe(true)
  })

  it('blocks a second consume within the window', () => {
    const first = tryConsumeFrequencyCap('company-a', 60_000)
    expect(first.ok).toBe(true)
    const second = tryConsumeFrequencyCap('company-a', 60_000)
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('rate_limited')
  })

  it('allows again once the window has elapsed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    expect(tryConsumeFrequencyCap('company-a', 1000).ok).toBe(true)
    vi.setSystemTime(new Date('2026-09-14T00:00:00.500Z'))
    expect(checkFrequencyCap('company-a', 1000).ok).toBe(false)
    vi.setSystemTime(new Date('2026-09-14T00:00:01.001Z'))
    expect(checkFrequencyCap('company-a', 1000).ok).toBe(true)
  })

  it('tracks separate keys independently', () => {
    expect(tryConsumeFrequencyCap('company-a', 60_000).ok).toBe(true)
    expect(tryConsumeFrequencyCap('company-b', 60_000).ok).toBe(true)
    expect(checkFrequencyCap('company-a', 60_000).ok).toBe(false)
    expect(checkFrequencyCap('company-b', 60_000).ok).toBe(false)
  })

  it('checkFrequencyCap does not itself consume the cap', () => {
    expect(checkFrequencyCap('company-a', 60_000).ok).toBe(true)
    expect(checkFrequencyCap('company-a', 60_000).ok).toBe(true)
    recordFrequencyCapHit('company-a')
    expect(checkFrequencyCap('company-a', 60_000).ok).toBe(false)
  })
})
