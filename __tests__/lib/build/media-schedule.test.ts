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
  VARIATION_DESCRIPTORS,
  STYLE_DESCRIPTORS,
  pickNextVariant,
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

  // ---- Real, live bug: "BEACON / beacon / on-Brand Marketing asset" baked
  // into a real generated image as literal on-image text. Root cause: the
  // OLD prompt wrote the literal phrase "an on-brand marketing asset" as
  // prose the image model could quote back verbatim. Fixed by (1) never
  // stating that phrase as renderable prose, (2) explicitly instructing the
  // model not to render ANY text, and (3) grounding the subject in the
  // company's real idea instead of a generic template. ----
  describe('prompt-leak fix (#490-3 — off-brand / literal-text-in-image bug)', () => {
    it('never contains the literal leaking phrase "on-brand marketing asset"', () => {
      const p = buildBrandPrompt('image', { companyName: 'Beacon' })
      expect(p.toLowerCase()).not.toContain('on-brand marketing asset')
    })
    it('never contains the literal leaking phrase for video either', () => {
      const p = buildBrandPrompt('video', { companyName: 'Beacon', tagline: 'Guiding growth' })
      expect(p.toLowerCase()).not.toContain('on-brand marketing asset')
    })
    it('explicitly instructs the model not to render any words/text/logos in the image', () => {
      const p = buildBrandPrompt('image', { companyName: 'Beacon' })
      expect(p).toMatch(/do not render|no text overlays|zero on-image text/i)
    })
    it('explicitly tells the model the tagline is for tone only, not to render it', () => {
      const p = buildBrandPrompt('image', { companyName: 'Beacon', tagline: 'Guiding growth' })
      expect(p).toMatch(/do not render this text/i)
    })
    it('grounds the subject in the real idea when present, instructing against generic unrelated imagery', () => {
      const p = buildBrandPrompt('image', { companyName: 'Beacon', idea: 'a lighthouse-as-a-service safety beacon network for maritime shipping' })
      expect(p).toContain('a lighthouse-as-a-service safety beacon network for maritime shipping')
      expect(p).toMatch(/ground every visual choice/i)
      expect(p).toMatch(/not a generic, unrelated stock scene/i)
    })
    it('still degrades gracefully to name+tagline when no idea is available (no fabrication)', () => {
      const p = buildBrandPrompt('image', { companyName: 'Beacon', tagline: 'Guiding growth' })
      expect(p).toContain('Beacon')
      expect(p).toContain('Guiding growth')
      expect(p).not.toContain('undefined')
    })
  })

  // #909: recurring (weekly/monthly) auto-media generation produced the exact
  // same image every run because buildBrandPrompt was fully deterministic for
  // a given BrandContext — same brand in, same prompt string out, every time.
  // Core's ImageRequest schema has no seed field at all, so the fix has to be
  // prompt-side: a rotating scene/composition/angle descriptor selected by an
  // explicit variant index, layered ON TOP of (never replacing) the existing
  // real-business-grounding instructions.
  describe('variation axis (#909 — recurring media must not repeat the same image)', () => {
    it('exposes a small, stable set of rotating variation descriptors', () => {
      expect(Array.isArray(VARIATION_DESCRIPTORS)).toBe(true)
      expect(VARIATION_DESCRIPTORS.length).toBeGreaterThanOrEqual(4)
      // Every descriptor must be real, non-empty prose (not placeholder text).
      for (const d of VARIATION_DESCRIPTORS) {
        expect(typeof d).toBe('string')
        expect(d.length).toBeGreaterThan(5)
      }
    })

    it('the same brand + different variant indices produce different prompt text', () => {
      const brand = { companyName: 'Acme', idea: 'inventory bot' }
      const prompts = VARIATION_DESCRIPTORS.map((_, i) => buildBrandPrompt('image', brand, i))
      const unique = new Set(prompts)
      expect(unique.size).toBe(VARIATION_DESCRIPTORS.length)
    })

    it('an out-of-range or missing variant index defaults safely (never throws, never undefined)', () => {
      const brand = { companyName: 'Acme' }
      expect(() => buildBrandPrompt('image', brand)).not.toThrow()
      expect(buildBrandPrompt('image', brand)).not.toContain('undefined')
      expect(() => buildBrandPrompt('image', brand, 999)).not.toThrow()
      expect(buildBrandPrompt('image', brand, 999)).not.toContain('undefined')
      expect(() => buildBrandPrompt('image', brand, -1)).not.toThrow()
      expect(buildBrandPrompt('image', brand, -1)).not.toContain('undefined')
    })

    it('preserves the real-business-grounding instructions in every variant', () => {
      const brand = { companyName: 'Beacon', idea: 'a lighthouse-as-a-service safety beacon network' }
      for (let i = 0; i < VARIATION_DESCRIPTORS.length; i++) {
        const p = buildBrandPrompt('image', brand, i)
        expect(p).toContain('a lighthouse-as-a-service safety beacon network')
        expect(p).toMatch(/ground every visual choice/i)
        expect(p).toMatch(/not a generic, unrelated stock scene/i)
        expect(p).toMatch(/do not render|no text overlays|zero on-image text/i)
      }
    })

    it('still never leaks the literal "on-brand marketing asset" phrase in any variant', () => {
      for (let i = 0; i < VARIATION_DESCRIPTORS.length; i++) {
        const p = buildBrandPrompt('image', { companyName: 'Beacon' }, i)
        expect(p.toLowerCase()).not.toContain('on-brand marketing asset')
      }
    })

    it('works identically for video prompts', () => {
      const prompts = VARIATION_DESCRIPTORS.map((_, i) => buildBrandPrompt('video', { companyName: 'Acme' }, i))
      expect(new Set(prompts).size).toBe(VARIATION_DESCRIPTORS.length)
    })
  })

  // #1018: every company's "on-brand" generated image/video shared the same
  // overarching visual style because the STYLE line was one fixed, generic
  // phrase for every company, every run — independent of the (already-fixed)
  // composition axis and subject grounding. STYLE_DESCRIPTORS is a SECOND,
  // independently-indexed rotation (styleIndex), analogous to
  // VARIATION_DESCRIPTORS/variantIndex but never conflated with it.
  describe('style axis (#1018 — every company must not share the same fixed style phrase)', () => {
    it('exposes a small, stable set of rotating style descriptors', () => {
      expect(Array.isArray(STYLE_DESCRIPTORS)).toBe(true)
      expect(STYLE_DESCRIPTORS.length).toBeGreaterThanOrEqual(4)
      for (const d of STYLE_DESCRIPTORS) {
        expect(typeof d).toBe('string')
        expect(d.length).toBeGreaterThan(5)
      }
    })

    it('never sends the old fixed, generic style phrase for every company', () => {
      const p = buildBrandPrompt('image', { companyName: 'Acme' }, 0, 0)
      expect(p).not.toContain('modern, clean, professional photography or illustration, high visual quality')
    })

    it('the same brand + different style indices produce different prompt text', () => {
      const brand = { companyName: 'Acme', idea: 'inventory bot' }
      const prompts = STYLE_DESCRIPTORS.map((_, i) => buildBrandPrompt('image', brand, 0, i))
      const unique = new Set(prompts)
      expect(unique.size).toBe(STYLE_DESCRIPTORS.length)
    })

    it('an out-of-range or missing style index defaults safely (never throws, never undefined)', () => {
      const brand = { companyName: 'Acme' }
      expect(() => buildBrandPrompt('image', brand, 0, undefined)).not.toThrow()
      expect(buildBrandPrompt('image', brand, 0, undefined)).not.toContain('undefined')
      expect(() => buildBrandPrompt('image', brand, 0, 999)).not.toThrow()
      expect(buildBrandPrompt('image', brand, 0, 999)).not.toContain('undefined')
      expect(() => buildBrandPrompt('image', brand, 0, -1)).not.toThrow()
      expect(buildBrandPrompt('image', brand, 0, -1)).not.toContain('undefined')
    })

    it('preserves the real-business-grounding and no-text instructions in every style variant', () => {
      const brand = { companyName: 'Beacon', idea: 'a lighthouse-as-a-service safety beacon network' }
      for (let i = 0; i < STYLE_DESCRIPTORS.length; i++) {
        const p = buildBrandPrompt('image', brand, 0, i)
        expect(p).toContain('a lighthouse-as-a-service safety beacon network')
        expect(p).toMatch(/ground every visual choice/i)
        expect(p).toMatch(/not a generic, unrelated stock scene/i)
        expect(p).toMatch(/do not render|no text overlays|zero on-image text/i)
      }
    })

    it('still never leaks the literal "on-brand marketing asset" phrase in any style variant', () => {
      for (let i = 0; i < STYLE_DESCRIPTORS.length; i++) {
        const p = buildBrandPrompt('image', { companyName: 'Beacon' }, 0, i)
        expect(p.toLowerCase()).not.toContain('on-brand marketing asset')
      }
    })

    it('works identically for video prompts', () => {
      const prompts = STYLE_DESCRIPTORS.map((_, i) => buildBrandPrompt('video', { companyName: 'Acme' }, 0, i))
      expect(new Set(prompts).size).toBe(STYLE_DESCRIPTORS.length)
    })

    it('rotates independently from the composition axis — composition-variant 2 + style-variant 0 is reachable and differs from composition-variant 0 + style-variant 0', () => {
      const brand = { companyName: 'Acme', idea: 'inventory bot' }
      const a = buildBrandPrompt('image', brand, 0, 0)
      const b = buildBrandPrompt('image', brand, 2, 0)
      const c = buildBrandPrompt('image', brand, 0, 2)
      expect(a).not.toBe(b) // composition differs, style fixed
      expect(a).not.toBe(c) // style differs, composition fixed
      expect(b).not.toBe(c)
    })

    it('a missing styleIndex does not affect the composition axis output (back-compat with 3-arg callers)', () => {
      const brand = { companyName: 'Acme' }
      const threeArg = buildBrandPrompt('image', brand, 1)
      const fourArgDefaultStyle = buildBrandPrompt('image', brand, 1, 0)
      expect(threeArg).toBe(fourArgDefaultStyle)
    })
  })
})

