import db from './db/connection'
import { error_logs, generations } from './db/schema'
import { eq, sql, and, gte } from 'drizzle-orm'
import { logger } from './logger'

export interface TokenUsageMetrics {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  requestCount: number
  averageTokensPerRequest: number
  model: string
}

export interface GenerationMetrics {
  totalGenerations: number
  averageGenerationTime: number
  minGenerationTime: number
  maxGenerationTime: number
  p50GenerationTime: number
  p95GenerationTime: number
  p99GenerationTime: number
}

export interface ErrorMetrics {
  totalErrors: number
  errorsByType: Record<string, number>
  errorsByEndpoint: Record<string, number>
  recentErrors: Array<{
    id: string
    timestamp: Date
    level: string
    message: string
    errorType: string
    endpoint: string | null
  }>
}

export interface SystemHealthMetrics {
  status: 'healthy' | 'degraded' | 'unhealthy'
  uptime: number
  database: {
    status: 'connected' | 'disconnected'
    responseTime: number
  }
  redis?: {
    status: 'connected' | 'disconnected'
    responseTime: number
  }
  errors: {
    last5Minutes: number
    last1Hour: number
    last24Hours: number
  }
}

export class MonitoringService {
  private startTime: number

  constructor() {
    this.startTime = Date.now()
  }

  /**
   * Track token usage for AI API calls
   */
  async trackTokenUsage(data: {
    chatId: string
    userId: string
    prompt: string
    generatedCode: string
    promptVersionId?: string
    designTokensVersionId?: string
    model: string
    templateUsed?: string
    generationTimeMs: number
    tokenUsage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
  }) {
    try {
      await db.insert(generations).values({
        chat_id: data.chatId,
        user_id: data.userId,
        prompt: data.prompt,
        generated_code: data.generatedCode,
        prompt_version_id: data.promptVersionId || null,
        design_tokens_version_id: data.designTokensVersionId || null,
        model: data.model,
        template_used: data.templateUsed || null,
        generation_time_ms: data.generationTimeMs,
      })

      logger.info('Token usage tracked', {
        chatId: data.chatId,
        userId: data.userId,
        model: data.model,
        generationTimeMs: data.generationTimeMs,
        tokenUsage: data.tokenUsage,
      })
    } catch (error) {
      logger.error('Failed to track token usage', error as Error, {
        chatId: data.chatId,
        userId: data.userId,
      })
    }
  }

  /**
   * Get token usage metrics for a specific time range
   */
  async getTokenUsageMetrics(
    startDate: Date,
    endDate: Date,
    model?: string
  ): Promise<TokenUsageMetrics[]> {
    try {
      const conditions = [
        gte(generations.created_at, startDate),
        sql`${generations.created_at} <= ${endDate}`,
      ]

      if (model) {
        conditions.push(eq(generations.model, model))
      }

      const results = await db
        .select({
          model: generations.model,
          count: sql<number>`count(*)::int`,
          avgGenerationTime: sql<number>`avg(${generations.generation_time_ms})::int`,
        })
        .from(generations)
        .where(and(...conditions))
        .groupBy(generations.model)

      // Note: We don't have token counts in the schema yet, so we'll return placeholder data
      // In production, you'd want to add token_count fields to the generations table
      return results.map((r) => ({
        model: r.model,
        totalTokens: 0, // TODO: Add token tracking to schema
        promptTokens: 0,
        completionTokens: 0,
        requestCount: r.count,
        averageTokensPerRequest: 0,
      }))
    } catch (error) {
      logger.error('Failed to get token usage metrics', error as Error, {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        model,
      })
      return []
    }
  }

  /**
   * Get generation time metrics
   */
  async getGenerationMetrics(
    startDate: Date,
    endDate: Date
  ): Promise<GenerationMetrics> {
    try {
      const results = await db
        .select({
          count: sql<number>`count(*)::int`,
          avgTime: sql<number>`avg(${generations.generation_time_ms})::int`,
          minTime: sql<number>`min(${generations.generation_time_ms})::int`,
          maxTime: sql<number>`max(${generations.generation_time_ms})::int`,
          p50: sql<number>`percentile_cont(0.5) within group (order by ${generations.generation_time_ms})::int`,
          p95: sql<number>`percentile_cont(0.95) within group (order by ${generations.generation_time_ms})::int`,
          p99: sql<number>`percentile_cont(0.99) within group (order by ${generations.generation_time_ms})::int`,
        })
        .from(generations)
        .where(
          and(
            gte(generations.created_at, startDate),
            sql`${generations.created_at} <= ${endDate}`
          )
        )

      const result = results[0]

      return {
        totalGenerations: result?.count || 0,
        averageGenerationTime: result?.avgTime || 0,
        minGenerationTime: result?.minTime || 0,
        maxGenerationTime: result?.maxTime || 0,
        p50GenerationTime: result?.p50 || 0,
        p95GenerationTime: result?.p95 || 0,
        p99GenerationTime: result?.p99 || 0,
      }
    } catch (error) {
      logger.error('Failed to get generation metrics', error as Error, {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      })
      return {
        totalGenerations: 0,
        averageGenerationTime: 0,
        minGenerationTime: 0,
        maxGenerationTime: 0,
        p50GenerationTime: 0,
        p95GenerationTime: 0,
        p99GenerationTime: 0,
      }
    }
  }

