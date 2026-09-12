// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'

/**
 * active-build (#669) — a fixed single-key localStorage pointer letting an
 * unconditional mount-time check (no ?screen=&company= URL params required)
 * find and resume a build in progress. See lib/build/active-build.ts's doc
 * comment for the full root-cause writeup.
 */

import { saveActiveBuild, loadActiveBuild, clearActiveBuild } from '@/lib/build/active-build'

const KEY = 'ainative_active_build'

beforeEach(() => {
  window.localStorage.clear()
})

describe('active-build (#669)', () => {
  it('round-trips a saved pointer', () => {
    saveActiveBuild({ slug: 'habanero-hub', screen: 'ws' })
    expect(loadActiveBuild()).toEqual({ slug: 'habanero-hub', screen: 'ws' })
  })

  it('returns null when nothing is stored', () => {
    expect(loadActiveBuild()).toBeNull()
  })

  it('clears the pointer', () => {
    saveActiveBuild({ slug: 'habanero-hub', screen: 'ws' })
    clearActiveBuild()
    expect(loadActiveBuild()).toBeNull()
  })

  it('overwrites a prior pointer with the latest save (one in-flight build at a time)', () => {
    saveActiveBuild({ slug: 'habanero-hub', screen: 'intake' })
    saveActiveBuild({ slug: 'habanero-hub', screen: 'ws' })
    expect(loadActiveBuild()).toEqual({ slug: 'habanero-hub', screen: 'ws' })
  })

  it('rejects a malformed stored record (missing slug)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ screen: 'ws' }))
    expect(loadActiveBuild()).toBeNull()
  })

  it('rejects a malformed stored record (missing screen)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ slug: 'habanero-hub' }))
    expect(loadActiveBuild()).toBeNull()
  })

  it('rejects unparsable JSON without throwing', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(() => loadActiveBuild()).not.toThrow()
    expect(loadActiveBuild()).toBeNull()
  })

  it('never throws on save even if localStorage is unavailable', () => {
    const original = window.localStorage.setItem
    // @ts-expect-error simulating a private-mode/quota failure
    window.localStorage.setItem = () => { throw new Error('quota exceeded') }
    expect(() => saveActiveBuild({ slug: 'x', screen: 'ws' })).not.toThrow()
    window.localStorage.setItem = original
  })
})
