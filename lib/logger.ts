import pino from 'pino'

/**
 * The drizzle/Postgres chain is loaded LAZILY, on first real persistence, not
 * at module load (#1489).
 *
 * This module is imported by a very large share of this repo's server code
 * (e.g. app/api/build/ask/route.ts reaches it via lib/agent/zeromemory.ts), but
 * the ONLY consumer of `db`/`error_logs` is persistError() below, which no-ops
 * unless NODE_ENV === 'production' AND the level is error/fatal. Statically
 * importing './db/connection' + './db/schema' therefore made every importer
 * pay for Vite resolving and transforming `drizzle-orm/postgres-js` and the
 * 1300-line schema at import time — measured at ~1.9s for the ORM package
 * alone, which dominated the ~4s import of the ask route and pushed
 * __tests__/api/build-ask-project-resolution.test.ts past its 5000ms timeout
 * under full-suite contention.
 *
 * (The `🗄️  Using PostgreSQL database` line that shows up in test stdout is
 * NOT a real connection: `postgres(url)` only builds a client object and
 * connects lazily on first query. Deleting POSTGRES_URL left the import time
 * unchanged — the cost was always module transform, not network I/O.)
 *
 * Memoized so repeated error logging in production loads the chain once.
 * Mirrors the deliberate-laziness convention documented in lib/build/otp.ts.
 */
type ErrorLogWriter = {
  insert: (table: unknown) => { values: (row: Record<string, unknown>) => Promise<unknown> }
}

let dbChainPromise: Promise<{ db: ErrorLogWriter | null; error_logs: unknown } | null> | null = null

function loadDbChain() {
  if (!dbChainPromise) {
    dbChainPromise = Promise.all([import('./db/connection'), import('./db/schema')])
      .then(([connection, schema]) => ({
        db: (connection.default ?? connection.db ?? null) as ErrorLogWriter | null,
        error_logs: schema.error_logs,
      }))
      .catch((err) => {
        console.error('Failed to load database chain for error persistence:', err)
        // Reset so a later call can retry rather than caching the failure.
        dbChainPromise = null
        return null
      })
  }
  return dbChainPromise
}

// Create base logger (simplified to avoid worker thread crashes)
const baseLogger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  // Disabled transport to prevent worker thread crashes
  formatters: {
    level: (label) => ({ level: label }),
  },
})

export interface LogContext {
  userId?: string
  chatId?: string
  path?: string
  method?: string
  statusCode?: number
  duration?: number
  ip?: string
  userAgent?: string
  [key: string]: any
}

export interface LogError extends Error {
  statusCode?: number
  code?: string
}

// Enhanced logger with database persistence for production errors
class Logger {
  private logger: pino.Logger

  constructor() {
    this.logger = baseLogger
  }

  private async persistError(
    level: string,
    message: string,
    context?: LogContext,
    error?: LogError,
  ) {
    // Only persist errors and fatal logs to database in production
    if (
      process.env.NODE_ENV === 'production' &&
      (level === 'error' || level === 'fatal')
    ) {
      try {
        const chain = await loadDbChain()
        if (!chain?.db) return

        await chain.db.insert(chain.error_logs).values({
          level,
          message,
          context: context as any,
          stack_trace: error?.stack || null,
          error_type: error?.name || error?.code || 'UnknownError',
          endpoint: context?.path || null,
          user_id: context?.userId || null,
        })
      } catch (dbError) {
        // Fallback to console if database write fails
        console.error('Failed to persist error to database:', dbError)
      }
    }
  }

  info(message: string, context?: LogContext) {
    this.logger.info({ ...context }, message)
  }

  warn(message: string, context?: LogContext) {
    this.logger.warn({ ...context }, message)
    this.persistError('warn', message, context)
  }

  error(message: string, error?: LogError, context?: LogContext) {
    this.logger.error(
      {
        ...context,
        error: {
          message: error?.message,
          name: error?.name,
          code: error?.code,
          statusCode: error?.statusCode,
          stack: error?.stack,
        },
      },
      message,
    )
    this.persistError('error', message, context, error)
  }

  fatal(message: string, error?: LogError, context?: LogContext) {
    this.logger.fatal(
      {
        ...context,
        error: {
          message: error?.message,
          name: error?.name,
          code: error?.code,
          statusCode: error?.statusCode,
          stack: error?.stack,
        },
      },
      message,
    )
    this.persistError('fatal', message, context, error)
  }

  // HTTP request logger
  request(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context?: LogContext,
  ) {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
    const message = `${method} ${path} ${statusCode} - ${duration}ms`

    const logContext: LogContext = {
      ...context,
      method,
      path,
      statusCode,
      duration,
    }

    this.logger[level](logContext, message)

    if (level === 'error') {
      this.persistError(level, message, logContext)
    }
  }

  // Child logger with bound context
  child(context: LogContext) {
    const childLogger = this.logger.child(context)
    return {
      info: (message: string, additionalContext?: LogContext) =>
        childLogger.info({ ...additionalContext }, message),
      warn: (message: string, additionalContext?: LogContext) => {
        childLogger.warn({ ...additionalContext }, message)
        this.persistError('warn', message, { ...context, ...additionalContext })
      },
      error: (message: string, error?: LogError, additionalContext?: LogContext) => {
        childLogger.error(
          {
            ...additionalContext,
            error: {
              message: error?.message,
              name: error?.name,
              code: error?.code,
              statusCode: error?.statusCode,
              stack: error?.stack,
            },
          },
          message,
        )
        this.persistError('error', message, { ...context, ...additionalContext }, error)
      },
      fatal: (message: string, error?: LogError, additionalContext?: LogContext) => {
        childLogger.fatal(
          {
            ...additionalContext,
            error: {
              message: error?.message,
              name: error?.name,
              code: error?.code,
              statusCode: error?.statusCode,
              stack: error?.stack,
            },
          },
          message,
        )
        this.persistError('fatal', message, { ...context, ...additionalContext }, error)
      },
    }
  }
}

export const logger = new Logger()
