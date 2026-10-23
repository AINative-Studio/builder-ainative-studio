import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * alerting.ts's four rule-check functions (checkErrorRate, checkLatency,
 * checkRedisFailures, checkLLMFailures) are private — reachable only through
 * checkAlerts()/handleAlertCheck(). Each rule issues exactly one
 * `await db.select()...` chain, in the fixed order declared in the `alerts`
 * array (error_rate, latency, redis_failure, llm_failures). A FIFO queue lets
 * each test configure what each rule "sees" in the DB, independent of the
 * exact chain shape drizzle builds.
 */
const { db, resetSelectQueue, enqueueSelect } = vi.hoisted(() => {
  const queue: any[] = []
  const chainObj: any = {}
  const methods = ['select', 'from', 'where', 'orderBy', 'limit']
  for (const m of methods) chainObj[m] = vi.fn(() => chainObj)
  chainObj.then = (onFulfilled: any, onRejected: any) => {
    const next = queue.length > 0 ? queue.shift() : []
    if (next && next.__reject) {
      return Promise.reject(next.error).then(onFulfilled, onRejected)
    }
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
  error_logs: {
    id: 'id',
    timestamp: 'timestamp',
    message: 'message',
    error_type: 'error_type',
    endpoint: 'endpoint',
  },
}))

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: loggerMock }))

/** Each rule's query resolves to a `[{ count }]` row shape. */
const countRow = (count: number) => [{ count }]

describe('checkAlerts — rule dispatch and alert thresholds', () => {
  const origWebhook = process.env.SLACK_WEBHOOK_URL

  beforeEach(async () => {
    vi.clearAllMocks()
    resetSelectQueue()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, statusText: 'OK' }) as unknown as Response))
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    const { __resetAlertCooldownsForTests } = await import('@/lib/jobs/alerting')
    __resetAlertCooldownsForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (origWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL
    else process.env.SLACK_WEBHOOK_URL = origWebhook
  })

  it('triggers no alerts when every rule is under threshold', async () => {
    enqueueSelect(countRow(0)) // error rate: 0 <= 50
    enqueueSelect(countRow(0)) // latency: 0 <= 5 timeouts
    enqueueSelect(countRow(0)) // redis: 0 errors
    enqueueSelect([]) // llm failures: fewer than 3 rows
    const { checkAlerts } = await import('@/lib/jobs/alerting')
    await checkAlerts()
    expect(fetch).not.toHaveBeenCalled()
    expect(loggerMock.error).not.toHaveBeenCalledWith('Alert triggered', undefined, expect.anything())
  })

  it('triggers the high_error_rate alert when errors exceed 50 in 5 minutes', async () => {
    enqueueSelect(countRow(51)) // error rate: over threshold
    enqueueSelect(countRow(0)) // latency
    enqueueSelect(countRow(0)) // redis
    enqueueSelect([]) // llm
    const { checkAlerts } = await import('@/lib/jobs/alerting')
    await checkAlerts()
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].title).toContain('HIGH ERROR RATE')
    expect(payload.attachments[0].color).toBe('#ff0000') // critical
    expect(loggerMock.error).toHaveBeenCalledWith('Alert triggered', undefined, expect.objectContaining({
      alert_name: 'high_error_rate',
      severity: 'critical',
    }))
  })

  it('triggers the high_latency (warning) alert on 6+ timeout/slow errors in 1 minute', async () => {
    enqueueSelect(countRow(0)) // error rate
    enqueueSelect(countRow(6)) // latency: over threshold (>5)
    enqueueSelect(countRow(0)) // redis
    enqueueSelect([]) // llm
    const { checkAlerts } = await import('@/lib/jobs/alerting')
    await checkAlerts()
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].title).toContain('HIGH LATENCY')
    expect(payload.attachments[0].color).toBe('#ff9900') // warning
  })

  it('triggers the redis_failure alert on any redis error', async () => {
    enqueueSelect(countRow(0)) // error rate
    enqueueSelect(countRow(0)) // latency
    enqueueSelect(countRow(1)) // redis: any > 0 triggers
    enqueueSelect([]) // llm
    const { checkAlerts } = await import('@/lib/jobs/alerting')
    await checkAlerts()
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].title).toContain('REDIS FAILURE')
  })

  it('triggers the llm_failures alert on 3+ consecutive LLM-related errors', async () => {
    enqueueSelect(countRow(0)) // error rate
    enqueueSelect(countRow(0)) // latency
    enqueueSelect(countRow(0)) // redis
    enqueueSelect([{ id: '1' }, { id: '2' }, { id: '3' }]) // llm: 3 rows -> triggers
    const { checkAlerts } = await import('@/lib/jobs/alerting')
    await checkAlerts()
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].title).toContain('LLM FAILURES')
  })

  it('does not re-alert the same rule within the cooldown window across two checkAlerts() runs', async () => {
    enqueueSelect(countRow(51)) // run 1: error rate triggers
    enqueueSelect(countRow(0))
    enqueueSelect(countRow(0))
    enqueueSelect([])
    const { checkAlerts } = await import('@/lib/jobs/alerting')
    await checkAlerts()
    expect(fetch).toHaveBeenCalledTimes(1)

    enqueueSelect(countRow(99)) // run 2: still over threshold, but cooldown should suppress
    enqueueSelect(countRow(0))
    enqueueSelect(countRow(0))
    enqueueSelect([])
    await checkAlerts()
    expect(fetch).toHaveBeenCalledTimes(1) // unchanged — suppressed by cooldown
  })

  it('continues checking remaining rules when one rule condition throws', async () => {
    enqueueSelect({ __reject: true, error: new Error('error_logs query failed') }) // error rate throws
    enqueueSelect(countRow(0)) // latency
    enqueueSelect(countRow(0)) // redis
    enqueueSelect([{ id: '1' }, { id: '2' }, { id: '3' }]) // llm triggers
    const { checkAlerts } = await import('@/lib/jobs/alerting')
    await checkAlerts()
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to check alert',
      expect.any(Error),
      expect.objectContaining({ alert_name: 'high_error_rate' }),
    )
    // The llm_failures rule still ran and fired despite the earlier failure.
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].title).toContain('LLM FAILURES')
  })
})

