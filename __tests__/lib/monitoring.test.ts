import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// monitoring.ts (// @ts-nocheck) imports:
//   - `db` (default export) from './db/connection'
//   - { error_logs, generations } from './db/schema'
//   - { eq, sql, and, gte } from 'drizzle-orm'
//   - { logger } from './logger'
//
// db calls are fully mocked (a fluent chain whose terminal method per call
// site resolves/rejects a controlled value), so schema column objects and
// drizzle-orm's operators are never actually evaluated for real SQL — they
// just need to not throw when invoked as plain functions / tagged templates.
const { dbMock, logger } = vi.hoisted(() => {
  // Each chain method returns `this` so calls can be composed in any order
  // the source uses; `__result` holds whatever the chain should resolve to
  // for the NEXT awaited call, set per-test via dbMock.__setNextResult().
  let nextResult: any = []
  let nextRejection: any = null

  const chain: any = {}
  const chainMethods = [
    'insert', 'values', 'select', 'from', 'where', 'groupBy', 'orderBy', 'limit',
  ]
  for (const m of chainMethods) {
    chain[m] = vi.fn(() => chain)
  }
  // Make the chain itself thenable so `await db.select(...).from(...)....` resolves.
  chain.then = (onFulfilled: any, onRejected: any) => {
    if (nextRejection) {
      const err = nextRejection
      nextRejection = null
      return Promise.reject(err).then(onFulfilled, onRejected)
    }
    const value = nextResult
    return Promise.resolve(value).then(onFulfilled, onRejected)
  }
  chain.catch = (onRejected: any) => chain.then(undefined, onRejected)

  const execute = vi.fn().mockResolvedValue(undefined)

  const dbObj: any = {
    insert: vi.fn(() => chain),
    select: vi.fn(() => chain),
    execute,
  }
  dbObj.__chain = chain
  dbObj.__setNextResult = (value: any) => {
    nextResult = value
  }
  dbObj.__setNextRejection = (err: any) => {
    nextRejection = err
  }

  const loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }

  return { dbMock: dbObj, logger: loggerMock }
})

vi.mock('@/lib/db/connection', () => ({ default: dbMock, db: dbMock }))
vi.mock('@/lib/db/schema', () => ({
  error_logs: {
    error_type: 'error_logs.error_type',
    endpoint: 'error_logs.endpoint',
    timestamp: 'error_logs.timestamp',
    level: 'error_logs.level',
    id: 'error_logs.id',
    message: 'error_logs.message',
  },
  generations: {
    model: 'generations.model',
    created_at: 'generations.created_at',
    generation_time_ms: 'generations.generation_time_ms',
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => ({ __op: 'eq', args })),
  sql: vi.fn((...args: any[]) => ({ __op: 'sql', args })),
  and: vi.fn((...args: any[]) => ({ __op: 'and', args })),
  gte: vi.fn((...args: any[]) => ({ __op: 'gte', args })),
}))
vi.mock('@/lib/logger', () => ({ logger }))

