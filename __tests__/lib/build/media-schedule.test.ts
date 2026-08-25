import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MEDIA_KINDS,
  MEDIA_FREQUENCIES,
  FREQUENCY_LABELS,
  MEDIA_ROW_KINDS,
  mediaScopeKey,
  normalizeMediaKind,
  normalizeFrequency,
  isMediaFrequency,
  nextRunAt,
  isRoutineDue,
  buildBrandPrompt,
  buildGenerationRequest,
  mediaGenerationConfigured,
  coerceRoutine,
  coerceAsset,
  sortByCreatedDesc,
  saveRoutine,
  saveAsset,
  listMedia,
  runMediaGeneration,
  type MediaRoutine,
  type MediaAsset,
} from '@/lib/build/media-schedule'

/**
 * #54 — Auto-media schedule + generation store. Covers the pure core (scope key,
 * normalization, next-run/due computation, brand prompt, request shaping, config
 * gate, coercion, sort) and the ZeroDB / core-Multimodal I/O (save/list/run) by
 * mocking global.fetch. The vitest env is 'node'; fetch is stubbed per-test so no
 * network is touched — same strategy as the document-store / task-store tests.
 */

const OK = (json: unknown) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) })
const ERR = (status = 500) => ({ ok: false, status, json: async () => ({}), text: async () => '' })

describe('media-schedule vocabulary', () => {
  it('exposes the media kinds, frequencies, labels and row kinds', () => {
    expect(MEDIA_KINDS).toEqual(['image', 'video'])
    expect(MEDIA_FREQUENCIES).toEqual(['once', 'daily', 'weekly', 'monthly'])
    expect(FREQUENCY_LABELS.once).toBe('Once')
    expect(FREQUENCY_LABELS.monthly).toBe('Monthly')
    expect(MEDIA_ROW_KINDS).toEqual(['routine', 'asset'])
  })
})

describe('mediaScopeKey', () => {
  it('scopes by owner and company slug', () => {
    const k = mediaScopeKey({ user: { email: 'a@b.co' } } as any, 'acme')
    expect(k).toContain('acme')
    expect(typeof k).toBe('string')
    expect(k.length).toBeGreaterThan(0)
  })
})

describe('normalizeMediaKind / normalizeFrequency / isMediaFrequency', () => {
  it('normalizes valid + invalid media kinds', () => {
    expect(normalizeMediaKind('video')).toBe('video')
    expect(normalizeMediaKind('IMAGE')).toBe('image')
    expect(normalizeMediaKind('bogus')).toBe('image')
    expect(normalizeMediaKind(undefined)).toBe('image')
  })
  it('normalizes valid + invalid frequencies (default weekly)', () => {
    expect(normalizeFrequency('daily')).toBe('daily')
    expect(normalizeFrequency('ONCE')).toBe('once')
    expect(normalizeFrequency('nope')).toBe('weekly')
    expect(normalizeFrequency(null)).toBe('weekly')
  })
  it('guards frequency strings', () => {
    expect(isMediaFrequency('monthly')).toBe(true)
    expect(isMediaFrequency('yearly')).toBe(false)
    expect(isMediaFrequency(5)).toBe(false)
  })
})

describe('nextRunAt', () => {
  const from = new Date('2026-08-25T00:00:00Z')
  it('once: due now when never run, null after a run', () => {
    expect(nextRunAt('once', null, from)).toBe(from.toISOString())
    expect(nextRunAt('once', '2026-08-20T00:00:00Z', from)).toBeNull()
  })
  it('recurring: due now when never run', () => {
    expect(nextRunAt('daily', null, from)).toBe(from.toISOString())
    expect(nextRunAt('weekly', undefined, from)).toBe(from.toISOString())
  })
  it('daily adds a day', () => {
    expect(nextRunAt('daily', '2026-08-24T00:00:00Z')).toBe('2026-08-25T00:00:00.000Z')
  })
  it('weekly adds a week', () => {
    expect(nextRunAt('weekly', '2026-08-01T00:00:00Z')).toBe('2026-08-08T00:00:00.000Z')
  })
  it('monthly adds a month', () => {
    expect(nextRunAt('monthly', '2026-01-15T00:00:00Z')).toBe('2026-02-15T00:00:00.000Z')
  })
  it('treats a malformed lastRunAt as never-run', () => {
    expect(nextRunAt('daily', 'not-a-date', from)).toBe(from.toISOString())
  })
})

