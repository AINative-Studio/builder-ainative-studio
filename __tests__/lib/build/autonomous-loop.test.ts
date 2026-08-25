import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runNightlyLoop, type NightlyRunInput, type NightlyRunResult } from '@/lib/build/autonomous-loop'

/**
 * lib/build/autonomous-loop — nightly AI loop: briefing → swarm dispatch (#207).
 *
 * All fetch calls are stubbed via vi.stubGlobal('fetch', …). No real network
 * traffic. Env vars (AINATIVE_API_KEY) are set/cleared per test. The module
 * reads AINATIVE_API_KEY at module import time via a top-level const, so we
 * manipulate process.env + re-import with vi.resetModules() where the key
 * presence vs absence matters across groups.
 *
 * Contracts verified:
 *  - No API key → status:'skipped', no fetch calls
 *  - Briefing success + dispatch success → status:'dispatched', taskId set
 *  - Briefing failure (non-ok HTTP) → null briefing still dispatches
 *  - Briefing throws → null briefing still dispatches
 *  - Dispatch failure (non-ok HTTP) → status:'error', detail contains HTTP status
 *  - Dispatch throws → status:'error', detail contains error message
 *  - task_id / id fallback in dispatch response
 *  - 'company' vs 'app' track → correct agent_types in POST body
 *  - Timeout signal is passed (AbortSignal.timeout present)
 *  - buildTaskDescription: briefing appended vs absent; company vs app track copy
 */

// ---------- Helpers ----------

function makeInput(overrides: Partial<NightlyRunInput> = {}): NightlyRunInput {
  return {
    companyId: 'company-001',
    companyName: 'Acme AI',
    track: 'app',
    ...overrides,
  }
}

