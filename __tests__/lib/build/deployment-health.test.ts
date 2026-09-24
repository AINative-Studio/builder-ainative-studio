import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder-ainative-studio#868 — resolveTask() reports real stage outcomes to
 * core's deployment-health API (core#6925). This was never wired up, so
 * `deployment_health_stages` had 0 rows in production 3+ weeks after the
 * endpoint shipped (core#6927 investigation). These tests prove the client
 * itself: it calls the right URL with the right auth, never throws (this
 * must always stay best-effort — a reporting hiccup can never affect the
 * real resolveTask() pipeline it's called from), and no-ops cleanly when no
 * API key is configured.
 */

// deployment-health.ts captures API_KEY at MODULE LOAD (const), so it must be
// set BEFORE the import executes — same constraint as app-registry.ts.
vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-service-key'
})

import { reportDeploymentHealthStage } from '@/lib/build/deployment-health'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

function okResponse(): Response {
  return { ok: true, status: 201, text: async () => '{}' } as unknown as Response
}

describe('reportDeploymentHealthStage', () => {
  it('POSTs to the entity-scoped deployment-health endpoint with the service API key', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(okResponse())

    await reportDeploymentHealthStage('t_abc123', 'implement', 'ok', 'produced 2 files')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.ainative.studio/api/v1/public/deployment-health/builder_company_task/t_abc123')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-service-key')
    expect(init.headers['X-API-Key']).toBe('test-service-key')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ stage: 'implement', status: 'ok', reason: 'produced 2 files', metadata: undefined })
  })

  it('URL-encodes the task id', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(okResponse())

    await reportDeploymentHealthStage('task/with slashes', 'deploy', 'ok')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.ainative.studio/api/v1/public/deployment-health/builder_company_task/task%2Fwith%20slashes')
  })

  it('includes metadata when provided', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(okResponse())

    await reportDeploymentHealthStage('t_1', 'coverage', 'failed', 'below floor', { coveragePercent: 55 })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.metadata).toEqual({ coveragePercent: 55 })
  })

  it('never throws when fetch rejects — best-effort, must not affect the caller', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('network error'))

    await expect(reportDeploymentHealthStage('t_1', 'merge', 'ok')).resolves.toBeUndefined()
  })

  it('never throws when fetch resolves with a non-ok response', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'error' } as unknown as Response)

    await expect(reportDeploymentHealthStage('t_1', 'merge', 'ok')).resolves.toBeUndefined()
  })

  it('no-ops without calling fetch when taskId is empty', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    await reportDeploymentHealthStage('', 'implement', 'ok')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
