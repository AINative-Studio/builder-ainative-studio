import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * User-reported regression (2026-10-07): CodyChatPanel.tsx and
 * KickoffQuestions.tsx both shipped using real className strings that had
 * ZERO corresponding CSS anywhere in modernist.css — confirmed by grep
 * returning no matches for any of them. The components' own tests (jsdom,
 * behavior/DOM-structure only) never caught this, since jsdom doesn't load
 * stylesheets. This file closes that gap: it parses the actual stylesheet
 * text and asserts each class a component references has at least one real
 * rule — the same technique __tests__/app/modernist-mobile.test.ts already
 * uses for breakpoint coverage, applied here to existence coverage.
 *
 * Deliberately only covers the two components involved in this incident,
 * not a crawl of every className in the codebase — the failure mode this
 * guards is "the file was never written," and it's cheap to extend per
 * incident rather than try to be exhaustive up front.
 */

const css = readFileSync(join(__dirname, '../../app/modernist.css'), 'utf8')

function hasRuleFor(className: string): boolean {
  // Matches `.className` as a real selector token — not inside a comment or
  // as a substring of a longer class name (e.g. .m-cody-chat must not match
  // from inside .m-cody-chat-panel's own definition check).
  const re = new RegExp(`\\.${className.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![\\w-])`)
  return re.test(css)
}

describe('CodyChatPanel.tsx classes all have real CSS (2026-10-07 incident)', () => {
  const classes = [
    'm-cody-chat-panel',
    'm-cody-chat-header',
    'm-cody-chat-log',
    'm-cody-chat-line',
    'm-cody-explain-gate',
    'm-cody-save-row',
    'm-cody-questions',
    'm-cody-question',
    'm-cody-question-text',
    'm-cody-question-suggestions',
    'm-cody-suggestion',
    'm-cody-question-freetext',
    'm-cody-questions-actions',
    'm-cody-chat-input-row',
    'm-cody-chat-input',
  ]

  it.each(classes)('%s has a real CSS rule', (className) => {
    expect(hasRuleFor(className)).toBe(true)
  })
})

describe('KickoffQuestions.tsx classes all have real CSS (2026-10-07 incident)', () => {
  const classes = ['m-kickoff-suggestions', 'm-kickoff-freetext-row']

  it.each(classes)('%s has a real CSS rule', (className) => {
    expect(hasRuleFor(className)).toBe(true)
  })
})

describe('.m-ws-body 3-column grid never sizes a column by unconstrained content (2026-10-07 incident)', () => {
  it('no column is "auto" — the right panel column was auto-sized, let unstyled text crush the center column', () => {
    const match = css.match(/\.m-ws-body\s*\{[^}]*grid-template-columns:\s*([^;]+);/)
    expect(match).not.toBeNull()
    const columns = match![1].trim()
    expect(columns).not.toMatch(/\bauto\b/)
  })

  it('.m-center has min-width: 0 so it can actually shrink inside the grid instead of overflowing', () => {
    const match = css.match(/\.m-center\s*\{[^}]*\}/)
    expect(match).not.toBeNull()
    expect(match![0]).toMatch(/min-width:\s*0/)
  })
})
