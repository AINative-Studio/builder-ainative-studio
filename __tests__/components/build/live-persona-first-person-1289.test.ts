import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #1289 — Cody's persona/copy should speak in first person ("I", "I'm
 * building") to the founder, never third person ("Cody is building",
 * "the system"). Real feedback: the reference tone is a warm, first-person
 * partner voice, not a status report about a separate entity named "Cody".
 *
 * These are pure copy/string changes with no branching logic, so per the
 * task's own TDD scoping, a source-text assertion is sufficient: it proves
 * the OLD third-person strings are gone and the NEW first-person strings
 * are present, without needing a full Live.tsx component mount (which would
 * require stubbing a large amount of unrelated fetch/session/context state).
 */
describe('Live.tsx nightly-loop/swarm status copy is first person (#1289)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('does not say "Cody runs the nightly loop" (third person)', () => {
    expect(source).not.toContain('Cody runs the nightly loop')
  })

  it('does not say "Cody is building and running your company" (third person)', () => {
    expect(source).not.toContain('Cody is building and running your company')
  })

  it('uses first-person "I run the nightly loop" in the plan-funnel banner', () => {
    expect(source).toContain('I run the nightly loop on your company — enrolled.')
  })

  it('uses first-person "I\'m building and running your company" in the plan-funnel banner', () => {
    expect(source).toContain("I'm building and running your company. Custom domains unlocked.")
  })

  it('uses first-person copy in the "Hire the swarm" card body (activePlan branch)', () => {
    expect(source).toContain('I run the nightly loop on your company.')
  })

  it('uses first-person copy in the "Hire the swarm" card body (enrolled branch)', () => {
    expect(source).toContain('Enrolled. I run the nightly loop on your company.')
  })
})

describe('proposal.ts pay-gate headline copy is first person (#1289)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'lib/build/proposal.ts'),
    'utf8',
  )

  it('does not say "Here\'s what Cody builds next" (third person)', () => {
    expect(source).not.toContain("Here’s what Cody builds next")
    expect(source).not.toContain("Here's what Cody builds next")
  })

  it('does not say "Here\'s what Cody is building" (third person)', () => {
    expect(source).not.toContain("Here’s what Cody is building")
    expect(source).not.toContain("Here's what Cody is building")
  })

  it('uses first-person "I\'m building next" framing when sawPreview is true', () => {
    expect(source).toMatch(/I['’]m building next/)
  })

  it('uses first-person "I\'m building for" framing when sawPreview is false', () => {
    expect(source).toMatch(/I['’]m building for/)
  })
})
