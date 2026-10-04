import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * PRD feature priority → nightly task seeding (#901, epic #900).
 *
 * Part of epic #900. `lib/build/artifact-prompts.ts`'s PRD artifact already
 * generates real `features: [{name, desc, priority: "P0"|"P1"|"P2"}]` — but
 * the nightly loop's task seed used a generic "ship the highest-leverage
 * thing" description instead of the PRD's own prioritized features. This
 * covers the READ-path addition: parsing a PRD document's content, picking
 * its highest-priority unshipped feature, and composing a task description
 * from it — with honest, graceful fallback when no PRD exists or the lookup
 * fails.
 *
 * SCOPE NOTE (not a gap in this suite): nothing in this codebase writes a
 * `type: 'prd'` document yet (tracked separately as #532) — so
 * `buildNightlySeedDescription()`'s "PRD exists" branch is exercised here by
 * mocking `listDocuments` directly, which is how it WILL behave the moment a
 * real writer lands, without requiring any change to this read path.
 */

const h = vi.hoisted(() => ({ listDocuments: vi.fn() }))
vi.mock('@/lib/build/document-store', () => ({ listDocuments: h.listDocuments }))

import {
  parsePrdFeatures,
  pickHighestPriorityFeature,
  buildPrdFeatureDescription,
  buildNightlySeedDescription,
  buildTaskDescription,
  type NightlyRunInput,
  type PrdFeature,
} from '@/lib/build/autonomous-loop'

const APP_INPUT: NightlyRunInput = {
  companyId: 'beacon', companyName: 'Beacon', track: 'app',
}
const COMPANY_INPUT: NightlyRunInput = {
  companyId: 'acme-co', companyName: 'Acme Co', track: 'company',
}

function prdContent(features: Array<Partial<PrdFeature>>): string {
  return JSON.stringify({
    overview: 'An overview.',
    features,
    acceptance: ['a', 'b', 'c'],
  })
}

beforeEach(() => {
  h.listDocuments.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ---------- parsePrdFeatures (pure) ----------
describe('parsePrdFeatures (#901)', () => {
  it('parses a well-formed PRD content string into its features array', () => {
    const content = prdContent([
      { name: 'Real-time sync', desc: 'Sync across devices', priority: 'P0' },
      { name: 'Dark mode', desc: 'Theme toggle', priority: 'P2' },
    ])
    expect(parsePrdFeatures(content)).toEqual([
      { name: 'Real-time sync', desc: 'Sync across devices', priority: 'P0' },
      { name: 'Dark mode', desc: 'Theme toggle', priority: 'P2' },
    ])
  })
  it('uppercases loosely-cased priorities', () => {
    const content = prdContent([{ name: 'X', priority: 'p1' }])
    expect(parsePrdFeatures(content)?.[0]?.priority).toBe('P1')
  })
  it('returns [] for null/undefined/empty content', () => {
    expect(parsePrdFeatures(null)).toEqual([])
    expect(parsePrdFeatures(undefined)).toEqual([])
    expect(parsePrdFeatures('')).toEqual([])
  })
  it('returns [] for malformed JSON — never throws', () => {
    expect(parsePrdFeatures('{not json')).toEqual([])
  })
  it('returns [] when content is valid JSON but has no features array', () => {
    expect(parsePrdFeatures(JSON.stringify({ overview: 'x' }))).toEqual([])
    expect(parsePrdFeatures(JSON.stringify({ features: 'not-an-array' }))).toEqual([])
  })
  it('drops feature entries with no usable name', () => {
    const content = prdContent([{ name: '', priority: 'P0' }, { name: '  ', priority: 'P1' }])
    expect(parsePrdFeatures(content)).toEqual([])
  })
})

// ---------- pickHighestPriorityFeature (pure) ----------
describe('pickHighestPriorityFeature (#901)', () => {
  it('picks the P0 feature when one exists among mixed priorities', () => {
    const features: PrdFeature[] = [
      { name: 'Low', priority: 'P2' },
      { name: 'High', priority: 'P0' },
      { name: 'Mid', priority: 'P1' },
    ]
    expect(pickHighestPriorityFeature(features)?.name).toBe('High')
  })
  it('falls back to P1 when no P0 exists', () => {
    const features: PrdFeature[] = [{ name: 'Mid', priority: 'P1' }, { name: 'Low', priority: 'P2' }]
    expect(pickHighestPriorityFeature(features)?.name).toBe('Mid')
  })
  it('falls back to P2 when only P2 exists', () => {
    const features: PrdFeature[] = [{ name: 'Low', priority: 'P2' }]
    expect(pickHighestPriorityFeature(features)?.name).toBe('Low')
  })
  it('keeps first-authored order as the tiebreaker within the same priority', () => {
    const features: PrdFeature[] = [{ name: 'First P0', priority: 'P0' }, { name: 'Second P0', priority: 'P0' }]
    expect(pickHighestPriorityFeature(features)?.name).toBe('First P0')
  })
  it('treats missing/unknown priority as lowest — never preferred over a known priority', () => {
    const features: PrdFeature[] = [{ name: 'Unknown', priority: undefined }, { name: 'Known P2', priority: 'P2' }]
    expect(pickHighestPriorityFeature(features)?.name).toBe('Known P2')
  })
  it('returns null for an empty array', () => {
    expect(pickHighestPriorityFeature([])).toBeNull()
  })
})

// ---------- buildPrdFeatureDescription (pure) ----------
describe('buildPrdFeatureDescription (#901)', () => {
  it('names the real P0 feature for an app-track company', () => {
    const content = prdContent([
      { name: 'Billing export', desc: 'CSV export of invoices', priority: 'P0' },
      { name: 'Dark mode', priority: 'P2' },
    ])
    const desc = buildPrdFeatureDescription(APP_INPUT, content, null)
    expect(desc).toContain('Beacon')
    expect(desc).toContain('P0')
    expect(desc).toContain('Billing export')
    expect(desc).toContain('CSV export of invoices')
  })
  it('names the real P0 feature for a company-track enrollment too', () => {
    const content = prdContent([{ name: 'Outreach automation', priority: 'P0' }])
    const desc = buildPrdFeatureDescription(COMPANY_INPUT, content, null)
    expect(desc).toContain('Acme Co')
    expect(desc).toContain('Outreach automation')
  })
  it('appends the data-informed briefing when present', () => {
    const content = prdContent([{ name: 'X', priority: 'P0' }])
    const desc = buildPrdFeatureDescription(APP_INPUT, content, 'Focus on retention')
    expect(desc).toContain('Data-informed briefing:')
    expect(desc).toContain('Focus on retention')
  })
  it('returns null when the content has no usable features — caller falls back', () => {
    expect(buildPrdFeatureDescription(APP_INPUT, prdContent([]), null)).toBeNull()
    expect(buildPrdFeatureDescription(APP_INPUT, null, null)).toBeNull()
    expect(buildPrdFeatureDescription(APP_INPUT, '{not json', null)).toBeNull()
  })
})

// ---------- buildNightlySeedDescription (I/O orchestration) ----------
describe('buildNightlySeedDescription (#901)', () => {
  it('uses the PRD-derived description when a company has a prd document with usable features', async () => {
    h.listDocuments.mockResolvedValue([
      {
        id: 'd1', scopeKey: 'founder@x.co::beacon', kind: 'document', type: 'prd',
        title: 'PRD', createdAt: '2026-10-01T00:00:00Z',
        content: prdContent([{ name: 'Real-time sync', desc: 'Sync everywhere', priority: 'P0' }]),
      },
    ])
    const desc = await buildNightlySeedDescription('founder@x.co::beacon', APP_INPUT, null)
    expect(desc).toContain('Real-time sync')
    expect(desc).toContain('P0')
  })

  it('falls back to buildTaskDescription() when no PRD artifact exists — NO REGRESSION', async () => {
    h.listDocuments.mockResolvedValue([
      { id: 'd1', scopeKey: 's', kind: 'document', type: 'research', title: 'R', createdAt: '2026-10-01T00:00:00Z', content: '{}' },
    ])
    const desc = await buildNightlySeedDescription('founder@x.co::beacon', APP_INPUT, null)
    expect(desc).toBe(buildTaskDescription(APP_INPUT, null))
  })

  it('falls back to buildTaskDescription() when the company has zero documents at all', async () => {
    h.listDocuments.mockResolvedValue([])
    const desc = await buildNightlySeedDescription('founder@x.co::beacon', APP_INPUT, null)
    expect(desc).toBe(buildTaskDescription(APP_INPUT, null))
  })

  it('falls back gracefully when the PRD document lookup throws — never breaks the nightly loop', async () => {
    h.listDocuments.mockRejectedValue(new Error('zerodb down'))
    const desc = await buildNightlySeedDescription('founder@x.co::beacon', APP_INPUT, null)
    expect(desc).toBe(buildTaskDescription(APP_INPUT, null))
  })

  it('falls back to generic description when a prd document exists but has unparseable content', async () => {
    h.listDocuments.mockResolvedValue([
      { id: 'd1', scopeKey: 's', kind: 'document', type: 'prd', title: 'PRD', createdAt: '2026-10-01T00:00:00Z', content: 'not json' },
    ])
    const desc = await buildNightlySeedDescription('founder@x.co::beacon', APP_INPUT, null)
    expect(desc).toBe(buildTaskDescription(APP_INPUT, null))
  })

  it('picks the newest prd document when multiple exist (listDocuments is newest-first)', async () => {
    h.listDocuments.mockResolvedValue([
      {
        id: 'newer', scopeKey: 's', kind: 'document', type: 'prd', title: 'PRD v2', createdAt: '2026-10-02T00:00:00Z',
        content: prdContent([{ name: 'Newer feature', priority: 'P0' }]),
      },
      {
        id: 'older', scopeKey: 's', kind: 'document', type: 'prd', title: 'PRD v1', createdAt: '2026-10-01T00:00:00Z',
        content: prdContent([{ name: 'Older feature', priority: 'P0' }]),
      },
    ])
    const desc = await buildNightlySeedDescription('founder@x.co::beacon', APP_INPUT, null)
    expect(desc).toContain('Newer feature')
    expect(desc).not.toContain('Older feature')
  })

  it('passes through the briefing to the fallback path too', async () => {
    h.listDocuments.mockResolvedValue([])
    const desc = await buildNightlySeedDescription('s', APP_INPUT, 'Ship faster')
    expect(desc).toBe(buildTaskDescription(APP_INPUT, 'Ship faster'))
  })
})