describe('shouldSendAlert cooldown helper', () => {
  beforeEach(async () => {
    const { __resetAlertCooldownsForTests } = await import('@/lib/jobs/alerting')
    __resetAlertCooldownsForTests()
  })

  it('allows the first call for a given alert name', async () => {
    const { shouldSendAlert } = await import('@/lib/jobs/alerting')
    expect(shouldSendAlert('test-alert')).toBe(true)
  })

  it('suppresses a second call for the same name within the cooldown window', async () => {
    const { shouldSendAlert } = await import('@/lib/jobs/alerting')
    expect(shouldSendAlert('test-alert')).toBe(true)
    expect(shouldSendAlert('test-alert')).toBe(false)
  })

  it('tracks cooldowns independently per alert name', async () => {
    const { shouldSendAlert } = await import('@/lib/jobs/alerting')
    expect(shouldSendAlert('alert-a')).toBe(true)
    expect(shouldSendAlert('alert-b')).toBe(true)
    expect(shouldSendAlert('alert-a')).toBe(false)
    expect(shouldSendAlert('alert-b')).toBe(false)
  })
})

describe('sendSlackAlert', () => {
  const origWebhook = process.env.SLACK_WEBHOOK_URL

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, statusText: 'OK' }) as unknown as Response))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (origWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL
    else process.env.SLACK_WEBHOOK_URL = origWebhook
  })

  it('skips sending (and warns) when SLACK_WEBHOOK_URL is not configured', async () => {
    delete process.env.SLACK_WEBHOOK_URL
    const { sendSlackAlert } = await import('@/lib/jobs/alerting')
    await sendSlackAlert({
      title: 'Test',
      message: 'test message',
      severity: 'warning',
      timestamp: new Date(),
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'SLACK_WEBHOOK_URL not configured, skipping Slack notification',
    )
  })

  it('serializes metrics into Slack fields when provided', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    const { sendSlackAlert } = await import('@/lib/jobs/alerting')
    await sendSlackAlert({
      title: 'Test with metrics',
      message: 'msg',
      severity: 'critical',
      timestamp: new Date(),
      metrics: { errorCount: 99, endpoint: '/api/chat' },
    })
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].fields).toEqual([
      { title: 'errorCount', value: '99', short: true },
      { title: 'endpoint', value: '/api/chat', short: true },
    ])
  })

  it('sends an empty fields array when no metrics are given', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    const { sendSlackAlert } = await import('@/lib/jobs/alerting')
    await sendSlackAlert({
      title: 'No metrics',
      message: 'msg',
      severity: 'warning',
      timestamp: new Date(),
    })
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].fields).toEqual([])
  })

  it('logs an error (does not throw) when the webhook responds not-ok', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, statusText: 'Internal Server Error' }) as unknown as Response))
    const { sendSlackAlert } = await import('@/lib/jobs/alerting')
    await expect(
      sendSlackAlert({ title: 't', message: 'm', severity: 'warning', timestamp: new Date() }),
    ).resolves.toBeUndefined()
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to send Slack alert',
      expect.any(Error),
      expect.objectContaining({ title: 't' }),
    )
  })

  it('logs an error (does not throw) when fetch itself rejects', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { sendSlackAlert } = await import('@/lib/jobs/alerting')
    await expect(
      sendSlackAlert({ title: 't', message: 'm', severity: 'critical', timestamp: new Date() }),
    ).resolves.toBeUndefined()
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to send Slack alert',
      expect.any(Error),
      expect.objectContaining({ title: 't' }),
    )
  })
})

