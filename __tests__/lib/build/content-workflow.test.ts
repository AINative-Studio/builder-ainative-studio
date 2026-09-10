import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createDefaultTwin } from '@/lib/build/content-workflow'

/**
 * lib/build/content-workflow — Content Workflow AI-twin auto-provisioning
 * client (#644 gap-analysis follow-up). Covers: the real twin-creation
 * fetch (X-API-Key auth, not a founder JWT), error shapes, a malformed
 * success response, and never-throws. All fetch calls are mocked.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 201 : 500),
      json: async () => (r.json ?? {}),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const origApiKey = process.env.AINATIVE_API_KEY

beforeEach(() => {
  process.env.AINATIVE_API_KEY = 'sk_test_service_key'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (origApiKey === undefined) delete process.env.AINATIVE_API_KEY
  else process.env.AINATIVE_API_KEY = origApiKey
})

describe('createDefaultTwin (#644)', () => {
  it('creates a twin using the service-level AINATIVE_API_KEY (X-API-Key, not a founder JWT)', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      status: 201,
      json: { id: 'twin-abc', name: 'Acme Co Voice', memory_namespace: 'twin_twin-abc' },
    }))
    const result = await createDefaultTwin('Acme Co')
    expect(result).toEqual({ ok: true, status: 201, twinId: 'twin-abc' })

    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/twins')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['X-API-Key']).toBe('sk_test_service_key')
    expect(headers).not.toHaveProperty('Authorization')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.name).toContain('Acme Co')
    expect(body.persona_prompt).toContain('Acme Co')
  })

  it('falls back to a generic name when no company name is given', async () => {
    const fn = mockFetch(() => ({ ok: true, status: 201, json: { id: 'twin-x' } }))
    await createDefaultTwin('')
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body))
    expect(body.name).toContain('Company')
  })

  it('surfaces a real 4xx/5xx error honestly', async () => {
    mockFetch(() => ({ ok: false, status: 422, json: { detail: 'invalid persona_prompt' } }))
    const result = await createDefaultTwin('Acme Co')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(422)
    expect(result.reason).toContain('invalid persona_prompt')
  })

  it('rejects a success response missing an id (malformed, never silently trusted)', async () => {
    mockFetch(() => ({ ok: true, status: 201, json: { name: 'no id here' } }))
    const result = await createDefaultTwin('Acme Co')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('twin_response_missing_id')
  })

  it('never throws when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await createDefaultTwin('Acme Co')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Connection refused')
  })

  it('truncates reason to 160 chars for extremely long error messages', async () => {
    const longMessage = 'x'.repeat(300)
    mockFetch(() => ({ ok: false, status: 500, json: { detail: longMessage } }))
    const result = await createDefaultTwin('Acme Co')
    expect((result.reason ?? '').length).toBeLessThanOrEqual(160)
  })
})
