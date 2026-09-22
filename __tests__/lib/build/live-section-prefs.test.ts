// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { isSectionOpen, saveSectionOpen } from '@/lib/build/live-section-prefs'

describe('live-section-prefs (#803)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to open (true) when never set', () => {
    expect(isSectionOpen('acme', 'tasks')).toBe(true)
  })

  it('persists a collapsed choice per project + section', () => {
    saveSectionOpen('acme', 'tasks', false)
    expect(isSectionOpen('acme', 'tasks')).toBe(false)
  })

  it('persists an explicit re-open choice', () => {
    saveSectionOpen('acme', 'tasks', false)
    saveSectionOpen('acme', 'tasks', true)
    expect(isSectionOpen('acme', 'tasks')).toBe(true)
  })

  it('keeps preferences independent per section id', () => {
    saveSectionOpen('acme', 'tasks', false)
    expect(isSectionOpen('acme', 'growth')).toBe(true)
  })

  it('keeps preferences independent per project slug', () => {
    saveSectionOpen('acme', 'tasks', false)
    expect(isSectionOpen('other-co', 'tasks')).toBe(true)
  })

  it('fails open (true) for a blank slug or section id', () => {
    expect(isSectionOpen('', 'tasks')).toBe(true)
    expect(isSectionOpen('acme', '')).toBe(true)
  })
})