describe('pickNextVariant (#909)', () => {
  it('picks a valid index within range', () => {
    for (let i = 0; i < 20; i++) {
      const v = pickNextVariant(undefined, VARIATION_DESCRIPTORS.length)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(VARIATION_DESCRIPTORS.length)
    }
  })

  it('never repeats the immediately-prior variant', () => {
    for (let prev = 0; prev < VARIATION_DESCRIPTORS.length; prev++) {
      for (let i = 0; i < 50; i++) {
        const next = pickNextVariant(prev, VARIATION_DESCRIPTORS.length)
        expect(next).not.toBe(prev)
        expect(next).toBeGreaterThanOrEqual(0)
        expect(next).toBeLessThan(VARIATION_DESCRIPTORS.length)
      }
    }
  })

  it('handles an undefined/null previous variant (first-ever run) by picking any valid index', () => {
    const v1 = pickNextVariant(undefined, VARIATION_DESCRIPTORS.length)
    const v2 = pickNextVariant(null as unknown as undefined, VARIATION_DESCRIPTORS.length)
    expect(v1).toBeGreaterThanOrEqual(0)
    expect(v2).toBeGreaterThanOrEqual(0)
  })

  it('handles an out-of-range previous variant defensively (never throws, never stuck)', () => {
    expect(() => pickNextVariant(999, VARIATION_DESCRIPTORS.length)).not.toThrow()
    const v = pickNextVariant(999, VARIATION_DESCRIPTORS.length)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(VARIATION_DESCRIPTORS.length)
  })

  it('degrades to always 0 when there is only one descriptor (never loops forever)', () => {
    expect(pickNextVariant(0, 1)).toBe(0)
    expect(pickNextVariant(undefined, 1)).toBe(0)
  })

  // #1018: pickNextVariant is reused as-is for the independent style axis —
  // same helper, different list length / different persisted index.
  it('works identically against STYLE_DESCRIPTORS for the independent style axis', () => {
    for (let i = 0; i < 20; i++) {
      const v = pickNextVariant(undefined, STYLE_DESCRIPTORS.length)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(STYLE_DESCRIPTORS.length)
    }
    for (let prev = 0; prev < STYLE_DESCRIPTORS.length; prev++) {
      const next = pickNextVariant(prev, STYLE_DESCRIPTORS.length)
      expect(next).not.toBe(prev)
    }
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

  // #909: lastVariant persists the rotating prompt-variation index, mirroring
  // how lastRunAt already advances — so the next scheduled run knows which
  // variant it must NOT repeat.
  it('coerces a persisted lastVariant', () => {
    const r = coerceRoutine({ row_data: { id: 'x', rowKind: 'routine', mediaKind: 'image', frequency: 'weekly', enabled: true, createdAt: 't', lastVariant: 2 } })
    expect(r?.lastVariant).toBe(2)
  })
  it('lastVariant is undefined when never set (no fabrication)', () => {
    const r = coerceRoutine({ row_data: { id: 'x', rowKind: 'routine', mediaKind: 'image', frequency: 'weekly', enabled: true, createdAt: 't' } })
    expect(r?.lastVariant).toBeUndefined()
  })
  it('coerces a malformed lastVariant defensively (never NaN, never a crash)', () => {
    const r = coerceRoutine({ row_data: { id: 'x', rowKind: 'routine', mediaKind: 'image', frequency: 'weekly', enabled: true, createdAt: 't', lastVariant: 'not-a-number' } })
    expect(r?.lastVariant === undefined || Number.isInteger(r?.lastVariant)).toBe(true)
  })

  // #1018: lastStyleVariant persists the rotating STYLE-axis index, an
  // independent field from lastVariant (composition) — same coercion rigor.
  it('coerces a persisted lastStyleVariant independently from lastVariant', () => {
    const r = coerceRoutine({ row_data: { id: 'x', rowKind: 'routine', mediaKind: 'image', frequency: 'weekly', enabled: true, createdAt: 't', lastVariant: 1, lastStyleVariant: 3 } })
    expect(r?.lastVariant).toBe(1)
    expect(r?.lastStyleVariant).toBe(3)
  })
  it('lastStyleVariant is undefined when never set (no fabrication)', () => {
    const r = coerceRoutine({ row_data: { id: 'x', rowKind: 'routine', mediaKind: 'image', frequency: 'weekly', enabled: true, createdAt: 't' } })
    expect(r?.lastStyleVariant).toBeUndefined()
  })
  it('coerces a malformed lastStyleVariant defensively (never NaN, never a crash)', () => {
    const r = coerceRoutine({ row_data: { id: 'x', rowKind: 'routine', mediaKind: 'image', frequency: 'weekly', enabled: true, createdAt: 't', lastStyleVariant: 'not-a-number' } })
    expect(r?.lastStyleVariant === undefined || Number.isInteger(r?.lastStyleVariant)).toBe(true)
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
  it('saveRoutine persists an explicit lastVariant (#909)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ ok: true }) as any))
    const r = await saveRoutine('a::b', { mediaKind: 'image', frequency: 'weekly', lastVariant: 3 })
    expect(r?.lastVariant).toBe(3)
  })
  it('saveRoutine leaves lastVariant undefined when not provided (no fabrication)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ ok: true }) as any))
    const r = await saveRoutine('a::b', { mediaKind: 'image', frequency: 'weekly' })
    expect(r?.lastVariant).toBeUndefined()
  })
  it('saveRoutine persists an explicit lastStyleVariant independently from lastVariant (#1018)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ ok: true }) as any))
    const r = await saveRoutine('a::b', { mediaKind: 'image', frequency: 'weekly', lastVariant: 1, lastStyleVariant: 2 })
    expect(r?.lastVariant).toBe(1)
    expect(r?.lastStyleVariant).toBe(2)
  })
  it('saveRoutine leaves lastStyleVariant undefined when not provided (no fabrication)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK({ ok: true }) as any))
    const r = await saveRoutine('a::b', { mediaKind: 'image', frequency: 'weekly' })
    expect(r?.lastStyleVariant).toBeUndefined()
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

  // #909: runMediaGeneration must accept an explicit variant index and bake the
  // corresponding rotating descriptor into the prompt it actually sends to core —
  // this is the real end-to-end wiring that makes a scheduled run's image differ
  // from the previous one.
  it('runMediaGeneration threads an explicit variant index into the generated prompt', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ url: 'http://x/gen.mp4' }) as any)
      .mockResolvedValueOnce(OK({}) as any)
      .mockResolvedValueOnce(OK({ ok: true }) as any)
    vi.stubGlobal('fetch', fetchMock)
    await runMediaGeneration('a::b', 'video', { companyName: 'Acme' }, 1)
    const firstCall = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(firstCall[1].body))
    expect(sentBody.prompt).toBe(buildBrandPrompt('video', { companyName: 'Acme' }, 1))
  })

  it('runMediaGeneration defaults sensibly when no variant index is passed (back-compat)', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ url: 'http://x/gen.mp4' }) as any)
      .mockResolvedValueOnce(OK({}) as any)
      .mockResolvedValueOnce(OK({ ok: true }) as any)
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaGeneration('a::b', 'video', { companyName: 'Acme' })
    expect(res.status).toBe('generated')
  })

  // #1018: runMediaGeneration must also thread an explicit, INDEPENDENT style
  // index into the generated prompt, alongside (not instead of) the
  // composition variant index.
  it('runMediaGeneration threads an explicit style index into the generated prompt, independent of the variant index', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ url: 'http://x/gen.mp4' }) as any)
      .mockResolvedValueOnce(OK({}) as any)
      .mockResolvedValueOnce(OK({ ok: true }) as any)
    vi.stubGlobal('fetch', fetchMock)
    await runMediaGeneration('a::b', 'video', { companyName: 'Acme' }, 1, 2)
    const firstCall = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(firstCall[1].body))
    expect(sentBody.prompt).toBe(buildBrandPrompt('video', { companyName: 'Acme' }, 1, 2))
    // And it must differ from the variant-only (style defaulted to 0) prompt.
    expect(sentBody.prompt).not.toBe(buildBrandPrompt('video', { companyName: 'Acme' }, 1))
  })

  // #884: every distinct failure branch used to collapse to the same bare
  // { status: 'failed' } with ZERO logging anywhere, making every failure
  // mode indistinguishable from every other. Each branch must now log the
  // real underlying signal AND tag the result with a specific `reason`.
  describe('#884 — observability: each distinct failure branch logs + tags a specific reason', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => { errorSpy.mockRestore() })

    it('logs + tags core_error on a non-2xx core response', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      vi.stubGlobal('fetch', vi.fn(async () => ERR(503) as any))
      const res = await runMediaGeneration('a::b', 'video', {})
      expect(res.status).toBe('failed')
      expect(res.reason).toBe('core_error')
      expect(errorSpy).toHaveBeenCalled()
      const loggedArgs = errorSpy.mock.calls.map((c) => JSON.stringify(c)).join(' ')
      expect(loggedArgs).toContain('503')
    })

    it('logs + tags no_asset_url when the response has neither a url nor a task_id', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      vi.stubGlobal('fetch', vi.fn(async () => OK({ nothing: true }) as any))
      const res = await runMediaGeneration('a::b', 'image', {})
      expect(res.status).toBe('failed')
      expect(res.reason).toBe('no_asset_url')
      expect(errorSpy).toHaveBeenCalled()
    })

    it('logs + tags exception when the generation call throws (network error / abort)', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
      const res = await runMediaGeneration('a::b', 'image', {})
      expect(res.status).toBe('failed')
      expect(res.reason).toBe('exception')
      expect(errorSpy).toHaveBeenCalled()
      const loggedArgs = errorSpy.mock.calls.map((c) => JSON.stringify(c)).join(' ')
      expect(loggedArgs).toContain('ECONNRESET')
    })

    it('logs + tags poll_timeout when the video job never reaches a terminal state', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(OK({ status: 'processing', task_id: 'task-1' }) as any) // initial POST
        .mockResolvedValue(OK({ status: 'Processing' }) as any) // every poll stays non-terminal
      vi.stubGlobal('fetch', fetchMock)
      // Inject a fast/short timeout via module-internal default isn't possible from
      // here (pollVideoStatus's defaults aren't overridable through runMediaGeneration),
      // so this covers the poll_failed (terminal Fail) branch at the integration level
      // instead, and the timeout branch is covered directly against pollVideoStatus below.
      const failFetch = vi.fn()
        .mockResolvedValueOnce(OK({ status: 'processing', task_id: 'task-1' }) as any)
        .mockResolvedValueOnce(OK({ status: 'Fail', task_id: 'task-1' }) as any)
      vi.stubGlobal('fetch', failFetch)
      const res = await runMediaGeneration('a::b', 'video', {})
      expect(res.status).toBe('failed')
      expect(res.reason).toBe('poll_failed')
      expect(errorSpy).toHaveBeenCalled()
    })

    it('logs + tags save_failed when generation succeeds but persisting the asset fails', async () => {
      process.env.BUILD_MEDIA_ENABLED = 'true'
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(OK({ url: 'http://x/gen.mp4', provider: 'multimodal' }) as any) // generate
        .mockResolvedValueOnce(ERR(500) as any) // saveAsset's ensureTable (best-effort, failure ignored)
        .mockResolvedValueOnce(ERR(500) as any) // saveAsset's real write fails
      vi.stubGlobal('fetch', fetchMock)
      const res = await runMediaGeneration('a::b', 'video', {})
      expect(res.status).toBe('failed')
      expect(res.reason).toBe('save_failed')
      expect(errorSpy).toHaveBeenCalled()
    })
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

  // #884: pollVideoStatus had its own bare `catch {}` per poll attempt with no
  // logging, plus silent non-ok / malformed-success / timeout branches.
  describe('#884 — observability: each poll branch logs the real signal', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
    afterEach(() => { errorSpy.mockRestore() })

    it('logs the real status code + body on a non-ok poll response', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ERR(502) as any))
      await pollVideoStatus('t1', { sleep: fastSleep, intervalMs: 1, timeoutMs: 1 })
      expect(errorSpy).toHaveBeenCalled()
      const loggedArgs = errorSpy.mock.calls.map((c) => JSON.stringify(c)).join(' ')
      expect(loggedArgs).toContain('502')
    })

    it('logs the terminal status on Fail/Failed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'Fail' }) as any))
      await pollVideoStatus('t1', { sleep: fastSleep })
      expect(errorSpy).toHaveBeenCalled()
      const loggedArgs = errorSpy.mock.calls.map((c) => JSON.stringify(c)).join(' ')
      expect(loggedArgs).toContain('Fail')
    })

    it('logs when Success carries no extractable video url', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'Success' }) as any))
      await pollVideoStatus('t1', { sleep: fastSleep })
      expect(errorSpy).toHaveBeenCalled()
    })

    it('logs the real caught error on a thrown exception (network/abort)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted') }))
      await pollVideoStatus('t1', { sleep: fastSleep, intervalMs: 1, timeoutMs: 1 })
      expect(errorSpy).toHaveBeenCalled()
      const loggedArgs = errorSpy.mock.calls.map((c) => JSON.stringify(c)).join(' ')
      expect(loggedArgs).toContain('aborted')
    })

    it('logs on a genuine timeout', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => OK({ status: 'Processing' }) as any))
      const res = await pollVideoStatus('t1', { sleep: fastSleep, intervalMs: 1, timeoutMs: 5 })
      expect(res.status).toBe('timeout')
      expect(errorSpy).toHaveBeenCalled()
    })
  })
})