  /**
   * Get error metrics
   */
  async getErrorMetrics(limit: number = 50): Promise<ErrorMetrics> {
    try {
      // Get error counts by type
      const errorsByType = await db
        .select({
          errorType: error_logs.error_type,
          count: sql<number>`count(*)::int`,
        })
        .from(error_logs)
        .where(
          gte(error_logs.timestamp, new Date(Date.now() - 24 * 60 * 60 * 1000))
        )
        .groupBy(error_logs.error_type)

      // Get error counts by endpoint
      const errorsByEndpoint = await db
        .select({
          endpoint: error_logs.endpoint,
          count: sql<number>`count(*)::int`,
        })
        .from(error_logs)
        .where(
          and(
            gte(error_logs.timestamp, new Date(Date.now() - 24 * 60 * 60 * 1000)),
            sql`${error_logs.endpoint} IS NOT NULL`
          )
        )
        .groupBy(error_logs.endpoint)

      // Get recent errors
      const recentErrors = await db
        .select({
          id: error_logs.id,
          timestamp: error_logs.timestamp,
          level: error_logs.level,
          message: error_logs.message,
          errorType: error_logs.error_type,
          endpoint: error_logs.endpoint,
        })
        .from(error_logs)
        .orderBy(sql`${error_logs.timestamp} DESC`)
        .limit(limit)

      // Get total error count
      const totalResult = await db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(error_logs)
        .where(
          gte(error_logs.timestamp, new Date(Date.now() - 24 * 60 * 60 * 1000))
        )

      return {
        totalErrors: totalResult[0]?.count || 0,
        errorsByType: errorsByType.reduce(
          (acc, { errorType, count }) => {
            if (errorType) acc[errorType] = count
            return acc
          },
          {} as Record<string, number>
        ),
        errorsByEndpoint: errorsByEndpoint.reduce(
          (acc, { endpoint, count }) => {
            if (endpoint) acc[endpoint] = count
            return acc
          },
          {} as Record<string, number>
        ),
        recentErrors: recentErrors.map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          level: e.level,
          message: e.message,
          errorType: e.errorType || 'Unknown',
          endpoint: e.endpoint,
        })),
      }
    } catch (error) {
      logger.error('Failed to get error metrics', error as Error)
      return {
        totalErrors: 0,
        errorsByType: {},
        errorsByEndpoint: {},
        recentErrors: [],
      }
    }
  }

  /**
   * Check system health
   */
  async checkSystemHealth(): Promise<SystemHealthMetrics> {
    const health: SystemHealthMetrics = {
      status: 'healthy',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      database: {
        status: 'disconnected',
        responseTime: 0,
      },
      errors: {
        last5Minutes: 0,
        last1Hour: 0,
        last24Hours: 0,
      },
    }

    try {
      // Check database connection
      const dbStart = Date.now()
      await db.execute(sql`SELECT 1`)
      health.database = {
        status: 'connected',
        responseTime: Date.now() - dbStart,
      }
    } catch (error) {
      health.database.status = 'disconnected'
      health.status = 'unhealthy'
      logger.error('Database health check failed', error as Error)
    }

    try {
      // Get error counts for different time windows
      const now = Date.now()
      const errorCounts = await db
        .select({
          count: sql<number>`count(*)::int`,
          timeWindow: sql<string>`
            CASE
              WHEN ${error_logs.timestamp} >= ${new Date(now - 5 * 60 * 1000)} THEN '5min'
              WHEN ${error_logs.timestamp} >= ${new Date(now - 60 * 60 * 1000)} THEN '1hour'
              WHEN ${error_logs.timestamp} >= ${new Date(now - 24 * 60 * 60 * 1000)} THEN '24hour'
            END
          `,
        })
        .from(error_logs)
        .where(
          and(
            gte(error_logs.timestamp, new Date(now - 24 * 60 * 60 * 1000)),
            sql`${error_logs.level} IN ('error', 'fatal')`
          )
        )
        .groupBy(sql`timeWindow`)

      errorCounts.forEach(({ count, timeWindow }) => {
        if (timeWindow === '5min') health.errors.last5Minutes = count
        else if (timeWindow === '1hour') health.errors.last1Hour = count
        else if (timeWindow === '24hour') health.errors.last24Hours = count
      })

      // Determine health status based on error rates
      if (health.errors.last5Minutes > 10) {
        health.status = 'unhealthy'
      } else if (health.errors.last1Hour > 50 || health.errors.last24Hours > 200) {
        health.status = 'degraded'
      }
    } catch (error) {
      logger.error('Error count check failed', error as Error)
    }

    return health
  }

  /**
   * Log performance metric
   */
  logPerformanceMetric(
    operation: string,
    durationMs: number,
    metadata?: Record<string, any>
  ) {
    if (durationMs > 1000) {
      logger.warn(`Slow operation: ${operation}`, {
        operation,
        durationMs,
        ...metadata,
      })
    } else {
      logger.info(`Performance: ${operation}`, {
        operation,
        durationMs,
        ...metadata,
      })
    }
  }

  /**
   * Create a performance timer
   */
  startTimer(operation: string): () => void {
    const start = Date.now()
    return () => {
      const duration = Date.now() - start
      this.logPerformanceMetric(operation, duration)
      return duration
    }
  }
}

// Export singleton instance
export const monitoring = new MonitoringService()