import { MonitoringService, monitoring } from '@/lib/monitoring'
import { eq } from 'drizzle-orm'

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.__setNextResult([])
  dbMock.__setNextRejection(null)
  dbMock.execute.mockReset()
  dbMock.execute.mockResolvedValue(undefined)
  // clearAllMocks() resets call history but NOT custom implementations set via
  // mockImplementation — reset select/insert back to their default (return the
  // shared chain) so a per-test override (e.g. getErrorMetrics' queue-popping
  // implementation) never leaks into a later test.
  dbMock.select.mockReset()
  dbMock.select.mockImplementation(() => dbMock.__chain)
  dbMock.insert.mockReset()
  dbMock.insert.mockImplementation(() => dbMock.__chain)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('lib/monitoring', () => {
  describe('singleton export', () => {
    it('exports a usable MonitoringService singleton', () => {
      expect(monitoring).toBeInstanceOf(MonitoringService)
    })
  })

  describe('trackTokenUsage', () => {
    it('inserts a generation row and logs info on success', async () => {
      const svc = new MonitoringService()
      await svc.trackTokenUsage({
        chatId: 'chat-1',
        userId: 'user-1',
        prompt: 'p',
        generatedCode: 'code',
        model: 'claude',
        generationTimeMs: 123,
      })

      expect(dbMock.insert).toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith(
        'Token usage tracked',
        expect.objectContaining({ chatId: 'chat-1', userId: 'user-1', model: 'claude' })
      )
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('swallows the error and logs it when the insert rejects', async () => {
      dbMock.__setNextRejection(new Error('insert failed'))
      const svc = new MonitoringService()

      await expect(
        svc.trackTokenUsage({
          chatId: 'chat-1',
          userId: 'user-1',
          prompt: 'p',
          generatedCode: 'code',
          model: 'claude',
          generationTimeMs: 123,
        })
      ).resolves.toBeUndefined()

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to track token usage',
        expect.any(Error),
        expect.objectContaining({ chatId: 'chat-1', userId: 'user-1' })
      )
    })
  })

  describe('getTokenUsageMetrics', () => {
    it('maps results to TokenUsageMetrics shape with hardcoded-zero token fields', async () => {
      dbMock.__setNextResult([
        { model: 'claude', count: 5, avgGenerationTime: 200 },
        { model: 'gpt', count: 3, avgGenerationTime: 150 },
      ])
      const svc = new MonitoringService()

      const result = await svc.getTokenUsageMetrics(new Date('2024-01-01'), new Date('2024-01-02'))

      expect(result).toEqual([
        {
          model: 'claude',
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          requestCount: 5,
          averageTokensPerRequest: 0,
        },
        {
          model: 'gpt',
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          requestCount: 3,
          averageTokensPerRequest: 0,
        },
      ])
    })

    it('adds an eq(generations.model, model) condition when model is provided', async () => {
      dbMock.__setNextResult([])
      const svc = new MonitoringService()

      await svc.getTokenUsageMetrics(new Date('2024-01-01'), new Date('2024-01-02'), 'claude')

      expect(eq).toHaveBeenCalledWith('generations.model', 'claude')
    })

    it('does not call eq when model is omitted', async () => {
      dbMock.__setNextResult([])
      const svc = new MonitoringService()

      await svc.getTokenUsageMetrics(new Date('2024-01-01'), new Date('2024-01-02'))

      expect(eq).not.toHaveBeenCalled()
    })

    it('returns [] and logs an error when the db call rejects', async () => {
      dbMock.__setNextRejection(new Error('db down'))
      const svc = new MonitoringService()

      const result = await svc.getTokenUsageMetrics(new Date('2024-01-01'), new Date('2024-01-02'))

      expect(result).toEqual([])
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to get token usage metrics',
        expect.any(Error),
        expect.any(Object)
      )
    })
  })

  describe('getGenerationMetrics', () => {
    it('maps a single-row result to the GenerationMetrics shape', async () => {
      dbMock.__setNextResult([
        { count: 10, avgTime: 500, minTime: 100, maxTime: 900, p50: 400, p95: 800, p99: 890 },
      ])
      const svc = new MonitoringService()

      const result = await svc.getGenerationMetrics(new Date('2024-01-01'), new Date('2024-01-02'))

      expect(result).toEqual({
        totalGenerations: 10,
        averageGenerationTime: 500,
        minGenerationTime: 100,
        maxGenerationTime: 900,
        p50GenerationTime: 400,
        p95GenerationTime: 800,
        p99GenerationTime: 890,
      })
    })

    it('falls back to all zeros when the results array is empty', async () => {
      dbMock.__setNextResult([])
      const svc = new MonitoringService()

      const result = await svc.getGenerationMetrics(new Date('2024-01-01'), new Date('2024-01-02'))

      expect(result).toEqual({
        totalGenerations: 0,
        averageGenerationTime: 0,
        minGenerationTime: 0,
        maxGenerationTime: 0,
        p50GenerationTime: 0,
        p95GenerationTime: 0,
        p99GenerationTime: 0,
      })
    })

    it('returns the same all-zero shape and logs an error on rejection', async () => {
      dbMock.__setNextRejection(new Error('db down'))
      const svc = new MonitoringService()

      const result = await svc.getGenerationMetrics(new Date('2024-01-01'), new Date('2024-01-02'))

      expect(result).toEqual({
        totalGenerations: 0,
        averageGenerationTime: 0,
        minGenerationTime: 0,
        maxGenerationTime: 0,
        p50GenerationTime: 0,
        p95GenerationTime: 0,
        p99GenerationTime: 0,
      })
      expect(logger.error).toHaveBeenCalledWith('Failed to get generation metrics', expect.any(Error), expect.any(Object))
    })
  })

  describe('getErrorMetrics', () => {
    it('reduces errorsByType/errorsByEndpoint, maps recentErrors, and reads totalErrors — using sequential results per sub-query', async () => {
      const svc = new MonitoringService()

      // getErrorMetrics awaits four separate queries in sequence: errorsByType,
      // errorsByEndpoint, recentErrors, totalResult. Our shared single-slot
      // chain resolves whatever __setNextResult holds at the time it's awaited,
      // so queue each value just before the call that consumes it by overriding
      // dbMock.select to pop from a queue.
      const resultsQueue = [
        // errorsByType
        [
          { errorType: 'TypeError', count: 4 },
          { errorType: null, count: 1 }, // excluded by the `if (errorType)` guard
        ],
        // errorsByEndpoint
        [
          { endpoint: '/api/a', count: 2 },
          { endpoint: null, count: 1 }, // excluded by the `if (endpoint)` guard
        ],
        // recentErrors
        [
          { id: '1', timestamp: new Date('2024-01-01'), level: 'error', message: 'm1', errorType: 'TypeError', endpoint: '/api/a' },
          { id: '2', timestamp: new Date('2024-01-02'), level: 'error', message: 'm2', errorType: null, endpoint: null },
        ],
        // totalResult
        [{ count: 5 }],
      ]

      let call = 0
      dbMock.select.mockImplementation(() => {
        dbMock.__setNextResult(resultsQueue[call])
        call++
        return dbMock.__chain
      })

      const result = await svc.getErrorMetrics()

      expect(result.errorsByType).toEqual({ TypeError: 4 })
      expect(result.errorsByEndpoint).toEqual({ '/api/a': 2 })
      expect(result.totalErrors).toBe(5)
      expect(result.recentErrors).toEqual([
        { id: '1', timestamp: new Date('2024-01-01'), level: 'error', message: 'm1', errorType: 'TypeError', endpoint: '/api/a' },
        { id: '2', timestamp: new Date('2024-01-02'), level: 'error', message: 'm2', errorType: 'Unknown', endpoint: null },
      ])
    })

    it('passes the default limit of 50 to .limit() when none is provided, and a custom value when given', async () => {
      const svc = new MonitoringService()
      dbMock.__setNextResult([])

      await svc.getErrorMetrics()
      expect(dbMock.__chain.limit).toHaveBeenLastCalledWith(50)

      await svc.getErrorMetrics(10)
      expect(dbMock.__chain.limit).toHaveBeenLastCalledWith(10)
    })

    it('falls back to 0 for totalErrors when totalResult is empty', async () => {
      const svc = new MonitoringService()
      dbMock.__setNextResult([])

      const result = await svc.getErrorMetrics()

      expect(result.totalErrors).toBe(0)
    })

    it('returns the fully-empty default shape and logs an error if any awaited call rejects', async () => {
      dbMock.__setNextRejection(new Error('db down'))
      const svc = new MonitoringService()

      const result = await svc.getErrorMetrics()

      expect(result).toEqual({
        totalErrors: 0,
        errorsByType: {},
        errorsByEndpoint: {},
        recentErrors: [],
      })
      expect(logger.error).toHaveBeenCalledWith('Failed to get error metrics', expect.any(Error))
    })
  })

  describe('checkSystemHealth', () => {
    it('reports healthy status with error counts under all thresholds', async () => {
      const svc = new MonitoringService()
      dbMock.execute.mockResolvedValueOnce(undefined)
      dbMock.__setNextResult([
        { count: 1, timeWindow: '5min' },
        { count: 2, timeWindow: '1hour' },
        { count: 3, timeWindow: '24hour' },
      ])

      const health = await svc.checkSystemHealth()

      expect(health.database.status).toBe('connected')
      expect(health.database.responseTime).toBeGreaterThanOrEqual(0)
      expect(health.errors).toEqual({ last5Minutes: 1, last1Hour: 2, last24Hours: 3 })
      expect(health.status).toBe('healthy')
      expect(typeof health.uptime).toBe('number')
      expect(health.uptime).toBeGreaterThanOrEqual(0)
    })

    it('reports unhealthy when last5Minutes > 10, regardless of the other windows', async () => {
      const svc = new MonitoringService()
      dbMock.execute.mockResolvedValueOnce(undefined)
      dbMock.__setNextResult([{ count: 11, timeWindow: '5min' }])

      const health = await svc.checkSystemHealth()
      expect(health.status).toBe('unhealthy')
    })

    it('reports degraded when last1Hour > 50 (and last5Minutes is within bounds)', async () => {
      const svc = new MonitoringService()
      dbMock.execute.mockResolvedValueOnce(undefined)
      dbMock.__setNextResult([
        { count: 1, timeWindow: '5min' },
        { count: 51, timeWindow: '1hour' },
      ])

      const health = await svc.checkSystemHealth()
      expect(health.status).toBe('degraded')
    })

    it('reports degraded when last24Hours > 200 (and the other windows are within bounds)', async () => {
      const svc = new MonitoringService()
      dbMock.execute.mockResolvedValueOnce(undefined)
      dbMock.__setNextResult([
        { count: 1, timeWindow: '5min' },
        { count: 2, timeWindow: '1hour' },
        { count: 201, timeWindow: '24hour' },
      ])

      const health = await svc.checkSystemHealth()
      expect(health.status).toBe('degraded')
    })

    it('marks the db disconnected and forces unhealthy when db.execute rejects, but still runs the error-count query and returns normally', async () => {
      const svc = new MonitoringService()
      dbMock.execute.mockRejectedValueOnce(new Error('db unreachable'))
      dbMock.__setNextResult([{ count: 1, timeWindow: '5min' }])

      const health = await svc.checkSystemHealth()

      expect(health.database.status).toBe('disconnected')
      expect(health.status).toBe('unhealthy')
      expect(logger.error).toHaveBeenCalledWith('Database health check failed', expect.any(Error))
      // the error-count query still ran and populated errors
      expect(health.errors.last5Minutes).toBe(1)
    })

    it('leaves error fields at zero and still returns normally when the error-count query also rejects', async () => {
      const svc = new MonitoringService()
      dbMock.execute.mockResolvedValueOnce(undefined)
      dbMock.__setNextRejection(new Error('count query failed'))

      const health = await svc.checkSystemHealth()

      expect(health.database.status).toBe('connected')
      expect(health.errors).toEqual({ last5Minutes: 0, last1Hour: 0, last24Hours: 0 })
      expect(logger.error).toHaveBeenCalledWith('Error count check failed', expect.any(Error))
    })

    it('computes a deterministic uptime using a freshly-constructed instance under fake timers', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
      const svc = new MonitoringService()

      vi.setSystemTime(new Date('2024-01-01T00:00:05.000Z')) // +5s
      dbMock.execute.mockResolvedValueOnce(undefined)
      dbMock.__setNextResult([])

      const health = await svc.checkSystemHealth()
      expect(health.uptime).toBe(5)
    })
  })

  describe('logPerformanceMetric', () => {
    it('logs via logger.warn for durations > 1000ms', () => {
      const svc = new MonitoringService()
      svc.logPerformanceMetric('op-a', 1001, { extra: 'field' })

      expect(logger.warn).toHaveBeenCalledWith(
        'Slow operation: op-a',
        expect.objectContaining({ operation: 'op-a', durationMs: 1001, extra: 'field' })
      )
      expect(logger.info).not.toHaveBeenCalled()
    })

    it('logs via logger.info for durations <= 1000ms, including the exact boundary of 1000', () => {
      const svc = new MonitoringService()
      svc.logPerformanceMetric('op-b', 1000, { extra: 'field' })

      expect(logger.info).toHaveBeenCalledWith(
        'Performance: op-b',
        expect.objectContaining({ operation: 'op-b', durationMs: 1000, extra: 'field' })
      )
      expect(logger.warn).not.toHaveBeenCalled()
    })
  })

  describe('startTimer', () => {
    it('returns a stop function that logs and returns the elapsed duration', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))

      const svc = new MonitoringService()
      const stop = svc.startTimer('timed-op')

      vi.setSystemTime(new Date('2024-01-01T00:00:01.500Z')) // +1500ms
      const duration = stop()

      expect(duration).toBe(1500)
      expect(logger.warn).toHaveBeenCalledWith(
        'Slow operation: timed-op',
        expect.objectContaining({ operation: 'timed-op', durationMs: 1500 })
      )
    })
  })
})
