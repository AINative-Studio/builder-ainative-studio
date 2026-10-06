import { describe, it, expect } from 'vitest'
import { ARTIFACT_PROMPTS } from '@/lib/build/artifact-prompts'

// Note on scope: the JSON field name stays `unlike` (components/build/artifacts/
// company-artifacts.tsx:66,74 renders it as a real "Unlike the alternatives"
// section — renaming it would be a UI change out of this task's scope). What
// must change is the INSTRUCTION TEXT: the model should no longer be told to
// produce combative "unlike the alternatives" contrasts against named
// competitors — this test pins that softer framing, not the literal absence
// of the schema key's name.
describe('positioning prompt — no forced "unlike the alternatives" framing (#BLD-09)', () => {
  it('the real prompt-building function does not instruct the model to contrast against "the alternatives"', () => {
    const prompt = ARTIFACT_PROMPTS.positioning.user({
      idea: 'a scheduling app',
      track: 'company',
      companyName: 'Acme',
      prior: {},
    })
    expect(prompt.toLowerCase()).not.toContain('unlike the alternatives')
    expect(prompt.toLowerCase()).not.toContain('contrasts')
  })

  it('instructs positive differentiators instead', () => {
    const prompt = ARTIFACT_PROMPTS.positioning.user({
      idea: 'a scheduling app',
      track: 'company',
      companyName: 'Acme',
      prior: {},
    })
    expect(prompt.toLowerCase()).toContain('differentiators')
  })
})
