import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mapDeploymentStatus,
  shapeDeployment,
  markCurrentDeployment,
  sortDeploymentsNewestFirst,
  isRollbackTarget,
  listDeployments,
  redeployDeployment,
  checkDeployHealth,
  type RailwayDeployment,
} from '@/lib/build/railway-deploy'

/**
 * #62 — Railway deployment history + one-click rollback.
 *
 * Cost/safety property under test (mirrors the #243 provisioner tests): the
 * deployment-history read + redeploy mutation NEVER touch Railway unless deploy is
 * explicitly enabled+configured, and the pure join/marking logic is exact. We mock
 * global fetch so no real Railway call is ever made.
 */
function gql(data: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify({ data }) } as unknown as Response
}

function enableRailway() {
  vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
  vi.stubEnv('RAILWAY_TOKEN', 'test-token')
  vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
  vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', 'env-123')
  vi.stubEnv('RAILWAY_COMPANY_SOURCE_IMAGE', 'ghcr.io/ainative/company-runtime:latest')
}

describe('mapDeploymentStatus — normalize Railway status', () => {
  it('maps SUCCESS → success', () => expect(mapDeploymentStatus('SUCCESS')).toBe('success'))
  it('maps FAILED/CRASHED/SKIPPED → failed', () => {
    expect(mapDeploymentStatus('FAILED')).toBe('failed')
    expect(mapDeploymentStatus('CRASHED')).toBe('failed')
    expect(mapDeploymentStatus('SKIPPED')).toBe('failed')
  })
  it('maps REMOVED/REMOVING → removed', () => {
    expect(mapDeploymentStatus('REMOVED')).toBe('removed')
    expect(mapDeploymentStatus('REMOVING')).toBe('removed')
  })
  it('maps building-ish + unknown → building (never a false live)', () => {
    expect(mapDeploymentStatus('BUILDING')).toBe('building')
    expect(mapDeploymentStatus('DEPLOYING')).toBe('building')
    expect(mapDeploymentStatus('QUEUED')).toBe('building')
    expect(mapDeploymentStatus('WHATEVER')).toBe('building')
    expect(mapDeploymentStatus(null)).toBe('building')
    expect(mapDeploymentStatus(undefined)).toBe('building')
  })
})

describe('shapeDeployment — pull id/status/git-meta out of a raw node', () => {
  it('returns null for a node with no id', () => {
    expect(shapeDeployment({})).toBeNull()
    expect(shapeDeployment(null)).toBeNull()
  })
  it('shapes id + status + createdAt', () => {
    const d = shapeDeployment({ id: 'dep-1', status: 'SUCCESS', createdAt: '2026-08-24T01:00:00Z' })
    expect(d).toMatchObject({ id: 'dep-1', status: 'success', rawStatus: 'SUCCESS', createdAt: '2026-08-24T01:00:00Z' })
  })
  it('extracts commit sha + message from meta (truncated sha to 12)', () => {
    const d = shapeDeployment({
      id: 'dep-2',
      status: 'SUCCESS',
      meta: { commitHash: 'abcdef1234567890', commitMessage: 'feat: craft landing page' },
    })
    expect(d?.commitSha).toBe('abcdef123456')
    expect(d?.message).toBe('feat: craft landing page')
  })
  it('handles snake_case + top-level git fields', () => {
    const d = shapeDeployment({ id: 'dep-3', status: 'SUCCESS', commitSha: 'deadbeef', commitMessage: 'chore: seed' })
    expect(d?.commitSha).toBe('deadbeef')
    expect(d?.message).toBe('chore: seed')
  })
})

describe('markCurrentDeployment — the newest SUCCESS is live', () => {
  it('flags the first success as live + current, others not current', () => {
    const list: RailwayDeployment[] = [
      { id: 'a', status: 'building' },
      { id: 'b', status: 'success' },
      { id: 'c', status: 'success' },
    ]
    const marked = markCurrentDeployment(list)
    expect(marked[0]).toMatchObject({ id: 'a', status: 'building', current: false })
    expect(marked[1]).toMatchObject({ id: 'b', status: 'live', current: true })
    expect(marked[2]).toMatchObject({ id: 'c', status: 'success', current: false })
  })
  it('marks none current when there is no successful deploy', () => {
    const marked = markCurrentDeployment([{ id: 'x', status: 'building' }, { id: 'y', status: 'failed' }])
    expect(marked.every((d) => !d.current)).toBe(true)
  })
  it('handles empty input', () => {
    expect(markCurrentDeployment([])).toEqual([])
  })
})