describe('handleAlertCheck (serverless HTTP entrypoint)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSelectQueue()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, statusText: 'OK' }) as unknown as Response))
    const { __resetAlertCooldownsForTests } = await import('@/lib/jobs/alerting')
    __resetAlertCooldownsForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a 200 Response with success:true when checkAlerts completes', async () => {
    enqueueSelect(countRow(0))
    enqueueSelect(countRow(0))
    enqueueSelect(countRow(0))
    enqueueSelect([])
    const { handleAlertCheck } = await import('@/lib/jobs/alerting')
    const response = await handleAlertCheck()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.timestamp).toBeTruthy()
  })

  it('returns a 500 Response when checkAlerts itself throws uncaught', async () => {
    // checkAlerts wraps each rule's condition() + notification-send in a
    // try/catch that itself calls logger.error('Failed to check alert', ...)
    // on failure — so a rule *condition* throwing is NOT enough to reach
    // handleAlertCheck's catch (it's absorbed per-rule). But the per-rule
    // catch block's own logger.error call is NOT wrapped in another
    // try/catch, so making THAT throw escapes checkAlerts entirely and is
    // what handleAlertCheck's catch is actually there to handle.
    enqueueSelect({ __reject: true, error: new Error('error_logs query failed') }) // error rate throws -> enters catch
    loggerMock.error.mockImplementationOnce(() => {
      throw new Error('logger backend unavailable')
    })
    const { handleAlertCheck } = await import('@/lib/jobs/alerting')
    const response = await handleAlertCheck()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Alert check failed')
    expect(body.message).toBe('logger backend unavailable')
  })
})

describe('startAlertingSystem', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSelectQueue()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, statusText: 'OK' }) as unknown as Response))
    const { __resetAlertCooldownsForTests } = await import('@/lib/jobs/alerting')
    __resetAlertCooldownsForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('runs checkAlerts immediately and again on each interval tick, then stops via the cleanup fn', async () => {
    // Every run needs 4 queued rows (one per rule); queue enough for 3 runs.
    for (let i = 0; i < 3; i++) {
      enqueueSelect(countRow(0))
      enqueueSelect(countRow(0))
      enqueueSelect(countRow(0))
      enqueueSelect([])
    }
    const { startAlertingSystem } = await import('@/lib/jobs/alerting')
    const stop = startAlertingSystem(1000)

    // Immediate run happens synchronously-ish (fire-and-forget async call).
    await vi.advanceTimersByTimeAsync(0)
    expect(loggerMock.info).toHaveBeenCalledWith('Starting alerting system', { interval: '1000ms' })

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    stop()
    expect(loggerMock.info).toHaveBeenCalledWith('Alerting system stopped')

    // After stopping, further timer advances must not trigger more runs.
    vi.clearAllMocks()
    await vi.advanceTimersByTimeAsync(5000)
    expect(db.select).not.toHaveBeenCalled()
  })
})
