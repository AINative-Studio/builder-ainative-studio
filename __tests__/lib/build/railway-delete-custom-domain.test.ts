import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('deleteCustomDomain', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('RAILWAY_API_TOKEN', 'real-railway-token')
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('calls the real customDomainDelete GraphQL mutation with the domain id', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: { customDomainDelete: true } }),
    })
    const { deleteCustomDomain } = await import('@/lib/build/railway-deploy')
    const result = await deleteCustomDomain('cd_abc123')
    expect(result.ok).toBe(true)
    const [, opts] = fetchMock.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.query).toContain('customDomainDelete')
    expect(body.variables).toEqual({ id: 'cd_abc123' })
  })

  it('reports the real GraphQL error, never throws', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ errors: [{ message: 'domain not found' }] }),
    })
    const { deleteCustomDomain } = await import('@/lib/build/railway-deploy')
    const result = await deleteCustomDomain('cd_missing')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('domain not found')
  })

  it('returns ok:false with reason "no_domain_id" when no id is given, without calling fetch', async () => {
    const { deleteCustomDomain } = await import('@/lib/build/railway-deploy')
    const result = await deleteCustomDomain('')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_domain_id')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
