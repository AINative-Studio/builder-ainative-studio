import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for the AINative Cloud deployment service (US-070) — a mocked
 * multi-provider orchestration layer (per the file's own header comment)
 * that still exercises real control flow: provider selection with a
 * fallback-to-Railway path, status mapping, and deployment record
 * bookkeeping. I/O boundaries mocked: `@/lib/db`, credentials.service,
 * export.service, and global `fetch`.
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

describe('deployToAINativeCloud', () => {
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

  it('throws when no API key is available', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue(null)
    const { deployToAINativeCloud } = await import('@/lib/services/deployment/ainative-cloud.service')

    await expect(
      deployToAINativeCloud({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('AINative Cloud API key not found')
  })

  it('throws when the generation does not exist', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('key')
    dbMock.select.mockReturnValue(selectChain([]))
    const { deployToAINativeCloud } = await import('@/lib/services/deployment/ainative-cloud.service')

    await expect(
      deployToAINativeCloud({ generationId: 'missing', userId: 'user-1' })
    ).rejects.toThrow('Generation not found')
  })

  it('throws when the generation belongs to a different user', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('key')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'other' }]))
    const { deployToAINativeCloud } = await import('@/lib/services/deployment/ainative-cloud.service')

    await expect(
      deployToAINativeCloud({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Unauthorized access to generation')
  })

  it('selects the provider recommended by the AINative API and deploys to it', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('key')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        provider: 'aws',
        region: 'us-east',
        reason: 'best latency',
        estimatedCost: 3.2,
        estimatedLatency: 50,
      }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'ainative-1',
        deploymentId: 'dep-xyz',
        url: 'https://app.ainative.cloud',
        status: 'ready',
        provider: 'aws',
      }),
    })
    global.fetch = fetchMock as any

    const { deployToAINativeCloud } = await import('@/lib/services/deployment/ainative-cloud.service')
    const result = await deployToAINativeCloud({ generationId: 'gen-1', userId: 'user-1' })

    expect(result).toBe('deploy-1')
    expect(fetchMock.mock.calls[0][0]).toContain('/providers/select')
    expect(fetchMock.mock.calls[1][0]).toContain('/deployments')
    const deployBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(deployBody.provider).toBe('aws')
  })

  it('falls back to Railway as the provider when provider selection fails', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('key')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'down' })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'ainative-1',
        deploymentId: 'dep-xyz',
        url: 'https://app.ainative.cloud',
        status: 'building',
        provider: 'railway',
      }),
    })
    global.fetch = fetchMock as any

    const { deployToAINativeCloud } = await import('@/lib/services/deployment/ainative-cloud.service')
    const result = await deployToAINativeCloud({ generationId: 'gen-1', userId: 'user-1' })

    expect(result).toBe('deploy-1')
    const deployBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(deployBody.provider).toBe('railway')
  })

  it('passes through the requested region and optimizeFor strategy', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('key')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ provider: 'gcp', region: 'eu-west', reason: 'cost', estimatedCost: 1, estimatedLatency: 200 }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'a1', deploymentId: 'd1', url: 'https://x', status: 'queued', provider: 'gcp' }),
    })
    global.fetch = fetchMock as any

    const { deployToAINativeCloud } = await import('@/lib/services/deployment/ainative-cloud.service')
    await deployToAINativeCloud({
      generationId: 'gen-1',
      userId: 'user-1',
      region: 'eu-west',
      optimizeFor: 'cost',
    })

    const selectBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(selectBody.region).toBe('eu-west')
    expect(selectBody.optimizeFor).toBe('cost')
  })

  it('marks the deployment errored and rethrows when the deploy step itself fails', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('key')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ provider: 'railway', region: 'us-east', reason: 'default', estimatedCost: 5, estimatedLatency: 150 }),
    })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'provider unavailable' })
    global.fetch = fetchMock as any

    const { deployToAINativeCloud } = await import('@/lib/services/deployment/ainative-cloud.service')

    await expect(
      deployToAINativeCloud({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('AINative Cloud deployment error (503)')
  })
})

describe('getAINativeDeploymentStatus', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns status, url and provider on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ready', url: 'https://x', provider: 'aws' }),
    }) as any

    const { getAINativeDeploymentStatus } = await import('@/lib/services/deployment/ainative-cloud.service')
    const result = await getAINativeDeploymentStatus('dep-1', 'key')

    expect(result).toEqual({ status: 'ready', url: 'https://x', provider: 'aws' })
  })

  it('throws on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any
    const { getAINativeDeploymentStatus } = await import('@/lib/services/deployment/ainative-cloud.service')

    await expect(getAINativeDeploymentStatus('dep-1', 'key')).rejects.toThrow(
      'Failed to get AINative Cloud deployment status: 404'
    )
  })
})

describe('deleteAINativeDeployment', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any
    const { deleteAINativeDeployment } = await import('@/lib/services/deployment/ainative-cloud.service')

    await expect(deleteAINativeDeployment('dep-1', 'key')).resolves.toBeUndefined()
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/deployments/dep-1'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('throws on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as any
    const { deleteAINativeDeployment } = await import('@/lib/services/deployment/ainative-cloud.service')

    await expect(deleteAINativeDeployment('dep-1', 'key')).rejects.toThrow(
      'Failed to delete AINative Cloud deployment: 400'
    )
  })
})

describe('getDeploymentAnalytics', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns parsed analytics on success', async () => {
    const analytics = { requests: 100, bandwidth: 1024, uptime: 99.9, averageLatency: 42 }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => analytics }) as any

    const { getDeploymentAnalytics } = await import('@/lib/services/deployment/ainative-cloud.service')
    const result = await getDeploymentAnalytics('dep-1', 'key')

    expect(result).toEqual(analytics)
  })

  it('throws on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any
    const { getDeploymentAnalytics } = await import('@/lib/services/deployment/ainative-cloud.service')

    await expect(getDeploymentAnalytics('dep-1', 'key')).rejects.toThrow(
      'Failed to get deployment analytics: 500'
    )
  })
})