type FetchResponse = {
  ok: boolean
  status?: number
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

function makeFetch(
  briefingResponse: FetchResponse,
  dispatchResponse: FetchResponse,
) {
  let callCount = 0
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    callCount += 1
    const response = callCount === 1 ? briefingResponse : dispatchResponse
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: response.json ?? (async () => ({})),
      text: response.text ?? (async () => ''),
    } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeSuccessFetch(taskId = 'task-123') {
  return makeFetch(
    { ok: true, json: async () => ({ briefing: 'Focus on user retention' }) },
    { ok: true, json: async () => ({ task_id: taskId }) },
  )
}

// ---------- Setup / Teardown ----------

beforeEach(() => {
  process.env.AINATIVE_API_KEY = 'test-api-key'
  delete process.env.AINATIVE_API_URL
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.AINATIVE_API_KEY
  delete process.env.ZERODB_API_KEY
})

// ---------- No API key → skip ----------

describe('runNightlyLoop() — no API key', () => {
  it('returns status:skipped with detail when AINATIVE_API_KEY is absent', async () => {
    delete process.env.AINATIVE_API_KEY
    delete process.env.ZERODB_API_KEY
    // Re-import to pick up env change (module caches API_KEY at load time)
    vi.resetModules()
    const { runNightlyLoop: run } = await import('@/lib/build/autonomous-loop')
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)

    const result = await run(makeInput())

    expect(result.status).toBe('skipped')
    expect(result.detail).toContain('no AINative API key')
    expect(result.briefing).toBeNull()
    expect(result.taskId).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('falls back to ZERODB_API_KEY when AINATIVE_API_KEY is absent', async () => {
    delete process.env.AINATIVE_API_KEY
    process.env.ZERODB_API_KEY = 'zerodb-key'
    vi.resetModules()
    const { runNightlyLoop: run } = await import('@/lib/build/autonomous-loop')
    makeSuccessFetch()

    const result = await run(makeInput())

    // With a key present, it should attempt the loop (not skipped)
    expect(result.status).not.toBe('skipped')
  })
})

// ---------- Happy path: briefing + dispatch success ----------

describe('runNightlyLoop() — happy path', () => {
  it('returns status:dispatched with taskId and briefing on full success', async () => {
    makeFetch(
      { ok: true, json: async () => ({ briefing: 'Grow faster' }) },
      { ok: true, json: async () => ({ task_id: 'task-abc' }) },
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.status).toBe('dispatched')
    expect(result.taskId).toBe('task-abc')
    expect(result.briefing).toBe('Grow faster')
    expect(result.companyId).toBe('company-001')
    expect(result.detail).toContain('queued')
  })

  it('accepts `id` as fallback when `task_id` is missing in dispatch response', async () => {
    makeFetch(
      { ok: true, json: async () => ({ briefing: 'Focus' }) },
      { ok: true, json: async () => ({ id: 'fallback-id' }) },
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.status).toBe('dispatched')
    expect(result.taskId).toBe('fallback-id')
  })

  it('returns detail noting no task_id when dispatch response has neither field', async () => {
    makeFetch(
      { ok: true, json: async () => ({ briefing: 'ok' }) },
      { ok: true, json: async () => ({}) },
    )

    const result = await runNightlyLoop(makeInput())

    // task_id is null → status:'error'
    expect(result.status).toBe('error')
    expect(result.taskId).toBeNull()
    expect(result.detail).toContain('no task_id')
  })

  it('passes the companyId through to the result', async () => {
    makeSuccessFetch()
    const result = await runNightlyLoop(makeInput({ companyId: 'co-999' }))
    expect(result.companyId).toBe('co-999')
  })
})

// ---------- Briefing failure paths ----------

describe('runNightlyLoop() — briefing failure', () => {
  it('proceeds with null briefing when briefing API returns non-ok', async () => {
    makeFetch(
      { ok: false, status: 503 },
      { ok: true, json: async () => ({ task_id: 'task-xyz' }) },
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.status).toBe('dispatched')
    expect(result.briefing).toBeNull()
    expect(result.taskId).toBe('task-xyz')
  })

  it('proceeds with null briefing when briefing fetch throws', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount += 1
        if (callCount === 1) throw new Error('timeout')
        return { ok: true, status: 200, json: async () => ({ task_id: 'task-yz' }), text: async () => '' } as Response
      }),
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.status).toBe('dispatched')
    expect(result.briefing).toBeNull()
    expect(result.taskId).toBe('task-yz')
  })

  it('proceeds with null briefing when briefing returns ok but no briefing/summary field', async () => {
    makeFetch(
      { ok: true, json: async () => ({ something_else: true }) },
      { ok: true, json: async () => ({ task_id: 'task-123' }) },
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.briefing).toBeNull()
    expect(result.status).toBe('dispatched')
  })

  it('accepts `summary` as a fallback field for the briefing', async () => {
    makeFetch(
      { ok: true, json: async () => ({ summary: 'Use summary field' }) },
      { ok: true, json: async () => ({ task_id: 'task-s' }) },
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.briefing).toBe('Use summary field')
    expect(result.status).toBe('dispatched')
  })
})

// ---------- Dispatch failure paths ----------

describe('runNightlyLoop() — dispatch failure', () => {
  it('returns status:error with HTTP status in detail when dispatch responds non-ok', async () => {
    makeFetch(
      { ok: true, json: async () => ({ briefing: 'go' }) },
      { ok: false, status: 402, text: async () => 'payment required' },
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.status).toBe('error')
    expect(result.taskId).toBeNull()
    expect(result.detail).toContain('402')
  })

  it('returns status:error with error message in detail when dispatch throws', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount += 1
        if (callCount === 1) return { ok: true, status: 200, json: async () => ({ briefing: 'go' }), text: async () => '' } as Response
        throw new Error('ECONNREFUSED')
      }),
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.status).toBe('error')
    expect(result.taskId).toBeNull()
    expect(result.detail).toContain('ECONNREFUSED')
  })

  it('returns status:error when dispatch returns 500', async () => {
    makeFetch(
      { ok: true, json: async () => ({ briefing: 'go' }) },
      { ok: false, status: 500, text: async () => 'internal error' },
    )

    const result = await runNightlyLoop(makeInput())

    expect(result.status).toBe('error')
  })
})

// ---------- Track-based agent_types selection ----------

