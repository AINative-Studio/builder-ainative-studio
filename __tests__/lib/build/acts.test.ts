import { describe, it, expect } from 'vitest'
import { APP_ACT_LABELS, COMPANY_ACT_LABELS, ACT_LABELS, type ActLabel } from '@/lib/build/acts'

/**
 * lib/build/acts — per-track act labels (2026-09-09: split from one flat
 * ACT_LABELS list). Real bug this split fixes: the App track's act-bar
 * always showed "Company" (an act that track never has) and had no visible
 * "Design" act even after #591 made design a real tracked step — the bar
 * jumped straight from Idea to Build MVP.
 */

describe('APP_ACT_LABELS', () => {
  it('includes Design as the second act (Idea -> Design -> Build MVP -> Launch -> Live)', () => {
    expect(APP_ACT_LABELS).toEqual(['Idea', 'Design', 'Build MVP', 'Launch', 'Live'])
  })

  it('has exactly 5 entries', () => {
    expect(APP_ACT_LABELS).toHaveLength(5)
  })

  it('never mentions "Company" — the App track has no such act', () => {
    expect(APP_ACT_LABELS).not.toContain('Company')
  })
})

describe('COMPANY_ACT_LABELS', () => {
  it('is unchanged from the original 5-act sequence (no Design step on this track, #601)', () => {
    expect(COMPANY_ACT_LABELS).toEqual(['Idea', 'Build MVP', 'Launch', 'Company', 'Live'])
  })

  it('has exactly 5 entries', () => {
    expect(COMPANY_ACT_LABELS).toHaveLength(5)
  })

  it('never mentions "Design" — the Company track has no code path for it (#601)', () => {
    expect(COMPANY_ACT_LABELS).not.toContain('Design')
  })
})

describe('ACT_LABELS (back-compat alias)', () => {
  it('mirrors COMPANY_ACT_LABELS (the pre-split universal default)', () => {
    expect(ACT_LABELS).toEqual(COMPANY_ACT_LABELS)
  })
})

describe('ActLabel type', () => {
  it('covers every value from both label sets (type-level check via runtime exhaustiveness)', () => {
    const all: ActLabel[] = [...APP_ACT_LABELS, ...COMPANY_ACT_LABELS]
    const set = new Set<string>(all)
    for (const label of ['Idea', 'Design', 'Build MVP', 'Launch', 'Company', 'Live']) {
      expect(set.has(label)).toBe(true)
    }
  })
})
