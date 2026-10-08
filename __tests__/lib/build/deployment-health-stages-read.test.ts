import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1015 — reading back real stage telemetry, not just writing it.
 *
 * `reportDeploymentHealthStage()` has only ever POSTed. Detecting the "Flo"
 * class of stuck company (generate+register ok, ready_check/git_commit never
 * fired because the founder's browser died before Preview.tsx's effect ran)
 * requires the GET side of the SAME core endpoint, plus an honest
 * classification of what the returned stage set means.
 *
 * The live shape these tests encode was captured for real against
 * `GET /api/v1/public/deployment-health/builder_app_generation/flo`
 * (2026-10-08): { entity_type, entity_id, stages: [{ stage, status, ... }],
 * total } — Flo really does return exactly two stages, both "ok",
 * `generate` and `register`, with no ready_check and no git_commit.
 *
 * The central safety property: "we could not read the stages" must NEVER be
 * reported as "the stages are confirmed missing" (the same false-confirmed-miss
 * trap resolveAppVerified() had to fix). A read failure means `ok: false`, and
 * a classifier handed an unverified read must refuse to call a company stuck.
 */

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-service-key'
})

import {
  fetchDeploymentHealthStages,
  classifyRegistrationHealth,
  type DeploymentHealthStageRow,
} from '@/lib/build/deployment-health'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

function stage(s: string, status = 'ok', createdAt = '2026-10-07T23:34:54Z'): DeploymentHealthStageRow {
  return { stage: s, status, created_at: createdAt } as DeploymentHealthStageRow
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

describe('fetchDeploymentHealthStages', () => {
  it('GETs the entity-scoped deployment-health endpoint with the service API key', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        entity_type: 'builder_app_generation',
        entity_id: 'flo',
        stages: [stage('generate'), stage('register')],
        total: 2,
      }),
    )

    const res = await fetchDeploymentHealthStages('builder_app_generation', 'flo')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.ainative.studio/api/v1/public/deployment-health/builder_app_generation/flo')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer test-service-key')
    expect(init.headers['X-API-Key']).toBe('test-service-key')
    expect(res.ok).toBe(true)
    expect(res.stages.map((s) => s.stage)).toEqual(['generate', 'register'])
  })

  it('URL-encodes the entity id', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ stages: [], total: 0 }))

    await fetchDeploymentHealthStages('builder_app_generation', 'odd/slug name')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.ainative.studio/api/v1/public/deployment-health/builder_app_generation/odd%2Fslug%20name',
    )
  })

  it('reports ok:false (never an empty success) when the read itself fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const res = await fetchDeploymentHealthStages('builder_app_generation', 'flo')

    expect(res.ok).toBe(false)
    expect(res.stages).toEqual([])
  })

  it('reports ok:false on a non-2xx response rather than treating it as zero stages', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'nope' }, false, 503))

    const res = await fetchDeploymentHealthStages('builder_app_generation', 'flo')

    expect(res.ok).toBe(false)
    expect(res.stages).toEqual([])
  })

  it('no-ops with ok:false and no fetch when the entity id is empty', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    const res = await fetchDeploymentHealthStages('builder_app_generation', '')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
  })

  it('tolerates a malformed body by reporting an empty but unverified read', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ stages: 'not-an-array' }))

    const res = await fetchDeploymentHealthStages('builder_app_generation', 'flo')

    expect(res.ok).toBe(false)
    expect(res.stages).toEqual([])
  })
})

describe('classifyRegistrationHealth', () => {
  it('calls the real live Flo stage set STUCK — generate+register ok, no ready_check/git_commit', () => {
    const d = classifyRegistrationHealth({
      ok: true,
      stages: [stage('generate'), stage('register')],
    })
    expect(d).toBe('stuck')
  })

  it('calls a company that reported ready_check COMPLETE (nothing left to re-drive)', () => {
    const d = classifyRegistrationHealth({
      ok: true,
      stages: [stage('generate'), stage('register'), stage('ready_check'), stage('git_commit')],
    })
    expect(d).toBe('complete')
  })

  it('treats ready_check alone as complete — git_commit is legitimately skipped for an unprovisioned company', () => {
    // register-app only reports git_commit when it actually ATTEMPTED a commit
    // (an existing gitRepoId or zerodbProjectId). A free, unprovisioned company
    // that passed the ready gate is genuinely done, not stuck — re-driving it
    // forever would be a permanently self-retriggering sweep.
    const d = classifyRegistrationHealth({
      ok: true,
      stages: [stage('generate'), stage('register'), stage('ready_check')],
    })
    expect(d).toBe('complete')
  })

  it('leaves a company that was never generated ALONE — this is not the #1015 bug class', () => {
    const d = classifyRegistrationHealth({ ok: true, stages: [] })
    expect(d).toBe('never_generated')
  })

  it('leaves a company with register but NO generate alone — nothing proven generated to re-drive', () => {
    const d = classifyRegistrationHealth({ ok: true, stages: [stage('register')] })
    expect(d).toBe('never_generated')
  })

  it('leaves a company whose generate stage FAILED alone — there is no good code to commit', () => {
    const d = classifyRegistrationHealth({
      ok: true,
      stages: [stage('generate', 'failed')],
    })
    expect(d).toBe('generation_failed')
  })

  it('refuses to call a company stuck when the stage read was NOT verified', () => {
    const d = classifyRegistrationHealth({ ok: false, stages: [] })
    expect(d).toBe('unverifiable')
  })

  it('is honest about a ready_check that genuinely FAILED — already adjudicated, not stuck', () => {
    const d = classifyRegistrationHealth({
      ok: true,
      stages: [stage('generate'), stage('register'), stage('ready_check', 'failed')],
    })
    expect(d).toBe('ready_check_failed')
  })

  it('still classifies stuck when generate is ok but register never fired', () => {
    // register-app runs the ready gate BEFORE registering, so "generate ok,
    // nothing after it" is the same unfinished pipeline — the browser died even
    // earlier. The code is generated; the gate + commit still owe work.
    const d = classifyRegistrationHealth({ ok: true, stages: [stage('generate')] })
    expect(d).toBe('stuck')
  })
})
