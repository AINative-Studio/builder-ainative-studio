import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractIdeaFromPrompt } from '@/lib/build/idea-backfill'

/**
 * #1102/#1113 — idea backfill. Real root cause of habanero-hub never
 * getting a landing page: its registry row has no `idea` field at all
 * (created around the time #660's idea-persistence fix shipped), so
 * Live.tsx's company-app/company-product generation triggers — both gated
 * on `state.idea && state.appSub` — silently never fired, for EITHER
 * generation, regardless of track. extractIdeaFromPrompt() recovers the
 * real idea text from the generations table's stored prompt (which always
 * wraps it in one of three known template phrasings) so a backfill sweep
 * can repair it.
 */
describe('extractIdeaFromPrompt', () => {
  it('extracts the real idea from the company-product wrapper (the real habanero-hub prompt shape)', () => {
    const prompt =
      'Build a real, working, functional application for "Habanero Hub" that actually implements this idea: A subscription box for local, small-batch hot sauce makers — curate, ship monthly, let subscribers rate and reorder favorites.. This is the founder\'s REAL, WORKING TOOL — not a marketing page — build the core feature(s) a user would use every day: real data, real interactions, real functionality that does what the idea describes. Compose whichever AINative primitives genuinely fit this specific idea (persistence, memory, pipeline, commerce, voice, etc.) and call their real APIs, not a hand-rolled substitute. Make it visually distinctive and specific to this company, with realistic data — not a generic template.'
    const idea = extractIdeaFromPrompt(prompt)
    expect(idea).not.toBeNull()
    expect(idea).toContain('subscription box')
    expect(idea).toContain('hot sauce')
    expect(idea?.toLowerCase()).not.toContain('real, working, functional')
    expect(idea?.toLowerCase()).not.toContain("founder's real, working tool")
  })

  it('extracts the real idea from the company-app (landing-page) wrapper, with a tagline', () => {
    const prompt =
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Atlas Coffee" (tagline: "Roasted fresh, shipped fast") — a real company for this idea: a direct-to-consumer specialty coffee subscription. Include: a hero with the value prop and a "Get early access" CTA, a 3-feature section, a how-it-works section, pricing (3 tiers), and a footer. Use #2f6d86 as the main accent color. Make it visually distinctive and specific to this company, with realistic copy — not a generic template.'
    const idea = extractIdeaFromPrompt(prompt)
    expect(idea).toBe('a direct-to-consumer specialty coffee subscription')
  })

  it('extracts the real idea from the company-app wrapper, with NO tagline', () => {
    const prompt =
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Wrench" — a real company for this idea: a field service dispatch tool for contractors. Include: a hero with the value prop and a "Get early access" CTA, a 3-feature section, a how-it-works section, pricing (3 tiers), and a footer. Use #ec3013 as the main accent color. Make it visually distinctive and specific to this company, with realistic copy — not a generic template.'
    const idea = extractIdeaFromPrompt(prompt)
    expect(idea).toBe('a field service dispatch tool for contractors')
  })

  it('extracts the real idea from the App-track quick-preview wrapper (useRealPreview.ts)', () => {
    const prompt =
      'Build a polished, working web app for this idea: a freelance consulting invoicing tool that lets me create invoices, send them to clients, and track which ones have been paid. Make it interactive and visually complete with realistic sample data.'
    const idea = extractIdeaFromPrompt(prompt)
    expect(idea).toBe('a freelance consulting invoicing tool that lets me create invoices, send them to clients, and track which ones have been paid')
  })

  it('returns null for a prompt that matches none of the known wrapper shapes (never backfills garbage)', () => {
    const idea = extractIdeaFromPrompt('some completely unrelated free-text prompt with no known wrapper at all')
    expect(idea).toBeNull()
  })

  it('returns null for empty/whitespace input', () => {
    expect(extractIdeaFromPrompt('')).toBeNull()
    expect(extractIdeaFromPrompt('   ')).toBeNull()
  })
})

const listAllAppsWithStatusMock = vi.fn()
const setAppIdeaMock = vi.fn()
const loadGenerationMock = vi.fn()

vi.mock('@/lib/build/app-registry', () => ({
  listAllAppsWithStatus: (...args: unknown[]) => listAllAppsWithStatusMock(...args),
  setAppIdea: (...args: unknown[]) => setAppIdeaMock(...args),
}))
vi.mock('@/lib/zerodb-store', () => ({
  loadGeneration: (...args: unknown[]) => loadGenerationMock(...args),
}))

import { runIdeaBackfillSweep } from '@/lib/build/idea-backfill'

