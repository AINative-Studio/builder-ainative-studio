import pino from 'pino'
import db from './db/connection'
import { error_logs } from './db/schema'
import { eq } from 'drizzle-orm'

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
        await db.insert(error_logs).values({
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
