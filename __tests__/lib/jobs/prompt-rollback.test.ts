import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// prompt-rollback.ts calls db.select(...).from(...).where(...) multiple
// times per run (active prompts, generations+feedback join, previous
// prompts). Each call needs its own queued resolved value since they all
// share the same mocked `db.select` chain — a FIFO queue lets each
// `await db.select()...` in source order consume the next queued result.
const { db, chain, enqueueSelect, resetSelectQueue } = vi.hoisted(() => {
  const queue: any[] = []
  const chainObj: any = {}
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'leftJoin']
  for (const m of methods) chainObj[m] = vi.fn(() => chainObj)
  chainObj.then = (onFulfilled: any, onRejected: any) => {
    const next = queue.length > 0 ? queue.shift() : []
    if (next && next.__reject) {
      return Promise.reject(next.error).then(onFulfilled, onRejected)
    }
    return Promise.resolve(next).then(onFulfilled, onRejected)
  }
  chainObj.catch = (onRejected: any) => Promise.resolve().then(undefined, onRejected)

  const dbObj: any = {
    select: vi.fn(() => chainObj),
  }

  return {
    db: dbObj,
    chain: chainObj,
    enqueueSelect: (value: any) => queue.push(value),
    resetSelectQueue: () => queue.splice(0, queue.length),
  }
})

vi.mock('@/lib/db/connection', () => ({
  default: db,
  db,
}))

vi.mock('@/lib/db/schema', () => ({
  prompt_versions: { id: 'id', is_active: 'is_active', type: 'type', version: 'version', created_at: 'created_at' },
  generations: { id: 'id', prompt_version_id: 'prompt_version_id', created_at: 'created_at' },
  feedback: { rating: 'rating', generation_id: 'generation_id' },
}))

const deactivatePrompt = vi.fn(async () => {})
const activatePrompt = vi.fn(async () => {})
vi.mock('@/lib/services/prompt.service', () => ({
  deactivatePrompt,
  activatePrompt,
}))

