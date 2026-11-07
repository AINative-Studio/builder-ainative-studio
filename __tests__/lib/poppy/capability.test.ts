import { describe, it, expect } from 'vitest'
import { answerMessage } from '@/lib/poppy/capability'

/**
 * #1842 — the REAL capability behind a Poppy conversation: keyword Q&A over
 * Builder's real guides + Help Center corpus (lib/help/stuck-search.ts, the
 * same retrieval the live /api/help/stuck endpoint uses). Pure and local —
 * no network, no model call — so these assertions run against the real
 * corpus, not a fixture.
 */
describe('answerMessage (#1842)', () => {
  it('answers a real Builder question from the real docs corpus, with citations', () => {
    const { text, citations } = answerMessage('how do I add a database to my app?')
    expect(citations.length).toBeGreaterThan(0)
    // Every citation is a real absolute deep link into Builder's own docs.
    for (const c of citations) {
      expect(c).toMatch(/^https:\/\/builder\.ainative\.studio\/(guides|help)/)
    }
    expect(text).toMatch(/documentation says/)
    // The answer carries real corpus copy, not a canned sentence.
    expect(text.length).toBeGreaterThan(100)
  })

  it('answers a pricing question from the real corpus', () => {
    const { citations } = answerMessage('how much does it cost?')
    expect(citations.length).toBeGreaterThan(0)
  })

  it('answers a deployment question from the real corpus', () => {
    const { citations } = answerMessage('how do I deploy my app to a live URL?')
    expect(citations.length).toBeGreaterThan(0)
  })

  it('says plainly when the corpus has no answer instead of inventing one', () => {
    const { text } = answerMessage('zzzqqq unrelated xylophone quasar nonsense')
    expect(text).toMatch(/could not find anything/i)
    // Still truthful and useful: points at real entry points.
    expect(text).toContain('builder.ainative.studio/build')
  })

  it('handles empty / whitespace text without throwing', () => {
    for (const t of ['', '   ', '\n']) {
      const { text, citations } = answerMessage(t)
      expect(text).toMatch(/did not receive any question/i)
      expect(citations).toEqual([])
    }
  })

  it('never throws on hostile input', () => {
    const inputs = [
      '<script>alert(1)</script>',
      'a'.repeat(10000),
      '🙂'.repeat(500),
      '../../etc/passwd',
      JSON.stringify({ nested: { deep: true } }),
    ]
    for (const i of inputs) {
      expect(() => answerMessage(i)).not.toThrow()
    }
  })

  it('is deterministic — the same question yields the same answer', () => {
    const a = answerMessage('what can Cody build?')
    const b = answerMessage('what can Cody build?')
    expect(a).toEqual(b)
  })
})
