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
  pollVideoStatus,
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
  // #403: the bare '/api/v1/multimodal/video' this used to send never existed
  // on core (confirmed via direct read of core's real FastAPI router — only
  // /video/i2v, /video/t2v, /video/cogvideox are registered) — every video
  // generation call has 404'd since #54 shipped. Builder only ever sends a
  // text prompt (no source image), so /video/t2v (text-to-video) is the
  // correct real route, not /video/i2v (needs a source image).
  it('routes video to the real text-to-video endpoint, not the bare path that never existed on core', () => {
    expect(buildGenerationRequest('video', 'p')).toEqual({ path: '/api/v1/multimodal/video/t2v', body: { prompt: 'p' } })
  })
  it("video request body matches core's real VideoT2VRequest schema shape ({prompt}) — no unused 'kind' field", () => {
    const { body } = buildGenerationRequest('video', 'a wave at sunset')
    expect(body).not.toHaveProperty('kind')
    expect(body.prompt).toBe('a wave at sunset')
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

  describe('ensureTable (build_media table-missing production fix)', () => {
    // Live-confirmed in production: the `build_media` table was never created,
    // so every real "START AUTO" schedule save 404'd and got silently
    // swallowed into a generic "Could not save the schedule" error, for BOTH
    // Auto Image and Auto Video. saveRoutine/saveAsset now ensure the table
    // exists (idempotent, best-effort) before every write.
    it('saveRoutine calls ensureTable (POST .../database/tables) BEFORE the real row write', async () => {
      const fetchMock = vi.fn().mockResolvedValue(OK({ ok: true }) as any)
      vi.stubGlobal('fetch', fetchMock)
      await saveRoutine('a::b', { mediaKind: 'image', frequency: 'weekly' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [ensureUrl, ensureInit] = fetchMock.mock.calls[0]
      expect(String(ensureUrl)).toMatch(/\/database\/tables$/)
      expect(JSON.parse(String(ensureInit.body))).toEqual({ table_name: 'build_media' })
      const [writeUrl] = fetchMock.mock.calls[1]
      expect(String(writeUrl)).toMatch(/\/database\/tables\/build_media\/rows$/)
    })

    it('saveAsset also calls ensureTable before its real row write', async () => {
      const fetchMock = vi.fn().mockResolvedValue(OK({ ok: true }) as any)
      vi.stubGlobal('fetch', fetchMock)
      await saveAsset('a::b', { mediaKind: 'video', url: 'http://x/v.mp4', prompt: 'p' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/database\/tables$/)
    })

    it('works for BOTH Auto Image and Auto Video (the reported failure covered both)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(OK({ ok: true }) as any)
      vi.stubGlobal('fetch', fetchMock)
      const image = await saveRoutine('a::b', { mediaKind: 'image', frequency: 'daily' })
      const video = await saveRoutine('a::b', { mediaKind: 'video', frequency: 'daily' })
      expect(image?.mediaKind).toBe('image')
      expect(video?.mediaKind).toBe('video')
    })

    it('a failed ensureTable never blocks the real write — its own result stays authoritative', async () => {
      // ensureTable is fire-and-forget (never throws, result ignored) — the
      // REAL write's own ok/fail result is what saveRoutine returns.
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(ERR(500) as any) // ensureTable fails
        .mockResolvedValueOnce(OK({ ok: true }) as any) // real write still succeeds
      vi.stubGlobal('fetch', fetchMock)
      const r = await saveRoutine('a::b', { mediaKind: 'image', frequency: 'weekly' })
      expect(r?.mediaKind).toBe('image')
    })

    it('never throws when ensureTable itself throws (e.g. network error)', async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('network down')) // ensureTable throws
        .mockResolvedValueOnce(OK({ ok: true }) as any) // real write still attempted + succeeds
      vi.stubGlobal('fetch', fetchMock)
      const r = await saveRoutine('a::b', { mediaKind: 'video', frequency: 'monthly' })
      expect(r?.mediaKind).toBe('video')
    })
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
  it('runMediaGeneration generates + persists an owned VIDEO asset when configured (real video shape: a url field)', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ url: 'http://x/gen.mp4', provider: 'multimodal' }) as any) // generate
      .mockResolvedValueOnce(OK({}) as any) // saveAsset's ensureTable (build_media table-missing fix — best-effort, response unused)
      .mockResolvedValueOnce(OK({ ok: true }) as any) // saveAsset
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaGeneration('a::b', 'video', { companyName: 'Acme', tagline: 't', color: '#123' })
    expect(res.status).toBe('generated')
    expect(res.asset?.url).toBe('http://x/gen.mp4')
    // The generation request must hit the multimodal video endpoint with an on-brand prompt.
    const firstCall = fetchMock.mock.calls[0]
    expect(String(firstCall[0])).toContain('/api/v1/multimodal/video/t2v')
    expect(String(firstCall[1].body)).toContain('Acme')
  })

  describe('image generation — real response shape is {image_base64}, not a url (live repro, 2026-09)', () => {
    // Direct curl against the real production endpoint confirmed the actual
    // response shape: {"image_base64": "..."}. The route used to only know
    // how to extract a `url` field (mirroring the video endpoint's shape),
    // so EVERY real image generation call silently returned status:'failed'
    // even though the multimodal call itself succeeded — the base64 payload
    // was never decoded, uploaded to durable storage, or turned into a URL.

    it('decodes image_base64, uploads it, and persists the durable asset URL', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(OK({ image_base64: Buffer.from('fake-png-bytes').toString('base64'), provider: 'multimodal' }) as any) // generate
        .mockResolvedValueOnce(OK({ file_id: '11111111-1111-1111-1111-111111111111' }) as any) // uploadMediaFile
        .mockResolvedValueOnce(OK({}) as any) // saveAsset's ensureTable
        .mockResolvedValueOnce(OK({ ok: true }) as any) // saveAsset
      vi.stubGlobal('fetch', fetchMock)
      const res = await runMediaGeneration('a::b', 'image', { companyName: 'Acme' })
      expect(res.status).toBe('generated')
      expect(res.asset?.url).toBe('/api/build/media/upload?id=11111111-1111-1111-1111-111111111111')
      // The upload call must send the real decoded bytes as multipart form data.
      const uploadCall = fetchMock.mock.calls[1]
      expect(String(uploadCall[0])).toContain('/files/upload')
    })

    it('reports failed when image_base64 is present but the upload itself fails', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(OK({ image_base64: Buffer.from('x').toString('base64') }) as any) // generate
        .mockResolvedValueOnce(ERR(500) as any) // uploadMediaFile fails
      vi.stubGlobal('fetch', fetchMock)
      const res = await runMediaGeneration('a::b', 'image', {})
      expect(res.status).toBe('failed')
    })

    it('reports failed (never crashes) on an empty/malformed base64 payload', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      vi.stubGlobal('fetch', vi.fn(async () => OK({ image_base64: '' }) as any))
      const res = await runMediaGeneration('a::b', 'image', {})
      expect(res.status).toBe('failed')
    })

    it('a real url field still wins for image responses that provide one directly (defensive — does not regress if core ever changes shape)', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(OK({ url: 'http://x/direct.png', image_base64: 'should-be-ignored' }) as any)
        .mockResolvedValueOnce(OK({}) as any)
        .mockResolvedValueOnce(OK({ ok: true }) as any)
      vi.stubGlobal('fetch', fetchMock)
      const res = await runMediaGeneration('a::b', 'image', {})
      expect(res.status).toBe('generated')
      expect(res.asset?.url).toBe('http://x/direct.png')
      // Only 3 calls (generate + ensureTable + saveAsset) — never touched the upload path.
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
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

  // #404: video generation is async — the initial POST only accepts the job
  // (status:'processing' + task_id), it never returns a finished video_url.
  it('runMediaGeneration polls to completion for an async video job', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    // First poll attempt already reports Success — pollVideoStatus's internal
    // loop exits before ever calling its (real, un-injectable from this call
    // path) sleep, so this stays fast without needing fake timers. The
    // multi-attempt progression (Preparing → Processing → Success) is covered
    // directly against pollVideoStatus below, where the fast sleep IS injectable.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ status: 'processing', task_id: 'task-1' }) as any) // initial POST
      .mockResolvedValueOnce(OK({ status: 'Success', task_id: 'task-1', video_url: 'http://x/v.mp4' }) as any) // poll — done
      .mockResolvedValueOnce(OK({}) as any) // saveAsset's ensureTable (build_media table-missing fix)
      .mockResolvedValueOnce(OK({ ok: true }) as any) // saveAsset
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaGeneration('a::b', 'video', { companyName: 'Acme' })
    expect(res.status).toBe('generated')
    expect(res.asset?.url).toBe('http://x/v.mp4')
    // Poll call hits the real status endpoint with the task id.
    const pollCall = fetchMock.mock.calls[1]
    expect(String(pollCall[0])).toContain('/api/v1/multimodal/video/status/task-1')
  })

  it('runMediaGeneration reports failed when the video job terminally fails', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ status: 'processing', task_id: 'task-1' }) as any)
      .mockResolvedValueOnce(OK({ status: 'Fail', task_id: 'task-1' }) as any)
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaGeneration('a::b', 'video', {})
    expect(res.status).toBe('failed')
  })

  it('runMediaGeneration does not poll when the initial video response already has a url', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ status: 'Success', video_url: 'http://x/v.mp4' }) as any)
      .mockResolvedValueOnce(OK({}) as any) // saveAsset's ensureTable (build_media table-missing fix)
      .mockResolvedValueOnce(OK({ ok: true }) as any) // saveAsset
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaGeneration('a::b', 'video', {})
    expect(res.status).toBe('generated')
    expect(fetchMock).toHaveBeenCalledTimes(3) // generate + ensureTable + saveAsset, no separate poll call
  })

  it('runMediaGeneration does not poll for image generation even without a url', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'processing', task_id: 'task-1' }) as any))
    const res = await runMediaGeneration('a::b', 'image', {})
    expect(res.status).toBe('failed')
  })
})

