import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import RealAdmZip from 'adm-zip'

/**
 * Unit tests for Vercel deployment service (US-067).
 *
 * All I/O boundaries are mocked:
 * - `@/lib/db` (drizzle) for the deployments/generations tables
 * - `credentials.service` for the stored/fallback API token lookup
 * - `export.service` for the zipped project buffer
 * - global `fetch` for the Vercel REST API calls
 * - `adm-zip` for reading the exported project buffer's zip entries
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

// vercel.service.ts loads adm-zip via CJS require() at call time, which
// vitest's ESM-oriented vi.mock cannot intercept reliably in this runtime.
// Instead of mocking the library, build a real tiny zip buffer so
// convertProjectToVercelFiles operates on genuine, valid zip bytes.
function buildRealZipBuffer(entries: Record<string, string>): Buffer {
  const zip = new RealAdmZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content))
  }
  return zip.toBuffer()
}

function selectChain(rows: any[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  }
}

function insertChain(row: any) {
  return {
    values: () => ({
      returning: () => Promise.resolve([row]),
    }),
  }
}

function updateChain() {
  return {
    set: () => ({
      where: () => Promise.resolve(undefined),
    }),
  }
}

describe('deployToVercel', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    vi.clearAllMocks()
    exportProjectMock.mockResolvedValue(
      buildRealZipBuffer({ 'package.json': '{}' })
    )
    dbMock.insert.mockReturnValue(insertChain({ id: 'deploy-1' }))
    dbMock.update.mockReturnValue(updateChain())
  })

  it('throws when no API token is available', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue(null)
    const { deployToVercel } = await import('@/lib/services/deployment/vercel.service')

    await expect(
      deployToVercel({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Vercel API token not found')
  })

  it('throws when the generation does not exist', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token-abc')
    dbMock.select.mockReturnValue(selectChain([]))
    const { deployToVercel } = await import('@/lib/services/deployment/vercel.service')

    await expect(
      deployToVercel({ generationId: 'missing', userId: 'user-1' })
    ).rejects.toThrow('Generation not found')
  })

  it('throws when the generation belongs to a different user', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token-abc')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'someone-else' }]))
    const { deployToVercel } = await import('@/lib/services/deployment/vercel.service')

    await expect(
      deployToVercel({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Unauthorized access to generation')
  })

  it('deploys successfully and records the deployment with a ready status', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token-abc')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'vercel-dep-1',
        url: 'my-app.vercel.app',
        name: 'my-app',
        readyState: 'READY',
      }),
    }) as any

    const { deployToVercel } = await import('@/lib/services/deployment/vercel.service')
    const result = await deployToVercel({ generationId: 'gen-1', userId: 'user-1' })

    expect(result).toBe('deploy-1')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v13/deployments'),
      expect.objectContaining({ method: 'POST' })
    )
    const [, options] = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.files).toEqual([{ file: 'package.json', data: '{}' }])
  })

  it('includes the teamId query parameter when provided', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token-abc')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'd1', url: 'app.vercel.app', name: 'app', readyState: 'BUILDING' }),
    }) as any

    const { deployToVercel } = await import('@/lib/services/deployment/vercel.service')
    await deployToVercel({ generationId: 'gen-1', userId: 'user-1', teamId: 'team-99' })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('teamId=team-99'),
      expect.any(Object)
    )
  })

  it('marks the deployment record as errored and rethrows when the Vercel API fails', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token-abc')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    }) as any

    const { deployToVercel } = await import('@/lib/services/deployment/vercel.service')

    await expect(
      deployToVercel({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Vercel API error (500)')
  })
})

describe('getVercelDeploymentStatus', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns status and a normalized https URL on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ readyState: 'READY', url: 'app.vercel.app' }),
    }) as any

    const { getVercelDeploymentStatus } = await import('@/lib/services/deployment/vercel.service')
    const result = await getVercelDeploymentStatus('dep-1', 'token')

    expect(result).toEqual({ status: 'READY', url: 'https://app.vercel.app' })
  })

  it('returns undefined url when Vercel omits it', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ readyState: 'QUEUED' }),
    }) as any

    const { getVercelDeploymentStatus } = await import('@/lib/services/deployment/vercel.service')
    const result = await getVercelDeploymentStatus('dep-1', 'token')

    expect(result.url).toBeUndefined()
  })

  it('throws when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any
    const { getVercelDeploymentStatus } = await import('@/lib/services/deployment/vercel.service')

    await expect(getVercelDeploymentStatus('dep-1', 'token')).rejects.toThrow(
      'Failed to get Vercel deployment status: 404'
    )
  })
})

describe('cancelVercelDeployment', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves without error on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any
    const { cancelVercelDeployment } = await import('@/lib/services/deployment/vercel.service')

    await expect(cancelVercelDeployment('dep-1', 'token')).resolves.toBeUndefined()
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/cancel'),
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('throws when the cancel request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as any
    const { cancelVercelDeployment } = await import('@/lib/services/deployment/vercel.service')

    await expect(cancelVercelDeployment('dep-1', 'token')).rejects.toThrow(
      'Failed to cancel Vercel deployment: 400'
    )
  })
})
