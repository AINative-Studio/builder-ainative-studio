import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { db, resetSelectQueue, enqueueSelect } = vi.hoisted(() => {
  const queue: any[] = []
  const chainObj: any = {}
  const methods = ['select', 'from', 'where', 'leftJoin']
  for (const m of methods) chainObj[m] = vi.fn(() => chainObj)
  chainObj.then = (onFulfilled: any, onRejected: any) => {
    const next = queue.length > 0 ? queue.shift() : []
    return Promise.resolve(next).then(onFulfilled, onRejected)
  }

  const dbObj: any = {
    select: vi.fn(() => chainObj),
  }

  return {
    db: dbObj,
    resetSelectQueue: () => queue.splice(0, queue.length),
    enqueueSelect: (value: any) => queue.push(value),
  }
})

vi.mock('@/lib/db/connection', () => ({
  default: db,
  db,
}))

vi.mock('@/lib/db/schema', () => ({
  generations: { id: 'id', created_at: 'created_at' },
  feedback: { rating: 'rating', was_edited: 'was_edited', generation_id: 'generation_id' },
}))

describe('checkQualityDegradation', () => {
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

  it('returns alertTriggered:false when there is no data in the last hour', async () => {
    enqueueSelect([])
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result).toEqual({ alertTriggered: false, reason: 'No data in last hour' })
  })

  it('ignores generations with null feedback when computing sample size', async () => {
    enqueueSelect([
      { generationId: 'g1', rating: null, wasEdited: false },
      { generationId: 'g2', rating: null, wasEdited: false },
    ])
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result).toEqual({ alertTriggered: false, reason: 'No data in last hour' })
  })

  it('does not alert when avg rating >= 3.5 and first-pass success >= 40%', async () => {
    enqueueSelect([
      { generationId: 'g1', rating: 5, wasEdited: false },
      { generationId: 'g2', rating: 4, wasEdited: false },
      { generationId: 'g3', rating: 4, wasEdited: true }, // edited -> not first-pass success
    ])
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result.alertTriggered).toBe(false)
    expect(result.metrics?.sampleSize).toBe(3)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('alerts when avg rating drops below 3.5', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    enqueueSelect([
      { generationId: 'g1', rating: 1, wasEdited: false },
      { generationId: 'g2', rating: 2, wasEdited: false },
    ])
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result.alertTriggered).toBe(true)
    expect(result.reason).toMatch(/Average rating below 3.5/)
    expect(fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('alerts when first-pass success rate drops below 40% even if avg rating is fine', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    // avg rating stays >= 3.5 but only 1/5 are first-pass successes (rating>=4 and !edited)
    enqueueSelect([
      { generationId: 'g1', rating: 4, wasEdited: true },
      { generationId: 'g2', rating: 4, wasEdited: true },
      { generationId: 'g3', rating: 4, wasEdited: true },
      { generationId: 'g4', rating: 4, wasEdited: true },
      { generationId: 'g5', rating: 4, wasEdited: false },
    ])
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result.alertTriggered).toBe(true)
    expect(result.reason).toMatch(/First-pass success rate below 40%/)
  })

  it('does not send a Slack message (but still alerts) when no webhook is configured', async () => {
    delete process.env.SLACK_WEBHOOK_URL
    delete process.env.ALERT_WEBHOOK_URL
    enqueueSelect([
      { generationId: 'g1', rating: 1, wasEdited: false },
    ])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result.alertTriggered).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('No webhook URL configured for quality alerts')
    warnSpy.mockRestore()
  })

  it('logs (does not throw) when the Slack webhook responds with a non-ok status', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'bad request' }) as unknown as Response))
    enqueueSelect([{ generationId: 'g1', rating: 1, wasEdited: false }])
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result.alertTriggered).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith('Failed to send quality alert:', 'bad request')
    errorSpy.mockRestore()
  })

  it('logs (does not throw) when fetch itself rejects', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    enqueueSelect([{ generationId: 'g1', rating: 1, wasEdited: false }])
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result.alertTriggered).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith('Error sending quality alert:', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('catches query errors and returns alertTriggered:false with the error reason', async () => {
    db.select = vi.fn(() => {
      throw new Error('db exploded')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result.alertTriggered).toBe(false)
    expect(result.reason).toContain('db exploded')
    errorSpy.mockRestore()
  })
})

describe('checkQualityDegradation — database not configured', () => {
  it('returns alertTriggered:false immediately when db is null, without querying', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/connection', () => ({ default: null, db: null }))
    vi.doMock('@/lib/db/schema', () => ({ generations: {}, feedback: {} }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { checkQualityDegradation } = await import('@/lib/jobs/quality-alerts')
    const result = await checkQualityDegradation()
    expect(result).toEqual({ alertTriggered: false, reason: 'Database not available' })
    expect(warnSpy).toHaveBeenCalledWith('Database not available for quality check')
    warnSpy.mockRestore()
    vi.doUnmock('@/lib/db/connection')
    vi.doUnmock('@/lib/db/schema')
  })
})