describe('isRoutineDue', () => {
  const now = new Date('2026-08-25T00:00:00Z')
  it('never due when disabled', () => {
    expect(isRoutineDue({ enabled: false, frequency: 'daily', lastRunAt: undefined }, now)).toBe(false)
  })
  it('due when never run', () => {
    expect(isRoutineDue({ enabled: true, frequency: 'daily', lastRunAt: undefined }, now)).toBe(true)
  })
  it('due when a day has elapsed', () => {
    expect(isRoutineDue({ enabled: true, frequency: 'daily', lastRunAt: '2026-08-23T00:00:00Z' }, now)).toBe(true)
  })
  it('not due before the interval elapses', () => {
    expect(isRoutineDue({ enabled: true, frequency: 'weekly', lastRunAt: '2026-08-24T00:00:00Z' }, now)).toBe(false)
  })
  it("once: not due again after it has run", () => {
    expect(isRoutineDue({ enabled: true, frequency: 'once', lastRunAt: '2026-08-20T00:00:00Z' }, now)).toBe(false)
  })
})

describe('buildBrandPrompt', () => {
  it('feeds brand name/tagline/idea/color into an image prompt', () => {
    const p = buildBrandPrompt('image', { companyName: 'Acme', tagline: 'We ship', idea: 'inventory bot', color: '#ff0000' })
    expect(p).toContain('Acme')
    expect(p).toContain('We ship')
    expect(p).toContain('inventory bot')
    expect(p).toContain('#ff0000')
    expect(p).toContain('marketing image')
  })
  it('uses a video noun for video', () => {
    expect(buildBrandPrompt('video', { companyName: 'Acme' })).toContain('promotional video')
  })
  it('degrades gracefully with no brand fields', () => {
    const p = buildBrandPrompt('image', {})
    expect(p).toContain('the company')
    expect(p).not.toContain('undefined')
  })
})

describe('buildGenerationRequest', () => {
  it('routes image to the image endpoint', () => {
    expect(buildGenerationRequest('image', 'p')).toEqual({ path: '/api/v1/multimodal/image', body: { prompt: 'p', kind: 'image' } })
  })
  it('routes video to the video endpoint', () => {
    expect(buildGenerationRequest('video', 'p').path).toBe('/api/v1/multimodal/video')
  })
})

describe('mediaGenerationConfigured', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })
  it('false when flag off', () => {
    process.env.BUILD_MEDIA_ENABLED = ''
    process.env.AINATIVE_API_KEY = 'k'
    expect(mediaGenerationConfigured()).toBe(false)
  })
  it('false when flag on but no key', () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    process.env.AINATIVE_API_KEY = ''
    process.env.API_Key = ''
    process.env.ZERODB_API_KEY = ''
    expect(mediaGenerationConfigured()).toBe(false)
  })
  it('true when flag on and key present', () => {
    process.env.BUILD_MEDIA_ENABLED = '1'
    process.env.AINATIVE_API_KEY = 'k'
    expect(mediaGenerationConfigured()).toBe(true)
  })
})

describe('coerceRoutine / coerceAsset', () => {
  it('coerces a valid routine row (row_data wrapped)', () => {
    const r = coerceRoutine({ row_data: { id: 'x', rowKind: 'routine', mediaKind: 'video', frequency: 'daily', enabled: true, createdAt: 't' } })
    expect(r?.mediaKind).toBe('video')
    expect(r?.enabled).toBe(true)
  })
  it('rejects non-routine / missing id', () => {
    expect(coerceRoutine({ rowKind: 'asset' })).toBeNull()
    expect(coerceRoutine({ rowKind: 'routine' })).toBeNull()
    expect(coerceRoutine(null)).toBeNull()
  })
  it('coerces a valid asset row and rejects one with no url', () => {
    const a = coerceAsset({ id: 'a', rowKind: 'asset', mediaKind: 'image', url: 'http://x/y.png', prompt: 'p', createdAt: 't' })
    expect(a?.url).toBe('http://x/y.png')
    expect(coerceAsset({ id: 'a', rowKind: 'asset', url: '' })).toBeNull()
    expect(coerceAsset({ rowKind: 'routine' })).toBeNull()
  })
})

