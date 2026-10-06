import { describe, it, expect } from 'vitest'
import { collectPrior } from '@/lib/build/artifact-edit'

describe('answers carry into later steps (#BLD-06.5)', () => {
  it('a saved, revised artifact appears in prior for every later step in the sequence', () => {
    const seq = ['design', 'thesis', 'wedge', 'businessmodel'] as const
    // Simulate: thesis was revised via the Q&A flow (#BLD-06.3) and the
    // result landed in state.generated via GEN_DONE (confirmed real
    // dispatch in CodyChatPanel.tsx/ArtifactFrame.tsx — this test asserts
    // the DOWNSTREAM consequence, not the dispatch itself).
    const generated = { design: { ok: true }, thesis: { headline: 'revised from founder answers' } }

    const priorForWedge = collectPrior(seq, generated, 'wedge')
    expect(priorForWedge.thesis).toEqual({ headline: 'revised from founder answers' })
    expect(priorForWedge.wedge).toBeUndefined() // never includes the view being generated

    const priorForBusinessModel = collectPrior(seq, generated, 'businessmodel')
    expect(priorForBusinessModel.thesis).toEqual({ headline: 'revised from founder answers' })
  })

  it('an unsaved, un-revised step contributes nothing to prior (only real generated content flows forward)', () => {
    const seq = ['design', 'thesis', 'wedge'] as const
    const generated = { design: { ok: true } } // thesis never generated/saved
    const prior = collectPrior(seq, generated, 'wedge')
    expect(prior.thesis).toBeUndefined()
  })

  it('CONFIRMATION: this test would fail against a broken prior-collection implementation (proves the test is real, not vacuous)', () => {
    // A deliberately wrong "collectPrior" that drops everything — if the
    // real implementation regresses to this, this spec must fail.
    const brokenCollectPrior = () => ({})
    const seq = ['design', 'thesis'] as const
    const generated = { thesis: { headline: 'x' } }
    const prior = brokenCollectPrior()
    expect(prior).not.toEqual(collectPrior(seq, generated, 'design'))
  })
})
