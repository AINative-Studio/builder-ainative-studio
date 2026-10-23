import { describe, it, expect, vi, afterEach } from 'vitest'
import { ChatSDKError, getMessageByErrorCode, visibilityBySurface, type ErrorCode } from '@/lib/errors'

describe('ChatSDKError constructor', () => {
  it('parses type/surface, sets statusCode and message, leaves cause undefined when not passed', () => {
    const err = new ChatSDKError('unauthorized:auth')
    expect(err.type).toBe('unauthorized')
    expect(err.surface).toBe('auth')
    expect(err.statusCode).toBe(401)
    expect(err.message).toBe(getMessageByErrorCode('unauthorized:auth'))
    expect(err.cause).toBeUndefined()
  })

  it('sets cause when passed', () => {
    const err = new ChatSDKError('bad_request:api', 'extra detail')
    expect(err.cause).toBe('extra detail')
  })

  it('is a real Error instance and a ChatSDKError instance', () => {
    const err = new ChatSDKError('unauthorized:auth')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ChatSDKError)
  })

  it('maps every ErrorType to the correct statusCode', () => {
    expect(new ChatSDKError('bad_request:api').statusCode).toBe(400)
    expect(new ChatSDKError('unauthorized:auth').statusCode).toBe(401)
    expect(new ChatSDKError('forbidden:auth').statusCode).toBe(403)
    expect(new ChatSDKError('not_found:chat').statusCode).toBe(404)
    expect(new ChatSDKError('rate_limit:chat').statusCode).toBe(429)
    expect(new ChatSDKError('offline:chat').statusCode).toBe(503)
  })

  it('falls back to statusCode 500 for an unrecognized type (default branch)', () => {
    const err = new ChatSDKError('nonsense:api' as unknown as ErrorCode)
    expect(err.statusCode).toBe(500)
  })
})

describe('ChatSDKError.toResponse()', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('for a "log" visibility surface (database): logs via console.error and returns the generic body', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new ChatSDKError('bad_request:database', 'db detail')
    const response = err.toResponse()

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({ code: '', message: 'Something went wrong. Please try again later.' })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'bad_request:database',
        message: err.message,
        cause: 'db detail',
      }),
    )
  })

  it('for a "response" visibility surface (auth): returns the real code/message/cause', async () => {
    const err = new ChatSDKError('unauthorized:auth', 'need session')
    const response = err.toResponse()

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toEqual({
      code: 'unauthorized:auth',
      message: 'You need to sign in before continuing.',
      cause: 'need session',
    })
  })
})

describe('getMessageByErrorCode', () => {
  it('returns the database message for any errorCode whose surface contains "database", before the switch runs', () => {
    expect(getMessageByErrorCode('bad_request:database')).toBe(
      'An error occurred while executing a database query.',
    )
    expect(getMessageByErrorCode('rate_limit:database')).toBe(
      'An error occurred while executing a database query.',
    )
  })

  it('returns the explicit message for each case in the switch', () => {
    expect(getMessageByErrorCode('bad_request:api')).toBe(
      "The request couldn't be processed. Please check your input and try again.",
    )
    expect(getMessageByErrorCode('unauthorized:auth')).toBe('You need to sign in before continuing.')
    expect(getMessageByErrorCode('forbidden:auth')).toBe('Your account does not have access to this feature.')
    expect(getMessageByErrorCode('rate_limit:chat')).toBe(
      'You have exceeded your maximum number of messages for the day. Please try again later.',
    )
    expect(getMessageByErrorCode('not_found:chat')).toBe(
      'The requested chat was not found. Please check the chat ID and try again.',
    )
    expect(getMessageByErrorCode('forbidden:chat')).toBe(
      'This chat belongs to another user. Please check the chat ID and try again.',
    )
    expect(getMessageByErrorCode('unauthorized:chat')).toBe(
      'You need to sign in to view this chat. Please sign in and try again.',
    )
    expect(getMessageByErrorCode('offline:chat')).toBe(
      "We're having trouble sending your message. Please check your internet connection and try again.",
    )
    expect(getMessageByErrorCode('not_found:document')).toBe(
      'The requested document was not found. Please check the document ID and try again.',
    )
    expect(getMessageByErrorCode('forbidden:document')).toBe(
      'This document belongs to another user. Please check the document ID and try again.',
    )
    expect(getMessageByErrorCode('unauthorized:document')).toBe(
      'You need to sign in to view this document. Please sign in and try again.',
    )
    expect(getMessageByErrorCode('bad_request:document')).toBe(
      'The request to create or update the document was invalid. Please check your input and try again.',
    )
  })

  it('returns the generic message for the default branch (no database substring, not explicitly cased)', () => {
    expect(getMessageByErrorCode('rate_limit:api')).toBe('Something went wrong. Please try again later.')
    expect(getMessageByErrorCode('offline:auth')).toBe('Something went wrong. Please try again later.')
  })
})

describe('visibilityBySurface', () => {
  it('database is "log"', () => {
    expect(visibilityBySurface.database).toBe('log')
  })

  it('all other surfaces are "response"', () => {
    const responseSurfaces = [
      'chat',
      'auth',
      'api',
      'stream',
      'history',
      'vote',
      'document',
      'suggestions',
    ] as const
    for (const surface of responseSurfaces) {
      expect(visibilityBySurface[surface]).toBe('response')
    }
  })
})
