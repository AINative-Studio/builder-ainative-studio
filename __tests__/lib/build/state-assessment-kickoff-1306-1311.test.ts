import { describe, it, expect } from 'vitest'
import { buildReducer, initialBuildState } from '@/lib/build/state'

/**
 * #1306 — real site-assessment state (existingSiteAssessment) fed by a light
 * fetch+parse pass on a founder-supplied URL during kickoff.
 * #1311 — founder-type classification (founderType) + the ONE bounded
 * behavioral hook: an architect-type founder sees an extra review step
 * (founderReviewPending) before a build proceeds; hustler/operator do not.
 */

describe('existingSiteAssessment (#1306)', () => {
  it('defaults to null', () => {
    expect(initialBuildState.existingSiteAssessment).toBeNull()
  })

  it('SET_SITE_ASSESSMENT stores a successful assessment result', () => {
    const assessment = {
      hasTitle: true, title: 'Acme',
      hasMetaDescription: false, metaDescription: '', metaDescriptionThin: false,
      hasH1: false, hasH2: true, h1Count: 0,
      summary: 'no H1 tag, thin meta description',
    }
    const next = buildReducer(initialBuildState, {
      type: 'SET_SITE_ASSESSMENT', url: 'https://acme.example.com', assessment,
    })
    expect(next.existingSiteAssessment).toEqual({
      url: 'https://acme.example.com', ok: true, assessment, error: '',
    })
  })

  it('SITE_ASSESSMENT_FAIL stores a clear, honest failure — never a fake success', () => {
    const next = buildReducer(initialBuildState, {
      type: 'SITE_ASSESSMENT_FAIL', url: 'https://bad.example.com', error: 'Could not reach that site (timed out).',
    })
    expect(next.existingSiteAssessment).toEqual({
      url: 'https://bad.example.com', ok: false, assessment: null,
      error: 'Could not reach that site (timed out).',
    })
  })

  it('a later SET_SITE_ASSESSMENT replaces a prior failed attempt', () => {
    const failed = buildReducer(initialBuildState, {
      type: 'SITE_ASSESSMENT_FAIL', url: 'https://acme.example.com', error: 'timeout',
    })
    const assessment = {
      hasTitle: true, title: 'Acme',
      hasMetaDescription: true, metaDescription: 'x', metaDescriptionThin: true,
      hasH1: true, hasH2: false, h1Count: 1,
      summary: 'looks healthy',
    }
    const retried = buildReducer(failed, {
      type: 'SET_SITE_ASSESSMENT', url: 'https://acme.example.com', assessment,
    })
    expect(retried.existingSiteAssessment?.ok).toBe(true)
  })
})

describe('founderType (#1311)', () => {
  it('defaults to empty string (not yet classified)', () => {
    expect(initialBuildState.founderType).toBe('')
  })

  it('SET_FOUNDER_TYPE sets the classification', () => {
    const next = buildReducer(initialBuildState, { type: 'SET_FOUNDER_TYPE', founderType: 'architect' })
    expect(next.founderType).toBe('architect')
  })

  it('SET_FOUNDER_TYPE("architect") also flags founderReviewPending — the one bounded behavioral hook', () => {
    const next = buildReducer(initialBuildState, { type: 'SET_FOUNDER_TYPE', founderType: 'architect' })
    expect(next.founderReviewPending).toBe(true)
  })

  it('SET_FOUNDER_TYPE("hustler") does NOT flag founderReviewPending', () => {
    const next = buildReducer(initialBuildState, { type: 'SET_FOUNDER_TYPE', founderType: 'hustler' })
    expect(next.founderReviewPending).toBe(false)
  })

  it('SET_FOUNDER_TYPE("operator") does NOT flag founderReviewPending', () => {
    const next = buildReducer(initialBuildState, { type: 'SET_FOUNDER_TYPE', founderType: 'operator' })
    expect(next.founderReviewPending).toBe(false)
  })

  it('CLEAR_FOUNDER_REVIEW clears the pending review flag once the founder confirms', () => {
    const flagged = buildReducer(initialBuildState, { type: 'SET_FOUNDER_TYPE', founderType: 'architect' })
    const cleared = buildReducer(flagged, { type: 'CLEAR_FOUNDER_REVIEW' })
    expect(cleared.founderReviewPending).toBe(false)
  })
})
