import { describe, it, expect, vi, afterEach } from 'vitest'
import { provisionPipeline } from '@/lib/build/zeropipeline'

/**
 * lib/build/zeropipeline — ZeroPipeline provisioning client (#243).
 * Covers: no-JWT guard, successful provisioning (pipeline id extraction),
 * error shapes (non-ok response with message/detail), JSON parse failure,
 * network error. All fetch calls are mocked.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ?? {}),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('provisionPipeline (#243)', () => {
  it('returns { ok: false, reason: "no_jwt" } immediately when jwt is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await provisionPipeline('', 'my-co', 'My Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_jwt')
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_jwt" } when jwt is undefined (coerced empty)', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    // TypeScript won't allow undefined without cast, but test the runtime behavior
    const result = await provisionPipeline(undefined as unknown as string, 'my-co', 'My Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_jwt')
    expect(fn).not.toHaveBeenCalled()
  })

  it('POSTs to /pipelines with Bearer auth and correct pipeline shape', async () => {
    const fn = mockFetch(() => ({ ok: true, json: { id: 'pipeline-123' } }))
    const result = await provisionPipeline('jwt-token-abc', 'acme-co', 'Acme Corp')

    expect(result.ok).toBe(true)
    expect(result.pipelineId).toBe('pipeline-123')

    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/pipelines')
    expect((init as RequestInit).method).toBe('POST')

    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer jwt-token-abc')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Idempotency-Key']).toBe('builder-company:acme-co')

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.name).toBe('Acme Corp — Sales')
    expect(Array.isArray(body.stages)).toBe(true)
    expect(body.stages).toHaveLength(4)
    // Stages in order
    expect(body.stages[0]).toMatchObject({ name: 'Lead', order_index: 0 })
    expect(body.stages[1]).toMatchObject({ name: 'Qualifying', order_index: 1 })
    expect(body.stages[2]).toMatchObject({ name: 'Proposal', order_index: 2 })
    expect(body.stages[3]).toMatchObject({ name: 'Won', order_index: 3 })
  })

  it('uses slug as fallback in the pipeline name when companyName is empty', async () => {
    const fn = mockFetch(() => ({ ok: true, json: { id: 'p1' } }))
    await provisionPipeline('jwt', 'my-slug', '')

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.name).toBe('my-slug — Sales')
  })

  it('extracts pipelineId from data.pipeline.id as fallback', async () => {
    mockFetch(() => ({ ok: true, json: { pipeline: { id: 'pipeline-nested-456' } } }))
    const result = await provisionPipeline('jwt', 'co', 'Company')
    expect(result.ok).toBe(true)
    expect(result.pipelineId).toBe('pipeline-nested-456')
  })

  it('returns empty pipelineId string when response has no id fields', async () => {
    mockFetch(() => ({ ok: true, json: {} }))
    const result = await provisionPipeline('jwt', 'co', 'Company')
    expect(result.ok).toBe(true)
    expect(result.pipelineId).toBe('')
  })

  it('returns { ok: false } with reason from data.message on non-ok response', async () => {
    mockFetch(() => ({
      ok: false,
      status: 400,
      json: { message: 'Invalid JWT token', detail: null },
    }))
    const result = await provisionPipeline('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.reason).toContain('Invalid JWT token')
  })

  it('returns { ok: false } with reason from data.detail when message is absent', async () => {
    mockFetch(() => ({
      ok: false,
      status: 422,
      json: { detail: 'Unprocessable entity: missing stages' },
    }))
    const result = await provisionPipeline('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Unprocessable entity')
  })

  it('falls back to status code string when data has no message/detail', async () => {
    mockFetch(() => ({ ok: false, status: 503, json: {} }))
    const result = await provisionPipeline('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('503')
  })

  it('truncates reason to 160 chars for extremely long error messages', async () => {
    const longMessage = 'x'.repeat(300)
    mockFetch(() => ({ ok: false, status: 500, json: { message: longMessage } }))
    const result = await provisionPipeline('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect((result.reason ?? '').length).toBeLessThanOrEqual(160)
  })

  it('returns { ok: false } (never throws) when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await provisionPipeline('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Connection refused')
  })

  it('sets status on successful response', async () => {
    mockFetch(() => ({ ok: true, status: 201, json: { id: 'p-new' } }))
    const result = await provisionPipeline('jwt', 'co', 'Company')
    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
  })

  it('uses idempotency key derived from slug (same slug = same key)', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>
      calls.push(h['Idempotency-Key'])
      return { ok: true, json: async () => ({ id: 'p1' }) } as unknown as Response
    }))

    await provisionPipeline('jwt', 'same-slug', 'Co 1')
    await provisionPipeline('jwt', 'same-slug', 'Co 2')

    expect(calls[0]).toBe(calls[1])
    expect(calls[0]).toBe('builder-company:same-slug')
  })
})
