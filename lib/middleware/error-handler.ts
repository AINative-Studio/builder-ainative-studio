import { NextRequest, NextResponse } from 'next/server'
import { logger, LogError } from '../logger'

export interface ErrorResponse {
  error: string
  message: string
  statusCode: number
  timestamp: string
  path: string
  requestId?: string
}

export class APIError extends Error implements LogError {
  statusCode: number
  code?: string

  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message)
    this.name = 'APIError'
    this.statusCode = statusCode
    this.code = code
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends APIError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

export class AuthenticationError extends APIError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR')
    this.name = 'AuthenticationError'
  }
}

export class AuthorizationError extends APIError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR')
    this.name = 'AuthorizationError'
  }
}

export class NotFoundError extends APIError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND_ERROR')
    this.name = 'NotFoundError'
  }
}

export class RateLimitError extends APIError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_ERROR')
    this.name = 'RateLimitError'
  }
}

export class ExternalServiceError extends APIError {
  constructor(message: string, service?: string) {
    super(message, 503, service ? `${service.toUpperCase()}_ERROR` : 'EXTERNAL_SERVICE_ERROR')
    this.name = 'ExternalServiceError'
  }
}

// Global error handler function
export function handleError(
  error: Error | APIError,
  request: NextRequest,
  context?: Record<string, any>,
): NextResponse<ErrorResponse> {
  const pathname = request.nextUrl.pathname
  const method = request.method

  // Determine status code
  const statusCode = (error as APIError).statusCode || 500

  // Generate request ID for tracking
  const requestId = crypto.randomUUID()

  // Log error with context
  const logContext = {
    path: pathname,
    method,
    statusCode,
    requestId,
    ...context,
  }

  if (statusCode >= 500) {
    logger.error('Internal server error', error as LogError, logContext)
  } else if (statusCode >= 400) {
    logger.warn('Client error', { ...logContext, error: error.message })
  }

  // Build error response
  const errorResponse: ErrorResponse = {
    error: error.name || 'Error',
    message: error.message || 'An unexpected error occurred',
    statusCode,
    timestamp: new Date().toISOString(),
    path: pathname,
    requestId,
  }

  // In development, include stack trace
  if (process.env.NODE_ENV === 'development') {
    ;(errorResponse as any).stack = error.stack
  }

  return NextResponse.json(errorResponse, {
    status: statusCode,
    headers: {
      'X-Request-ID': requestId,
    },
  })
}

// Async error wrapper for API routes
export function withErrorHandler<T>(
  handler: (request: NextRequest, context?: any) => Promise<NextResponse<T>>,
) {
  return async (request: NextRequest, context?: any): Promise<NextResponse<T | ErrorResponse>> => {
    try {
      return await handler(request, context)
    } catch (error) {
      if (error instanceof APIError) {
        return handleError(error, request, context)
      }

      // Handle unknown errors
      const apiError = new APIError(
        process.env.NODE_ENV === 'development'
          ? (error as Error).message
          : 'An unexpected error occurred',
        500,
        'INTERNAL_ERROR',
      )

      // Preserve original stack trace
      apiError.stack = (error as Error).stack

      return handleError(apiError, request, context)
    }
  }
}

// Error handler for streaming responses
export function handleStreamError(
  error: Error | APIError,
  request: NextRequest,
  context?: Record<string, any>,
): void {
  const pathname = request.nextUrl.pathname
  const method = request.method
  const statusCode = (error as APIError).statusCode || 500
  const requestId = crypto.randomUUID()

  const logContext = {
    path: pathname,
    method,
    statusCode,
    requestId,
    streaming: true,
    ...context,
  }

  if (statusCode >= 500) {
    logger.error('Stream error', error as LogError, logContext)
  } else {
    logger.warn('Stream error', { ...logContext, error: error.message })
  }
}

// Validation helper
export function validateRequest<T>(
  data: unknown,
  schema: { parse: (data: unknown) => T },
): T {
  try {
    return schema.parse(data)
  } catch (error) {
    throw new ValidationError(
      `Invalid request data: ${(error as Error).message}`,
    )
  }
}

// Check authentication helper
export function requireAuth(userId: string | null | undefined): string {
  if (!userId) {
    throw new AuthenticationError()
  }
  return userId
}

// Check authorization helper
export function requirePermission(
  hasPermission: boolean,
  message?: string,
): void {
  if (!hasPermission) {
    throw new AuthorizationError(message)
  }
}