describe('checkAndRollbackPrompt', () => {
  const origWebhook = process.env.SLACK_WEBHOOK_URL
  const origAlertWebhook = process.env.ALERT_WEBHOOK_URL

  beforeEach(() => {
    vi.clearAllMocks()
    resetSelectQueue()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' }) as unknown as Response))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (origWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL
    else process.env.SLACK_WEBHOOK_URL = origWebhook
    if (origAlertWebhook === undefined) delete process.env.ALERT_WEBHOOK_URL
    else process.env.ALERT_WEBHOOK_URL = origAlertWebhook
  })

  it('returns rolledBack:false when there are no active prompts', async () => {
    enqueueSelect([]) // active prompts query
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    expect(result).toEqual({ rolledBack: false, reason: 'No active prompts found' })
  })

  it('skips prompts that have been active 6+ hours (no further queries issued)', async () => {
    const oldPrompt = {
      id: 'p1',
      version: 'v1',
      type: 'system',
      is_active: true,
      created_at: new Date(Date.now() - 7 * 60 * 60 * 1000),
    }
    enqueueSelect([oldPrompt])
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    expect(result).toEqual({ rolledBack: false, reason: 'All prompts performing well' })
  })

  it('skips a prompt with fewer than 50 rated samples', async () => {
    const freshPrompt = {
      id: 'p1',
      version: 'v1',
      type: 'system',
      is_active: true,
      created_at: new Date(),
    }
    enqueueSelect([freshPrompt]) // active prompts
    enqueueSelect(
      Array.from({ length: 10 }, (_, i) => ({ generationId: `g${i}`, rating: 5 })),
    ) // generations+feedback (only 10 rated, need 50)
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    expect(result).toEqual({ rolledBack: false, reason: 'All prompts performing well' })
    expect(deactivatePrompt).not.toHaveBeenCalled()
  })

  it('does not roll back when avg rating is >= 3.5 even with 50+ samples', async () => {
    const freshPrompt = {
      id: 'p1', version: 'v1', type: 'system', is_active: true, created_at: new Date(),
    }
    enqueueSelect([freshPrompt])
    enqueueSelect(
      Array.from({ length: 60 }, (_, i) => ({ generationId: `g${i}`, rating: 4 })),
    )
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    expect(result).toEqual({ rolledBack: false, reason: 'All prompts performing well' })
  })

  it('filters out generations with null feedback before computing the average', async () => {
    const freshPrompt = {
      id: 'p1', version: 'v1', type: 'system', is_active: true, created_at: new Date(),
    }
    enqueueSelect([freshPrompt])
    const rated = Array.from({ length: 55 }, (_, i) => ({ generationId: `g${i}`, rating: 5 }))
    const unrated = Array.from({ length: 20 }, (_, i) => ({ generationId: `u${i}`, rating: null }))
    enqueueSelect([...rated, ...unrated])
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    // avg of the 55 rated (all rating=5) is 5, well above 3.5 -> no rollback
    expect(result.rolledBack).toBe(false)
  })

  it('rolls back when avg rating < 3.5, a previous prompt exists, and sends a Slack alert', async () => {
    const underperforming = {
      id: 'p1', version: 'v2', type: 'system', is_active: true, created_at: new Date(),
    }
    const previous = {
      id: 'p0', version: 'v1', type: 'system', is_active: false, created_at: new Date(Date.now() - 100000),
    }
    enqueueSelect([underperforming]) // active prompts
    enqueueSelect(
      Array.from({ length: 50 }, (_, i) => ({ generationId: `g${i}`, rating: 2 })),
    ) // generations+feedback, avg=2 < 3.5
    enqueueSelect([previous]) // previous prompt lookup

    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()

    expect(deactivatePrompt).toHaveBeenCalledWith('p1')
    expect(activatePrompt).toHaveBeenCalledWith('p0')
    expect(result.rolledBack).toBe(true)
    expect(result.currentPromptId).toBe('p1')
    expect(result.previousPromptId).toBe('p0')
    expect(result.metrics?.avgRating).toBe(2)
    expect(result.metrics?.sampleSize).toBe(50)
    expect(fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('continues to the next active prompt when no previous prompt exists to roll back to', async () => {
    const underperforming = {
      id: 'p1', version: 'v2', type: 'system', is_active: true, created_at: new Date(),
    }
    enqueueSelect([underperforming]) // active prompts
    enqueueSelect(
      Array.from({ length: 50 }, (_, i) => ({ generationId: `g${i}`, rating: 1 })),
    ) // generations+feedback, avg=1 < 3.5
    enqueueSelect([]) // no previous prompt found

    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()

    expect(deactivatePrompt).not.toHaveBeenCalled()
    expect(result).toEqual({ rolledBack: false, reason: 'All prompts performing well' })
  })

  it('does not call fetch (and warns) when no webhook URL is configured', async () => {
    delete process.env.SLACK_WEBHOOK_URL
    delete process.env.ALERT_WEBHOOK_URL
    const underperforming = {
      id: 'p1', version: 'v2', type: 'system', is_active: true, created_at: new Date(),
    }
    const previous = { id: 'p0', version: 'v1', type: 'system', is_active: false, created_at: new Date() }
    enqueueSelect([underperforming])
    enqueueSelect(Array.from({ length: 50 }, (_, i) => ({ generationId: `g${i}`, rating: 1 })))
    enqueueSelect([previous])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()

    expect(result.rolledBack).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('No webhook URL configured for rollback alerts')
    warnSpy.mockRestore()
  })

  it('logs (does not throw) when the Slack webhook responds with a non-ok status', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'bad request' }) as unknown as Response))
    const underperforming = { id: 'p1', version: 'v2', type: 'system', is_active: true, created_at: new Date() }
    const previous = { id: 'p0', version: 'v1', type: 'system', is_active: false, created_at: new Date() }
    enqueueSelect([underperforming])
    enqueueSelect(Array.from({ length: 50 }, (_, i) => ({ generationId: `g${i}`, rating: 1 })))
    enqueueSelect([previous])

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    expect(result.rolledBack).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith('Failed to send rollback alert:', 'bad request')
    errorSpy.mockRestore()
  })

  it('logs (does not throw) when fetch itself rejects', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const underperforming = { id: 'p1', version: 'v2', type: 'system', is_active: true, created_at: new Date() }
    const previous = { id: 'p0', version: 'v1', type: 'system', is_active: false, created_at: new Date() }
    enqueueSelect([underperforming])
    enqueueSelect(Array.from({ length: 50 }, (_, i) => ({ generationId: `g${i}`, rating: 1 })))
    enqueueSelect([previous])

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    expect(result.rolledBack).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith('Error sending rollback alert:', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('catches query errors and returns rolledBack:false with the error reason', async () => {
    db.select = vi.fn(() => {
      throw new Error('db exploded')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    expect(result.rolledBack).toBe(false)
    expect(result.reason).toContain('db exploded')
    errorSpy.mockRestore()
  })
})

describe('checkAndRollbackPrompt — database not configured', () => {
  it('returns rolledBack:false immediately when db is null, without querying', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/connection', () => ({ default: null, db: null }))
    vi.doMock('@/lib/db/schema', () => ({
      prompt_versions: {}, generations: {}, feedback: {},
    }))
    vi.doMock('@/lib/services/prompt.service', () => ({
      deactivatePrompt: vi.fn(), activatePrompt: vi.fn(),
    }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { checkAndRollbackPrompt } = await import('@/lib/jobs/prompt-rollback')
    const result = await checkAndRollbackPrompt()
    expect(result).toEqual({ rolledBack: false, reason: 'Database not available' })
    expect(warnSpy).toHaveBeenCalledWith('Database not available for prompt rollback check')
    warnSpy.mockRestore()
    vi.doUnmock('@/lib/db/connection')
    vi.doUnmock('@/lib/db/schema')
    vi.doUnmock('@/lib/services/prompt.service')
  })
})
