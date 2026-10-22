import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for Netlify deployment service (US-068).
 *
 * I/O boundaries mocked: `@/lib/db` (drizzle), credentials.service,
 * export.service, and global `fetch`. The `form-data` package's own
 * internals are exercised for real (it is a pure in-memory builder, no
 * network I/O), so only its consumer (fetch) needs mocking.
 */

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({ deployments: {}, generations: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a, b) => ({ a, b })) }))

const getCredentialsWithFallbackMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/credentials.service', () => ({
  getCredentialsWithFallback: getCredentialsWithFallbackMock,
}))

const exportProjectMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/export.service', () => ({
  exportProject: exportProjectMock,
}))

function selectChain(rows: any[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }
}
function insertChain(row: any) {
  return { values: () => ({ returning: () => Promise.resolve([row]) }) }
}
function updateChain() {
  return { set: () => ({ where: () => Promise.resolve(undefined) }) }
}

describe('deployToNetlify', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    vi.clearAllMocks()
    exportProjectMock.mockResolvedValue(Buffer.from('zip-bytes'))
    dbMock.insert.mockReturnValue(insertChain({ id: 'deploy-1' }))
    dbMock.update.mockReturnValue(updateChain())
  })

  it('throws when no API token is available', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue(null)
    const { deployToNetlify } = await import('@/lib/services/deployment/netlify.service')

    await expect(
      deployToNetlify({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Netlify API token not found')
  })

  it('throws when the generation does not exist', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([]))
    const { deployToNetlify } = await import('@/lib/services/deployment/netlify.service')

    await expect(
      deployToNetlify({ generationId: 'missing', userId: 'user-1' })
    ).rejects.toThrow('Generation not found')
  })

  it('throws when the generation belongs to a different user', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'other' }]))
    const { deployToNetlify } = await import('@/lib/services/deployment/netlify.service')

    await expect(
      deployToNetlify({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Unauthorized access to generation')
  })

  it('deploys successfully: creates a site then uploads, recording the ssl_url and ready status', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    const fetchMock = vi.fn()
    // 1st call: createNetlifySite
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'site-1', name: 'my-site', url: 'http://my-site.netlify.app', admin_url: '', ssl_url: 'https://my-site.netlify.app' }),
    })
    // 2nd call: uploadToNetlify
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'deploy-netlify-1', site_id: 'site-1', state: 'ready', url: 'http://my-site.netlify.app', ssl_url: 'https://my-site.netlify.app' }),
    })
    global.fetch = fetchMock as any

    const { deployToNetlify } = await import('@/lib/services/deployment/netlify.service')
    const result = await deployToNetlify({ generationId: 'gen-1', userId: 'user-1' })

    expect(result).toBe('deploy-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/sites')
    expect(fetchMock.mock.calls[1][0]).toContain('/sites/site-1/deploys')
  })

  it('uses the custom siteName when provided', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'site-1', name: 'custom-name', url: '', admin_url: '', ssl_url: '' }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'd1', site_id: 'site-1', state: 'building', url: 'x', ssl_url: '' }),
    })
    global.fetch = fetchMock as any

    const { deployToNetlify } = await import('@/lib/services/deployment/netlify.service')
    await deployToNetlify({ generationId: 'gen-1', userId: 'user-1', siteName: 'custom-name' })

    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(createBody.name).toBe('custom-name')
  })

  it('marks the deployment errored and rethrows when site creation fails', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'name taken',
    }) as any

    const { deployToNetlify } = await import('@/lib/services/deployment/netlify.service')

    await expect(
      deployToNetlify({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Netlify site creation error (422)')
  })

  it('marks the deployment errored and rethrows when the upload step fails', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'site-1', name: 'x', url: '', admin_url: '', ssl_url: '' }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'upload failed',
    })
    global.fetch = fetchMock as any

    const { deployToNetlify } = await import('@/lib/services/deployment/netlify.service')

    await expect(
      deployToNetlify({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Netlify upload error (500)')
  })
})

describe('getNetlifyDeploymentStatus', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns state and ssl_url when present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: 'ready', ssl_url: 'https://x.netlify.app', url: 'http://x.netlify.app' }),
    }) as any

    const { getNetlifyDeploymentStatus } = await import('@/lib/services/deployment/netlify.service')
    const result = await getNetlifyDeploymentStatus('d1', 'token')

    expect(result).toEqual({ status: 'ready', url: 'https://x.netlify.app' })
  })

  it('falls back to url when ssl_url is absent', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: 'building', url: 'http://x.netlify.app' }),
    }) as any

    const { getNetlifyDeploymentStatus } = await import('@/lib/services/deployment/netlify.service')
    const result = await getNetlifyDeploymentStatus('d1', 'token')

    expect(result.url).toBe('http://x.netlify.app')
  })

  it('throws on a failed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any
    const { getNetlifyDeploymentStatus } = await import('@/lib/services/deployment/netlify.service')

    await expect(getNetlifyDeploymentStatus('d1', 'token')).rejects.toThrow(
      'Failed to get Netlify deployment status: 404'
    )
  })
})

describe('deleteNetlifySite', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any
    const { deleteNetlifySite } = await import('@/lib/services/deployment/netlify.service')

    await expect(deleteNetlifySite('site-1', 'token')).resolves.toBeUndefined()
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sites/site-1'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('throws on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as any
    const { deleteNetlifySite } = await import('@/lib/services/deployment/netlify.service')

    await expect(deleteNetlifySite('site-1', 'token')).rejects.toThrow(
      'Failed to delete Netlify site: 403'
    )
  })
})

describe('listNetlifySites', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns the parsed sites array on success', async () => {
    const sites = [{ id: 's1', name: 'a', url: '', admin_url: '', ssl_url: '' }]
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sites }) as any
    const { listNetlifySites } = await import('@/lib/services/deployment/netlify.service')

    const result = await listNetlifySites('token')
    expect(result).toEqual(sites)
  })

  it('throws on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any
    const { listNetlifySites } = await import('@/lib/services/deployment/netlify.service')

    await expect(listNetlifySites('token')).rejects.toThrow('Failed to list Netlify sites: 401')
  })
})
