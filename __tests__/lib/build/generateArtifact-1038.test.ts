import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Tests for generateArtifact/isGenerationInFlight — the extracted generation
 * fetch+retry+dispatch sequence (lib/build/useAutoplay.ts), pulled out of
 * useAutoplay's autoplay-only effect so it can be invoked independent of
 * state.auto (#1038 remaining half).
 *
 * Covers:
 *  - the real request fires and GEN_DONE/GEN_FAIL dispatch correctly
 *  - the module-level in-flight guard de-dupes a concurrent call for the
 *    SAME view (the exact race the issue calls out: a manual on-demand
 *    trigger and "Keep going" racing for the same view)
 *  - two DIFFERENT views are never blocked by each other's in-flight state
 */

import { generateArtifact, isGenerationInFlight } from '@/lib/build/useAutoplay'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function baseOpts(overrides: Partial<Parameters<typeof generateArtifact>[2]> = {}) {
  return {
    idea: 'a coffee subscription platform',
    track: 'company' as const,
    companyName: 'Roastflow',
    companyId: 'roastflow-co',
    generated: {},
    seq: ['design', 'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30'],
    ...overrides,
  }
}

describe('generateArtifact (#1038) — fires independent of autoplay/auto state', () => {
  it('fires the real /api/build/artifact fetch for the given view and dispatches GEN_DONE on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: { headline: 'Harborline' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    await generateArtifact('businessModel', dispatch, baseOpts())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/build/artifact',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"view":"businessModel"'),
      }),
    )
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.idea).toBe('a coffee subscription platform')
    expect(sentBody.companyId).toBe('roastflow-co')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'GEN_DONE', view: 'businessModel', content: { headline: 'Harborline' },
    })
  })

  it('dispatches GEN_FAIL on a non-transient (4xx) failure without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'bad_request' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    await generateArtifact('positioning', dispatch, baseOpts())

    expect(fetchMock).toHaveBeenCalledTimes(1) // no retry for 4xx
    expect(dispatch).toHaveBeenCalledWith({ type: 'GEN_FAIL', view: 'positioning', error: 'bad_request' })
  })

  // Dedicated, never-reused view names below (not reused by any other test in
  // this file) — generateArtifact's in-flight guard is module-level by design
  // (#1038: it must be visible across BOTH the autoplay effect and
  // ArtifactFrame's manual trigger, which are different call sites entirely),
  // so a view left "in flight" by a never-resolving mock would otherwise leak
  // into later tests that happen to reuse the same view name.

  it('is a no-op (no fetch, resolves immediately) when a request for the SAME view is already in flight', async () => {
    const fetchMock = vi.fn(() => new Promise(() => {})) // never resolves — simulates an in-flight request
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    // Fire the first call — it stays pending (fetch never resolves).
    void generateArtifact('__race_same_view__', dispatch, baseOpts())
    await new Promise((r) => setTimeout(r, 0)) // let the fetch() call actually fire
    expect(isGenerationInFlight('__race_same_view__')).toBe(true)

    // A second call for the SAME view while the first is still in flight
    // must be a true no-op: no second fetch, no dispatch, resolves right away.
    const second = generateArtifact('__race_same_view__', dispatch, baseOpts())
    await second
    expect(fetchMock).toHaveBeenCalledTimes(1) // not 2 — the race is prevented
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does NOT block a DIFFERENT view while one view is in flight', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {})) // '__race_view_a__' never resolves
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: { headline: 'ok' } }) }) // '__race_view_b__' resolves
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    void generateArtifact('__race_view_a__', dispatch, baseOpts())
    // Let '__race_view_a__'s fetch() call actually fire before starting
    // '__race_view_b__', so the mock's call order (and therefore which
    // mockImplementationOnce each gets) matches which view issued it.
    await new Promise((r) => setTimeout(r, 0))
    await generateArtifact('__race_view_b__', dispatch, baseOpts())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledWith({ type: 'GEN_DONE', view: '__race_view_b__', content: { headline: 'ok' } })
  })

  it('clears the in-flight guard once the request settles, allowing a later retry for the same view', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ content: { headline: 'first' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    await generateArtifact('thesis', dispatch, baseOpts())
    expect(isGenerationInFlight('thesis')).toBe(false)

    // A second, independent call after the first settled must actually fire.
    await generateArtifact('thesis', dispatch, baseOpts())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('forwards prior generated artifacts restricted to the given seq', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ content: {} }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    await generateArtifact('businessModel', dispatch, baseOpts({
      generated: { design: { x: 1 }, thesis: { y: 2 }, notInSeq: { z: 3 } },
      seq: ['design', 'thesis', 'businessModel'],
    }))

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.prior).toEqual({ design: { x: 1 }, thesis: { y: 2 } })
  })

  it('forwards feedback when provided (regenerate path)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    await generateArtifact('thesis', dispatch, baseOpts({ feedback: 'make it punchier' }))

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.feedback).toBe('make it punchier')
  })
})
