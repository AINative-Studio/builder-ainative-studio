import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { logger } from '@/lib/logger'
import {
  APIError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ExternalServiceError,
  handleError,
  withErrorHandler,
  handleStreamError,
  validateRequest,
  requireAuth,
  requirePermission,
} from '@/lib/middleware/error-handler'

function makeRequest(path = '/api/widgets', method = 'GET') {
  return new NextRequest(new Request(`https://example.com${path}`, { method }))
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

describe('lib/middleware/error-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.stubEnv('NODE_ENV', ORIGINAL_NODE_ENV ?? 'test')
  })

  describe('error classes', () => {
    it('APIError carries message, statusCode, and optional code', () => {
      const err = new APIError('boom', 418, 'TEAPOT')
      expect(err.message).toBe('boom')
      expect(err.statusCode).toBe(418)
      expect(err.code).toBe('TEAPOT')
      expect(err.name).toBe('APIError')
      expect(err).toBeInstanceOf(Error)
    })

    it('APIError defaults statusCode to 500 when omitted', () => {
      const err = new APIError('boom')
      expect(err.statusCode).toBe(500)
      expect(err.code).toBeUndefined()
    })

    it('ValidationError is a 400 with VALIDATION_ERROR code', () => {
      const err = new ValidationError('bad input')
      expect(err).toBeInstanceOf(APIError)
      expect(err.statusCode).toBe(400)
      expect(err.code).toBe('VALIDATION_ERROR')
      expect(err.name).toBe('ValidationError')
    })

    it('AuthenticationError defaults to a 401 with a default message', () => {
      const err = new AuthenticationError()
      expect(err.statusCode).toBe(401)
      expect(err.code).toBe('AUTHENTICATION_ERROR')
      expect(err.message).toBe('Authentication required')
    })

    it('AuthenticationError accepts a custom message', () => {
      const err = new AuthenticationError('token expired')
      expect(err.message).toBe('token expired')
    })

    it('AuthorizationError defaults to a 403 with a default message', () => {
      const err = new AuthorizationError()
      expect(err.statusCode).toBe(403)
      expect(err.code).toBe('AUTHORIZATION_ERROR')
      expect(err.message).toBe('Insufficient permissions')
    })

    it('NotFoundError defaults to a 404 with a default message', () => {
      const err = new NotFoundError()
      expect(err.statusCode).toBe(404)
      expect(err.code).toBe('NOT_FOUND_ERROR')
      expect(err.message).toBe('Resource not found')
    })

    it('RateLimitError defaults to a 429 with a default message', () => {
      const err = new RateLimitError()
      expect(err.statusCode).toBe(429)
      expect(err.code).toBe('RATE_LIMIT_ERROR')
    })

    it('ExternalServiceError defaults code to EXTERNAL_SERVICE_ERROR without a service name', () => {
      const err = new ExternalServiceError('upstream down')
      expect(err.statusCode).toBe(503)
      expect(err.code).toBe('EXTERNAL_SERVICE_ERROR')
    })

    it('ExternalServiceError derives an upper-cased service-specific code', () => {
      const err = new ExternalServiceError('upstream down', 'stripe')
      expect(err.code).toBe('STRIPE_ERROR')
    })
  })

  describe('handleError()', () => {
    it('builds a JSON error response with the error statusCode, path, and a request id header', async () => {
      const req = makeRequest('/api/widgets/1', 'DELETE')
      const err = new NotFoundError('widget missing')

      const res = handleError(err, req)

      expect(res.status).toBe(404)
      expect(res.headers.get('X-Request-ID')).toBeTruthy()

      const body = await res.json()
      expect(body).toMatchObject({
        error: 'NotFoundError',
        message: 'widget missing',
        statusCode: 404,
        path: '/api/widgets/1',
      })
      expect(body.requestId).toBeTruthy()
      expect(body.timestamp).toBeTruthy()
    })

    it('defaults statusCode to 500 for a plain Error', async () => {
      const req = makeRequest()
      const res = handleError(new Error('plain failure'), req)

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe('Error')
      expect(body.message).toBe('plain failure')
    })

    it('logs via logger.error for statusCode >= 500', () => {
      const req = makeRequest()
      handleError(new APIError('server broke', 500), req)
      expect(logger.error).toHaveBeenCalledWith(
        'Internal server error',
        expect.anything(),
        expect.objectContaining({ statusCode: 500 }),
      )
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('logs via logger.warn (not logger.error) for 4xx errors', () => {
      const req = makeRequest()
      handleError(new ValidationError('bad field'), req)
      expect(logger.warn).toHaveBeenCalledWith(
        'Client error',
        expect.objectContaining({ statusCode: 400, error: 'bad field' }),
      )
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('merges extra context into the log payload', () => {
      const req = makeRequest()
      handleError(new APIError('oops', 500), req, { userId: 'u1' })
      expect(logger.error).toHaveBeenCalledWith(
        'Internal server error',
        expect.anything(),
        expect.objectContaining({ userId: 'u1' }),
      )
    })

    it('includes a stack trace field in development', async () => {
      vi.stubEnv('NODE_ENV', 'development')
      const req = makeRequest()
      const err = new APIError('dev error', 500)
      const res = handleError(err, req)
      const body = await res.json()
      expect(body.stack).toBeTruthy()
    })

    it('omits the stack trace field outside development', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const req = makeRequest()
      const res = handleError(new APIError('prod error', 500), req)
      const body = await res.json()
      expect(body.stack).toBeUndefined()
    })

    it('falls back to generic error name/message when both are empty', async () => {
      const req = makeRequest()
      const err = new Error()
      err.name = ''
      err.message = ''
      const res = handleError(err, req)
      const body = await res.json()
      expect(body.error).toBe('Error')
      expect(body.message).toBe('An unexpected error occurred')
    })
  })

  describe('withErrorHandler()', () => {
    it('passes through a successful handler response unchanged', async () => {
      const handler = withErrorHandler(async () => NextResponse.json({ ok: true }))
      const res = await handler(makeRequest())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    })

    it('converts a thrown APIError into the standard error response', async () => {
      const handler = withErrorHandler(async () => {
        throw new ValidationError('missing field')
      })
      const res = await handler(makeRequest())
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.message).toBe('missing field')
    })

    it('wraps an unknown thrown error as a 500 INTERNAL_ERROR, hiding the message in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const handler = withErrorHandler(async () => {
        throw new Error('leaked internal detail')
      })
      const res = await handler(makeRequest())
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.message).toBe('An unexpected error occurred')
    })

    it('surfaces the real message for an unknown error in development', async () => {
      vi.stubEnv('NODE_ENV', 'development')
      const handler = withErrorHandler(async () => {
        throw new Error('dev detail visible')
      })
      const res = await handler(makeRequest())
      const body = await res.json()
      expect(body.message).toBe('dev detail visible')
    })

    it('forwards the context argument through to the handler', async () => {
      const handler = withErrorHandler(async (_req, ctx) => NextResponse.json({ ctx }))
      const res = await handler(makeRequest(), { params: { id: '1' } })
      expect(await res.json()).toEqual({ ctx: { params: { id: '1' } } })
    })
  })

  describe('handleStreamError()', () => {
    it('logs via logger.error for 5xx and marks the context as streaming', () => {
      const req = makeRequest('/api/chat-ws')
      handleStreamError(new APIError('stream broke', 500), req)
      expect(logger.error).toHaveBeenCalledWith(
        'Stream error',
        expect.anything(),
        expect.objectContaining({ streaming: true, path: '/api/chat-ws' }),
      )
    })

    it('logs via logger.warn for non-5xx errors', () => {
      const req = makeRequest('/api/chat-ws')
      handleStreamError(new ValidationError('bad chunk'), req)
      expect(logger.warn).toHaveBeenCalledWith(
        'Stream error',
        expect.objectContaining({ streaming: true, error: 'bad chunk' }),
      )
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('returns void and merges extra context', () => {
      const req = makeRequest('/api/chat-ws')
      const result = handleStreamError(new APIError('x', 500), req, { chatId: 'c1' })
      expect(result).toBeUndefined()
      expect(logger.error).toHaveBeenCalledWith(
        'Stream error',
        expect.anything(),
        expect.objectContaining({ chatId: 'c1' }),
      )
    })
  })

  describe('validateRequest()', () => {
    it('returns the parsed value when the schema parse succeeds', () => {
      const schema = { parse: (d: unknown) => ({ ...(d as object), validated: true }) }
      const result = validateRequest({ name: 'x' }, schema)
      expect(result).toEqual({ name: 'x', validated: true })
    })

    it('wraps a schema parse failure in a ValidationError', () => {
      const schema = {
        parse: () => {
          throw new Error('name is required')
        },
      }
      expect(() => validateRequest({}, schema)).toThrow(ValidationError)
      expect(() => validateRequest({}, schema)).toThrow(/Invalid request data: name is required/)
    })
  })

  describe('requireAuth()', () => {
    it('returns the userId when present', () => {
      expect(requireAuth('user-1')).toBe('user-1')
    })

    it('throws AuthenticationError when userId is null', () => {
      expect(() => requireAuth(null)).toThrow(AuthenticationError)
    })

    it('throws AuthenticationError when userId is undefined', () => {
      expect(() => requireAuth(undefined)).toThrow(AuthenticationError)
    })

    it('throws AuthenticationError when userId is an empty string', () => {
      expect(() => requireAuth('')).toThrow(AuthenticationError)
    })
  })

  describe('requirePermission()', () => {
    it('does not throw when hasPermission is true', () => {
      expect(() => requirePermission(true)).not.toThrow()
    })

    it('throws AuthorizationError with a default message when hasPermission is false', () => {
      expect(() => requirePermission(false)).toThrow(AuthorizationError)
    })

    it('throws AuthorizationError with a custom message when provided', () => {
      try {
        requirePermission(false, 'no write access')
        throw new Error('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthorizationError)
        expect((err as Error).message).toBe('no write access')
      }
    })
  })
})