describe('sortDeploymentsNewestFirst', () => {
  it('sorts by createdAt descending; missing timestamps sink', () => {
    const sorted = sortDeploymentsNewestFirst([
      { id: 'old', status: 'success', createdAt: '2026-08-20T00:00:00Z' },
      { id: 'nostamp', status: 'success' },
      { id: 'new', status: 'success', createdAt: '2026-08-24T00:00:00Z' },
    ])
    expect(sorted.map((d) => d.id)).toEqual(['new', 'old', 'nostamp'])
  })
})

describe('isRollbackTarget — only completed, non-current prior deploys', () => {
  it('true for a prior success', () => {
    expect(isRollbackTarget({ id: 'a', status: 'success', current: false })).toBe(true)
  })
  it('false for the current/live deploy', () => {
    expect(isRollbackTarget({ id: 'a', status: 'live', current: true })).toBe(false)
  })
  it('false for failed/removed/building', () => {
    expect(isRollbackTarget({ id: 'a', status: 'failed' })).toBe(false)
    expect(isRollbackTarget({ id: 'a', status: 'removed' })).toBe(false)
    expect(isRollbackTarget({ id: 'a', status: 'building' })).toBe(false)
  })
  it('false for null/no id', () => {
    expect(isRollbackTarget(null)).toBe(false)
    expect(isRollbackTarget({ id: '', status: 'success' } as RailwayDeployment)).toBe(false)
  })
})

describe('listDeployments — cost-safe read', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns { ok:false, reason:disabled } WITHOUT any fetch when disabled', async () => {
    const res = await listDeployments('svc-1')
    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns { ok:false, reason:no_service } when serviceId missing (enabled)', async () => {
    enableRailway()
    const res = await listDeployments('')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('no_service')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lists deployments newest-first with the live one flagged', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      gql({
        deployments: {
          edges: [
            { node: { id: 'new', status: 'SUCCESS', createdAt: '2026-08-24T02:00:00Z', meta: { commitMessage: 'feat: alerts' } } },
            { node: { id: 'old', status: 'SUCCESS', createdAt: '2026-08-20T02:00:00Z', meta: { commitMessage: 'chore: seed' } } },
          ],
        },
      }),
    )
    const res = await listDeployments('svc-1')
    expect(res.ok).toBe(true)
    expect(res.deployments?.map((d) => d.id)).toEqual(['new', 'old'])
    expect(res.deployments?.[0]).toMatchObject({ id: 'new', status: 'live', current: true })
    expect(res.deployments?.[1]).toMatchObject({ id: 'old', status: 'success', current: false })
  })

  it('returns ok with empty list when Railway returns no edges', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gql({ deployments: { edges: [] } }))
    const res = await listDeployments('svc-1')
    expect(res.ok).toBe(true)
    expect(res.deployments).toEqual([])
  })

  it('returns { ok:false, reason } on a transport error (never throws)', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const res = await listDeployments('svc-1')
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('network down')
  })
})

describe('redeployDeployment — cost-safe rollback trigger', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns { ok:false, reason:disabled } WITHOUT any fetch when disabled', async () => {
    const res = await redeployDeployment('dep-1')
    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns { ok:false, reason:no_deployment } when id missing', async () => {
    enableRailway()
    const res = await redeployDeployment('')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('no_deployment')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends deploymentRedeploy and returns the (re)deployment id', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gql({ deploymentRedeploy: { id: 'dep-redeployed', status: 'BUILDING' } }))
    const res = await redeployDeployment('dep-old')
    expect(res.ok).toBe(true)
    expect(res.deploymentId).toBe('dep-redeployed')
    const body = String(fetchMock.mock.calls[0][1]?.body || '')
    expect(body).toContain('deploymentRedeploy')
    expect(body).toContain('dep-old')
  })

  it('returns { ok:false } when Railway returns no id', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gql({ deploymentRedeploy: null }))
    const res = await redeployDeployment('dep-old')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('redeploy_no_id')
  })
})

describe('checkDeployHealth — served-site probe', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('false for a non-http url without any fetch', async () => {
    expect(await checkDeployHealth('not-a-url')).toBe(false)
    expect(await checkDeployHealth('')).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('true for a 200 response', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ status: 200 } as Response)
    expect(await checkDeployHealth('https://acme.up.railway.app')).toBe(true)
  })

  it('true for a 3xx redirect', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ status: 301 } as Response)
    expect(await checkDeployHealth('https://acme.up.railway.app')).toBe(true)
  })

  it('false for a 5xx / and on network error', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ status: 503 } as Response)
    expect(await checkDeployHealth('https://acme.up.railway.app')).toBe(false)
    fetchMock.mockResolvedValueOnce(null)
    expect(await checkDeployHealth('https://acme.up.railway.app')).toBe(false)
  })
})