describe('sortByCreatedDesc', () => {
  it('sorts newest-first', () => {
    const rows = [{ createdAt: '2026-01-01T00:00:00Z' }, { createdAt: '2026-03-01T00:00:00Z' }, { createdAt: '2026-02-01T00:00:00Z' }]
    expect(sortByCreatedDesc(rows).map((r) => r.createdAt)).toEqual(['2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z'])
  })
})

describe('I/O: saveRoutine / saveAsset / listMedia / runMediaGeneration', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.ZERODB_API_KEY = 'k'
    process.env.AINATIVE_API_KEY = 'k'
    vi.restoreAllMocks()
  })
  afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks() })

  it('saveRoutine returns the routine on a successful write', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ ok: true }) as any))
    const r = await saveRoutine('a::b', { mediaKind: 'video', frequency: 'daily' })
    expect(r?.mediaKind).toBe('video')
    expect(r?.enabled).toBe(true)
  })
  it('saveRoutine returns null on a write failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ERR(500) as any))
    expect(await saveRoutine('a::b', { mediaKind: 'image', frequency: 'once' })).toBeNull()
  })
  it('saveRoutine returns null with no scope', async () => {
    expect(await saveRoutine('', { mediaKind: 'image', frequency: 'once' })).toBeNull()
  })
  it('saveAsset persists and returns the asset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ ok: true }) as any))
    const a = await saveAsset('a::b', { mediaKind: 'image', url: 'http://x/p.png', prompt: 'p' })
    expect(a?.url).toBe('http://x/p.png')
  })
  it('saveAsset returns null without a url', async () => {
    expect(await saveAsset('a::b', { mediaKind: 'image', url: '', prompt: 'p' })).toBeNull()
  })

  it('listMedia returns latest routine per kind + assets', async () => {
    const rows = [
      { row_data: { id: 'r1', rowKind: 'routine', mediaKind: 'image', frequency: 'weekly', enabled: true, createdAt: '2026-08-01T00:00:00Z' } },
      { row_data: { id: 'r2', rowKind: 'routine', mediaKind: 'image', frequency: 'daily', enabled: true, createdAt: '2026-08-10T00:00:00Z' } },
      { row_data: { id: 'a1', rowKind: 'asset', mediaKind: 'image', url: 'http://x/1.png', prompt: 'p', createdAt: '2026-08-11T00:00:00Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => OK({ data: rows }) as any))
    const { routines, assets } = await listMedia('a::b')
    expect(routines).toHaveLength(1) // latest per kind
    expect(routines[0].frequency).toBe('daily')
    expect(assets).toHaveLength(1)
  })
  it('listMedia returns empty with no scope', async () => {
    expect(await listMedia('')).toEqual({ routines: [], assets: [] })
  })

  it('runMediaGeneration is inert (disabled) when unconfigured', async () => {
    process.env.BUILD_MEDIA_ENABLED = ''
    const spy = vi.stubGlobal('fetch', vi.fn())
    const res = await runMediaGeneration('a::b', 'image', { companyName: 'Acme' })
    expect(res.status).toBe('disabled')
    expect(spy).toBeDefined()
  })
  it('runMediaGeneration generates + persists an owned asset when configured', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ url: 'http://x/gen.png', provider: 'multimodal' }) as any) // generate
      .mockResolvedValueOnce(OK({ ok: true }) as any) // saveAsset
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaGeneration('a::b', 'image', { companyName: 'Acme', tagline: 't', color: '#123' })
    expect(res.status).toBe('generated')
    expect(res.asset?.url).toBe('http://x/gen.png')
    // The generation request must hit the multimodal image endpoint with an on-brand prompt.
    const firstCall = fetchMock.mock.calls[0]
    expect(String(firstCall[0])).toContain('/api/v1/multimodal/image')
    expect(String(firstCall[1].body)).toContain('Acme')
  })
  it('runMediaGeneration reports failed when the core call errors', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => ERR(502) as any))
    expect((await runMediaGeneration('a::b', 'video', {})).status).toBe('failed')
  })
  it('runMediaGeneration reports failed when the core returns no url', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => OK({ nothing: true }) as any))
    expect((await runMediaGeneration('a::b', 'image', {})).status).toBe('failed')
  })
  it('runMediaGeneration never throws on a network exception', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    expect((await runMediaGeneration('a::b', 'image', {})).status).toBe('failed')
  })
})
