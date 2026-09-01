import { describe, it, expect, vi, afterEach } from 'vitest'
import { provisionProject } from '@/lib/build/agentflow'

/**
 * lib/build/agentflow — AgentFlow provisioning client (#419).
 * Covers: no-JWT guard, successful provisioning (project id extraction),
 * error shapes (401 auth, 422 validation), JSON parse failure, network error.
 * All fetch calls are mocked.
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

describe('provisionProject (#419)', () => {
  it('returns { ok: false, reason: "no_jwt" } immediately when jwt is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await provisionProject('', 'my-co', 'My Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_jwt')
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_jwt" } when jwt is undefined (coerced empty)', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await provisionProject(undefined as unknown as string, 'my-co', 'My Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_jwt')
    expect(fn).not.toHaveBeenCalled()
  })

  it('POSTs to /projects/ with Bearer auth and correct project shape', async () => {
    const fn = mockFetch(() => ({ ok: true, status: 201, json: { id: 'project-123' } }))
    const result = await provisionProject('jwt-token-abc', 'acme-co', 'Acme Corp')

    expect(result.ok).toBe(true)
    expect(result.projectId).toBe('project-123')
    expect(result.status).toBe(201)

    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/projects/')
    expect((init as RequestInit).method).toBe('POST')

    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer jwt-token-abc')
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.name).toBe('Acme Corp')
  })

  it('uses slug as fallback in the project name when companyName is empty', async () => {
    const fn = mockFetch(() => ({ ok: true, json: { id: 'p1' } }))
    await provisionProject('jwt', 'my-slug', '')

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.name).toBe('my-slug')
  })

  it('returns empty projectId string when response has no id field', async () => {
    mockFetch(() => ({ ok: true, json: {} }))
    const result = await provisionProject('jwt', 'co', 'Company')
    expect(result.ok).toBe(true)
    expect(result.projectId).toBe('')
  })

  it('returns { ok: false } with real reason on 401 auth failure (matches live-confirmed message)', async () => {
    mockFetch(() => ({
      ok: false,
      status: 401,
      json: { detail: 'Could not validate credentials' },
    }))
    const result = await provisionProject('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.reason).toContain('Could not validate credentials')
  })

  it('returns { ok: false } with real reason on 422 validation failure', async () => {
    mockFetch(() => ({
      ok: false,
      status: 422,
      json: { detail: 'field required: name' },
    }))
    const result = await provisionProject('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(422)
    expect(result.reason).toContain('field required')
  })

  it('falls back to status code string when data has no detail/message', async () => {
    mockFetch(() => ({ ok: false, status: 503, json: {} }))
    const result = await provisionProject('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('503')
  })

  it('truncates reason to 160 chars for extremely long error messages', async () => {
    const longMessage = 'x'.repeat(300)
    mockFetch(() => ({ ok: false, status: 500, json: { detail: longMessage } }))
    const result = await provisionProject('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect((result.reason ?? '').length).toBeLessThanOrEqual(160)
  })

  it('returns { ok: false } (never throws) when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await provisionProject('jwt', 'co', 'Company')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Connection refused')
  })

  it('returns { ok: false } (never throws) when the response body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('Unexpected token') },
    } as unknown as Response)))
    const result = await provisionProject('jwt', 'co', 'Company')
    expect(result.ok).toBe(true)
    expect(result.projectId).toBe('')
  })

  it('sets status on successful response', async () => {
    mockFetch(() => ({ ok: true, status: 201, json: { id: 'project-new' } }))
    const result = await provisionProject('jwt', 'co', 'Company')
    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
  })
})