describe('runIdeaBackfillSweep', () => {
  beforeEach(() => {
    listAllAppsWithStatusMock.mockReset()
    setAppIdeaMock.mockReset()
    loadGenerationMock.mockReset()
  })

  it('skips rows that already have an idea (never touches/queries their generation)', async () => {
    listAllAppsWithStatusMock.mockResolvedValueOnce({
      ok: true,
      apps: [{ slug: 'groundwork', chatId: 'c1', idea: 'already set' }],
    })
    const r = await runIdeaBackfillSweep({ dryRun: true })
    expect(r.candidates).toBe(0)
    expect(loadGenerationMock).not.toHaveBeenCalled()
  })

  it('dry run: reports what WOULD be backfilled without calling setAppIdea', async () => {
    listAllAppsWithStatusMock.mockResolvedValueOnce({
      ok: true,
      apps: [{ slug: 'habanero-hub', chatId: 'goeRs5G6t8zcfk1HENKLE' }],
    })
    loadGenerationMock.mockResolvedValueOnce({
      prompt: 'Build a real, working, functional application for "Habanero Hub" that actually implements this idea: A subscription box for hot sauce makers. This is the founder\'s REAL, WORKING TOOL — not a marketing page.',
    })
    const r = await runIdeaBackfillSweep({ dryRun: true })
    expect(r.backfilled).toBe(1)
    expect(r.results[0].disposition).toBe('backfilled')
    expect(r.results[0].idea).toContain('subscription box')
    expect(setAppIdeaMock).not.toHaveBeenCalled()
  })

  it('apply run: actually calls setAppIdea with the extracted idea', async () => {
    listAllAppsWithStatusMock.mockResolvedValueOnce({
      ok: true,
      apps: [{ slug: 'habanero-hub', chatId: 'goeRs5G6t8zcfk1HENKLE' }],
    })
    loadGenerationMock.mockResolvedValueOnce({
      prompt: 'Build a real, working, functional application for "Habanero Hub" that actually implements this idea: A subscription box for hot sauce makers. This is the founder\'s REAL, WORKING TOOL — not a marketing page.',
    })
    setAppIdeaMock.mockResolvedValueOnce(true)
    const r = await runIdeaBackfillSweep({ dryRun: false })
    expect(setAppIdeaMock).toHaveBeenCalledWith('habanero-hub', expect.stringContaining('subscription box'))
    expect(r.backfilled).toBe(1)
  })

  it('reports no_generation_found when loadGeneration returns null (never crashes the sweep)', async () => {
    listAllAppsWithStatusMock.mockResolvedValueOnce({
      ok: true,
      apps: [{ slug: 'ghost-co', chatId: 'missing' }],
    })
    loadGenerationMock.mockResolvedValueOnce(null)
    const r = await runIdeaBackfillSweep({ dryRun: true })
    expect(r.results[0].disposition).toBe('no_generation_found')
    expect(r.backfilled).toBe(0)
  })

  it('reports unrecognized_prompt_shape rather than backfilling garbage', async () => {
    listAllAppsWithStatusMock.mockResolvedValueOnce({
      ok: true,
      apps: [{ slug: 'odd-co', chatId: 'c2' }],
    })
    loadGenerationMock.mockResolvedValueOnce({ prompt: 'totally unstructured text' })
    const r = await runIdeaBackfillSweep({ dryRun: true })
    expect(r.results[0].disposition).toBe('unrecognized_prompt_shape')
    expect(r.backfilled).toBe(0)
  })

  it('a per-company failure is reported and does not abort the rest of the sweep', async () => {
    listAllAppsWithStatusMock.mockResolvedValueOnce({
      ok: true,
      apps: [
        { slug: 'broken-co', chatId: 'c3' },
        { slug: 'habanero-hub', chatId: 'goeRs5G6t8zcfk1HENKLE' },
      ],
    })
    loadGenerationMock
      .mockRejectedValueOnce(new Error('ZeroDB timeout'))
      .mockResolvedValueOnce({
        prompt: 'Build a real, working, functional application for "Habanero Hub" that actually implements this idea: hot sauce subscriptions. This is the founder\'s REAL, WORKING TOOL.',
      })
    const r = await runIdeaBackfillSweep({ dryRun: true })
    expect(r.results).toHaveLength(2)
    expect(r.results[0].disposition).toBe('write_failed')
    expect(r.results[1].disposition).toBe('backfilled')
  })

  it('fails closed when the registry read itself fails', async () => {
    listAllAppsWithStatusMock.mockResolvedValueOnce({ ok: false, apps: [] })
    const r = await runIdeaBackfillSweep({ dryRun: true })
    expect(r.registryOk).toBe(false)
    expect(r.backfilled).toBe(0)
  })
})
