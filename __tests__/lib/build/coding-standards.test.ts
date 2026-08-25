/**
 * #71 — AINative Engineering Standards / Definition of Done canonical constant.
 *
 * Properties under test:
 *   - the canonical set is grounded in the real AINative skills (every rule maps
 *     to a source skill; the load-bearing standards are all present),
 *   - each standard is well-formed (id/title/rule/source, unique ids),
 *   - the injectable context block lists every standard, in order, deterministically.
 */

import { describe, it, expect } from 'vitest'
import {
  CODING_STANDARDS,
  CODING_STANDARD_IDS,
  codingStandardsContextBlock,
  type CodingStandard,
} from '@/lib/build/coding-standards'

describe('coding-standards (#71)', () => {
  it('every standard is well-formed with a source skill', () => {
    for (const s of CODING_STANDARDS) {
      expect(s.id).toBeTruthy()
      expect(s.title).toBeTruthy()
      expect(s.rule.length).toBeGreaterThan(10)
      expect(s.source).toBeTruthy()
    }
  })

  it('has unique ids matching CODING_STANDARD_IDS', () => {
    const ids = CODING_STANDARDS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(CODING_STANDARD_IDS).toEqual(ids)
  })

  it('covers the load-bearing AINative standards from the real skills', () => {
    const ids = new Set(CODING_STANDARD_IDS)
    // TDD + coverage (mandatory-tdd)
    expect(ids.has('tdd')).toBe(true)
    expect(ids.has('coverage')).toBe(true)
    // primitives-first composition
    expect(ids.has('primitives-first')).toBe(true)
    // file-placement
    expect(ids.has('file-placement')).toBe(true)
    // git-workflow + branch naming
    expect(ids.has('git-workflow')).toBe(true)
    // NO AI attribution — the hard rule
    expect(ids.has('no-ai-attribution')).toBe(true)
    // security baseline
    expect(ids.has('security-baseline')).toBe(true)
  })

  it('grounds standards in the named AINative skills', () => {
    const sources = new Set(CODING_STANDARDS.map((s: CodingStandard) => s.source))
    expect(sources.has('mandatory-tdd')).toBe(true)
    expect(sources.has('file-placement')).toBe(true)
    expect(sources.has('ainative-git-workflow')).toBe(true)
    expect(sources.has('primitives-first')).toBe(true)
  })

  describe('codingStandardsContextBlock', () => {
    const block = codingStandardsContextBlock()

    it('is a deterministic header + one numbered line per standard + a footer', () => {
      expect(block).toBe(codingStandardsContextBlock()) // deterministic
      expect(block).toContain('AINATIVE ENGINEERING STANDARDS')
      for (let i = 0; i < CODING_STANDARDS.length; i++) {
        expect(block).toContain(`${i + 1}. ${CODING_STANDARDS[i].title}`)
      }
      expect(block).toContain('before it is considered done')
    })

    it('surfaces the 80% coverage bar and the no-AI-attribution rule verbatim', () => {
      expect(block).toContain('80%')
      expect(block.toLowerCase()).toContain('zero ai tool attribution')
    })

    it('does not interpolate the idea (idea-agnostic, consistent per build)', () => {
      // no template placeholders leaked
      expect(block).not.toContain('${')
      expect(block).not.toContain('undefined')
    })
  })
})
