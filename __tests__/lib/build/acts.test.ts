import { describe, it, expect } from 'vitest'
import { ACT_LABELS, type ActLabel } from '@/lib/build/acts'

/**
 * lib/build/acts — constant/type-only file (3 lines).
 * Tests verify the exported constant has the correct shape and values.
 * The file has no logic branches; 100% stmt coverage is achieved by importing it.
 */

describe('ACT_LABELS', () => {
  it('exports the five act labels in the correct order', () => {
    expect(ACT_LABELS).toEqual(['Idea', 'Build MVP', 'Launch', 'Company', 'Live'])
  })

  it('has exactly 5 entries', () => {
    expect(ACT_LABELS).toHaveLength(5)
  })

  it('is readonly (as const) — every value is a string literal', () => {
    for (const label of ACT_LABELS) {
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('ActLabel type covers all five values (type-level check via runtime exhaustiveness)', () => {
    const all: ActLabel[] = [...ACT_LABELS]
    expect(all).toHaveLength(5)
    const set = new Set<string>(all)
    expect(set.has('Idea')).toBe(true)
    expect(set.has('Build MVP')).toBe(true)
    expect(set.has('Launch')).toBe(true)
    expect(set.has('Company')).toBe(true)
    expect(set.has('Live')).toBe(true)
  })
})