describe('pollVideoStatus (#404)', () => {
  const fastSleep = async () => {}

  it('returns completed with the video url on Success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'Success', video_url: 'http://x/v.mp4' }) as any))
    const res = await pollVideoStatus('t1', { sleep: fastSleep })
    expect(res).toEqual({ status: 'completed', videoUrl: 'http://x/v.mp4' })
  })

  it('returns failed on a Success status with no video url (never fabricates a url)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'Success' }) as any))
    const res = await pollVideoStatus('t1', { sleep: fastSleep })
    expect(res.status).toBe('failed')
  })

  it('returns failed on Fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'Fail' }) as any))
    expect((await pollVideoStatus('t1', { sleep: fastSleep })).status).toBe('failed')
  })

  it('returns failed on Failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'Failed' }) as any))
    expect((await pollVideoStatus('t1', { sleep: fastSleep })).status).toBe('failed')
  })

  it('keeps polling through Preparing/Processing/Queueing until Success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ status: 'Preparing' }) as any)
      .mockResolvedValueOnce(OK({ status: 'Queueing' }) as any)
      .mockResolvedValueOnce(OK({ status: 'Processing' }) as any)
      .mockResolvedValueOnce(OK({ status: 'Success', video_url: 'http://x/v.mp4' }) as any)
    vi.stubGlobal('fetch', fetchMock)
    const res = await pollVideoStatus('t1', { sleep: fastSleep })
    expect(res).toEqual({ status: 'completed', videoUrl: 'http://x/v.mp4' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('never hangs indefinitely — times out honestly when the job never terminates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'Processing' }) as any))
    // A tiny timeout + interval so the loop actually exhausts real wall-clock quickly.
    const res = await pollVideoStatus('t1', { sleep: fastSleep, intervalMs: 1, timeoutMs: 5 })
    expect(res.status).toBe('timeout')
  })

  it('survives a transient poll failure and keeps trying until it succeeds', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(OK({ status: 'Success', video_url: 'http://x/v.mp4' }) as any)
    vi.stubGlobal('fetch', fetchMock)
    const res = await pollVideoStatus('t1', { sleep: fastSleep })
    expect(res).toEqual({ status: 'completed', videoUrl: 'http://x/v.mp4' })
  })

  it('survives a non-ok poll response and keeps trying', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ERR(502) as any)
      .mockResolvedValueOnce(OK({ status: 'Success', video_url: 'http://x/v.mp4' }) as any)
    vi.stubGlobal('fetch', fetchMock)
    const res = await pollVideoStatus('t1', { sleep: fastSleep })
    expect(res).toEqual({ status: 'completed', videoUrl: 'http://x/v.mp4' })
  })
})