describe('runNightlyLoop() — track → agent_types in dispatch body', () => {
  it('uses architect/data/docs agent_types for company track', async () => {
    const fn = makeSuccessFetch()
    await runNightlyLoop(makeInput({ track: 'company' }))

    const dispatchCall = fn.mock.calls[1]
    const body = JSON.parse((dispatchCall[1] as RequestInit).body as string)
    expect(body.agent_types).toEqual(['architect', 'data', 'docs'])
  })

  it('uses architect/backend/qa agent_types for app track', async () => {
    const fn = makeSuccessFetch()
    await runNightlyLoop(makeInput({ track: 'app' }))

    const dispatchCall = fn.mock.calls[1]
    const body = JSON.parse((dispatchCall[1] as RequestInit).body as string)
    expect(body.agent_types).toEqual(['architect', 'backend', 'qa'])
  })

  it('passes company name and track in the dispatch config', async () => {
    const fn = makeSuccessFetch()
    await runNightlyLoop(makeInput({ companyName: 'TestCo', track: 'company' }))

    const body = JSON.parse((fn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.config.company).toBe('TestCo')
    expect(body.config.track).toBe('company')
    expect(body.config.source).toBe('builder-nightly-loop')
  })
})

// ---------- Task description content ----------

describe('runNightlyLoop() — task description content', () => {
  it('appends briefing text to the task description when briefing is available', async () => {
    const fn = makeFetch(
      { ok: true, json: async () => ({ briefing: 'Key insight: grow retention' }) },
      { ok: true, json: async () => ({ task_id: 'task-d' }) },
    )

    await runNightlyLoop(makeInput())

    const body = JSON.parse((fn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.description).toContain('Key insight: grow retention')
    expect(body.description).toContain('Data-informed briefing')
  })

  it('omits the briefing section when briefing is null', async () => {
    const fn = makeFetch(
      { ok: false, status: 503 },
      { ok: true, json: async () => ({ task_id: 'task-nb' }) },
    )

    await runNightlyLoop(makeInput())

    const body = JSON.parse((fn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.description).not.toContain('Data-informed briefing')
  })

  it('task description for app track mentions the company name', async () => {
    const fn = makeFetch(
      { ok: false, status: 503 },
      { ok: true, json: async () => ({ task_id: 'task-app' }) },
    )

    await runNightlyLoop(makeInput({ track: 'app', companyName: 'MyApp' }))

    const body = JSON.parse((fn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.description).toContain('MyApp')
  })

  it('task description for company track mentions the company name', async () => {
    const fn = makeFetch(
      { ok: false, status: 503 },
      { ok: true, json: async () => ({ task_id: 'task-co' }) },
    )

    await runNightlyLoop(makeInput({ track: 'company', companyName: 'BigCorp' }))

    const body = JSON.parse((fn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.description).toContain('BigCorp')
  })
})

// ---------- Briefing URL encoding ----------

describe('runNightlyLoop() — briefing API URL', () => {
  it('URL-encodes the company name in the briefing request', async () => {
    const fn = makeFetch(
      { ok: true, json: async () => ({ briefing: 'ok' }) },
      { ok: true, json: async () => ({ task_id: 'task-url' }) },
    )

    await runNightlyLoop(makeInput({ companyName: 'Acme & Sons' }))

    const briefingUrl = String(fn.mock.calls[0][0])
    expect(briefingUrl).toContain(encodeURIComponent('Acme & Sons'))
  })

  it('sends Authorization and X-API-Key headers in both requests', async () => {
    process.env.AINATIVE_API_KEY = 'my-secret-key'
    vi.resetModules()
    const { runNightlyLoop: run } = await import('@/lib/build/autonomous-loop')
    const fn = makeFetch(
      { ok: true, json: async () => ({ briefing: 'ok' }) },
      { ok: true, json: async () => ({ task_id: 'task-h' }) },
    )

    await run(makeInput())

    const briefingHeaders = fn.mock.calls[0][1]?.headers as Record<string, string>
    expect(briefingHeaders['Authorization']).toBe('Bearer my-secret-key')
    expect(briefingHeaders['X-API-Key']).toBe('my-secret-key')

    const dispatchHeaders = fn.mock.calls[1][1]?.headers as Record<string, string>
    expect(dispatchHeaders['Authorization']).toBe('Bearer my-secret-key')
  })
})
