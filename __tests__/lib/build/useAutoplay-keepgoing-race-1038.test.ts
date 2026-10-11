import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * #1038 — race coverage: a founder pauses ("Take the wheel"), manually clicks
 * `Next ›` to an undone view (firing a real on-demand generateArtifact call
 * for it via ArtifactFrame), then immediately clicks "Keep going →" before
 * that request resolves. KEEP_GOING just sets auto:true — it does not itself
 * fetch anything; the NEXT tick of useAutoplay's effect is what would try to
 * drive that same view again once auto flips back to true.
 *
 * This confirms generateArtifact's module-level in-flight guard (the same
 * mechanism __tests__/lib/build/generateArtifact-1038.test.ts covers
 * directly) also protects this exact cross-caller sequence: the manual
 * trigger starts a request for a view, then a SECOND call for that same view
 * — standing in for what useAutoplay's own effect would attempt once it
 * resumes driving — must be a no-op, not a second /api/build/artifact fetch.
 */

import { generateArtifact } from '@/lib/build/useAutoplay'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function opts(overrides: Partial<Parameters<typeof generateArtifact>[2]> = {}) {
  return {
    idea: 'a coffee-roaster DTC subscription billing platform',
    track: 'company' as const,
    companyName: 'Roastflow',
    companyId: 'roastflow-co',
    generated: { design: {}, thesis: {}, wedge: {} },
    seq: ['design', 'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30'],
    ...overrides,
  }
}

describe('generateArtifact — manual trigger vs. autoplay resume race (#1038)', () => {
  it('a manual on-demand call in flight for a view is NOT duplicated by a second call for the same view (simulating autoplay resuming via Keep going)', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((res) => { resolveFetch = res }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    // 1. Founder manually navigates to 'businessModel' (Next ›) while paused —
    //    ArtifactFrame's triggerOnDemandGeneration fires this.
    const manualCall = generateArtifact('businessModel', dispatch, opts())
    await new Promise((r) => setTimeout(r, 0)) // let fetch() actually start

    // 2. Founder immediately clicks "Keep going →" (KEEP_GOING -> auto:true).
    //    On the next tick, useAutoplay's effect would see 'businessModel' as
    //    the next undone view and attempt to drive it too — represented here
    //    by a second generateArtifact call for the SAME view, BEFORE the
    //    first request has resolved.
    const resumeCall = generateArtifact('businessModel', dispatch, opts())

    // Only ONE real network request must have gone out.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Resolve the in-flight request now.
    resolveFetch({ ok: true, json: async () => ({ content: { headline: 'Harborline' } }) })
    await manualCall
    await resumeCall

    // Still only one fetch, and exactly one GEN_DONE dispatch for the view —
    // no double-fetch, no duplicate dispatch.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const genDoneCalls = dispatch.mock.calls.filter((c) => c[0].type === 'GEN_DONE' && c[0].view === 'businessModel')
    expect(genDoneCalls).toHaveLength(1)
  })

  it('once the first request settles, a later independent request for the same view is allowed (not permanently locked out)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ content: { headline: 'first pass' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const dispatch = vi.fn()

    await generateArtifact('plan30', dispatch, opts())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A later, genuinely separate call (e.g. a regenerate) must go through.
    await generateArtifact('plan30', dispatch, opts())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
