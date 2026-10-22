import { describe, it, expect, vi, beforeEach } from 'vitest'

// session-manager.ts imports getRedisClient from './redis' and the five
// session query functions from './db/queries' — both resolve via the @
// alias to @/lib/redis and @/lib/db/queries respectively.
const { getRedisClient, createSession, getSession, updateSessionActivity, deleteSession, deleteUserSessions } =
  vi.hoisted(() => ({
    getRedisClient: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    updateSessionActivity: vi.fn(),
    deleteSession: vi.fn(),
    deleteUserSessions: vi.fn(),
  }))

vi.mock('@/lib/redis', () => ({ getRedisClient }))
vi.mock('@/lib/db/queries', () => ({
  createSession,
  getSession,
  updateSessionActivity,
  deleteSession,
  deleteUserSessions,
}))

import {
  createUserSession,
  getUserSession,
  refreshSession,
  invalidateSession,
  invalidateUserSessions,
  validateSession,
} from '@/lib/session-manager'

const SESSION_TTL = 7 * 24 * 60 * 60

function makeFakeRedis() {
  return {
    setex: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  }
}

let fakeRedis: ReturnType<typeof makeFakeRedis>

beforeEach(() => {
  vi.clearAllMocks()
  fakeRedis = makeFakeRedis()
  getRedisClient.mockReturnValue(fakeRedis)
  createSession.mockResolvedValue([{ id: 'whatever' }])
  getSession.mockResolvedValue(undefined)
  updateSessionActivity.mockResolvedValue(undefined)
  deleteSession.mockResolvedValue(undefined)
  deleteUserSessions.mockResolvedValue(undefined)
})

describe('lib/session-manager', () => {
  describe('createUserSession', () => {
    it('generates a session, writes to redis AND the db when redis is available', async () => {
      const before = Date.now()
      const result = await createUserSession('user-1', 'user@example.com')
      const after = Date.now()

      expect(typeof result.sessionId).toBe('string')
      expect(result.sessionId.length).toBeGreaterThan(0)

      // expiresAt is ~7 days ahead of "now" at call time (tolerance for test runtime)
      const expectedMin = before + SESSION_TTL * 1000 - 5000
      const expectedMax = after + SESSION_TTL * 1000 + 5000
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax)

      expect(fakeRedis.setex).toHaveBeenCalledTimes(1)
      const [key, ttl, json] = fakeRedis.setex.mock.calls[0]
      expect(key).toBe(`session:${result.sessionId}`)
      expect(ttl).toBe(SESSION_TTL)
      const parsed = JSON.parse(json)
      expect(parsed.userId).toBe('user-1')
      expect(parsed.email).toBe('user@example.com')

      expect(createSession).toHaveBeenCalledWith({
        sessionId: result.sessionId,
        userId: 'user-1',
        expiresAt: result.expiresAt,
      })
    })

    it('skips redis.setex entirely (no throw) when redis is unavailable, but still calls db createSession', async () => {
      getRedisClient.mockReturnValue(null)

      const result = await createUserSession('user-2')

      expect(fakeRedis.setex).not.toHaveBeenCalled()
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-2', sessionId: result.sessionId })
      )
    })

    it('rethrows when the db createSession call rejects', async () => {
      createSession.mockRejectedValueOnce(new Error('db down'))
      await expect(createUserSession('user-3')).rejects.toThrow('db down')
    })
  })

  describe('getUserSession', () => {
    it('returns the parsed session directly from redis on a fast-path hit (does not call db getSession)', async () => {
      const futureIso = new Date(Date.now() + 60_000).toISOString()
      const sessionData = {
        userId: 'user-1',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        expiresAt: futureIso,
      }
      fakeRedis.get.mockResolvedValueOnce(JSON.stringify(sessionData))

      const result = await getUserSession('sess-1')

      expect(result).toEqual(sessionData)
      expect(getSession).not.toHaveBeenCalled()
    })

    it('invalidates and returns null when the redis-cached session is expired', async () => {
      const pastIso = new Date(Date.now() - 60_000).toISOString()
      const sessionData = {
        userId: 'user-1',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        expiresAt: pastIso,
      }
      fakeRedis.get.mockResolvedValueOnce(JSON.stringify(sessionData))

      const result = await getUserSession('sess-expired')

      expect(result).toBeNull()
      // invalidateSession path: redis.del + db deleteSession
      expect(fakeRedis.del).toHaveBeenCalledWith('session:sess-expired')
      expect(deleteSession).toHaveBeenCalledWith('sess-expired')
    })

    it('falls back to the db when redis is unavailable, and returns null if db also has nothing', async () => {
      getRedisClient.mockReturnValue(null)
      getSession.mockResolvedValueOnce(undefined)

      const result = await getUserSession('sess-2')

      expect(result).toBeNull()
      expect(getSession).toHaveBeenCalledWith('sess-2')
    })

    it('falls back to the db on a redis miss (null), and returns null if db also has nothing', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)
      getSession.mockResolvedValueOnce(undefined)

      const result = await getUserSession('sess-3')

      expect(result).toBeNull()
      expect(getSession).toHaveBeenCalledWith('sess-3')
    })

    it('invalidates and returns null when the db session is expired', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)
      const dbSession = {
        id: 'sess-4',
        user_id: 'user-1',
        created_at: new Date(Date.now() - 100_000),
        last_activity: new Date(Date.now() - 100_000),
        expires_at: new Date(Date.now() - 1000), // already expired
      }
      getSession.mockResolvedValueOnce(dbSession)

      const result = await getUserSession('sess-4')

      expect(result).toBeNull()
      expect(deleteSession).toHaveBeenCalledWith('sess-4')
    })

    it('builds SessionData from a valid db row, re-caches in redis with a prorated TTL, and returns it', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)
      const createdAt = new Date('2020-01-01T00:00:00.000Z')
      const lastActivity = new Date('2020-01-02T00:00:00.000Z')
      const expiresAt = new Date(Date.now() + 10_000) // 10s remaining
      const dbSession = {
        id: 'sess-5',
        user_id: 'user-5',
        created_at: createdAt,
        last_activity: lastActivity,
        expires_at: expiresAt,
      }
      getSession.mockResolvedValueOnce(dbSession)

      const result = await getUserSession('sess-5')

      expect(result).toEqual({
        userId: 'user-5',
        createdAt: createdAt.toISOString(),
        lastActivity: lastActivity.toISOString(),
        expiresAt: expiresAt.toISOString(),
      })

      expect(fakeRedis.setex).toHaveBeenCalledTimes(1)
      const [key, ttl] = fakeRedis.setex.mock.calls[0]
      expect(key).toBe('session:sess-5')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(10)
    })

    it('does NOT call redis.setex to re-cache when the computed ttl is <= 0', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)
      const dbSession = {
        id: 'sess-6',
        user_id: 'user-6',
        created_at: new Date(Date.now() - 100_000),
        last_activity: new Date(Date.now() - 100_000),
        // expires_at right now (or in the past) -> but NOT < new Date() check already
        // passed only if still >= now; use a value equal to "now" rounded down so
        // Math.floor(diff/1000) computes to 0 or negative.
        expires_at: new Date(Date.now() + 1), // effectively ~0ms remaining
      }
      getSession.mockResolvedValueOnce(dbSession)

      await getUserSession('sess-6')

      expect(fakeRedis.setex).not.toHaveBeenCalled()
    })

    it('swallows any thrown error and resolves to null', async () => {
      fakeRedis.get.mockRejectedValueOnce(new Error('boom'))
      await expect(getUserSession('sess-err')).resolves.toBeNull()
    })
  })

  describe('refreshSession', () => {
    it('returns false immediately when there is no existing session', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)
      getSession.mockResolvedValueOnce(undefined)

      await expect(refreshSession('missing')).resolves.toBe(false)
    })

    it('updates lastActivity, re-writes to redis with the FULL ttl, and fires-and-forgets db update', async () => {
      const futureIso = new Date(Date.now() + 60_000).toISOString()
      const sessionData = {
        userId: 'user-1',
        createdAt: new Date().toISOString(),
        lastActivity: new Date(Date.now() - 100_000).toISOString(),
        expiresAt: futureIso,
      }
      fakeRedis.get.mockResolvedValueOnce(JSON.stringify(sessionData))
      updateSessionActivity.mockResolvedValueOnce(undefined)

      const result = await refreshSession('sess-1')

      expect(result).toBe(true)
      expect(fakeRedis.setex).toHaveBeenCalledWith('session:sess-1', SESSION_TTL, expect.any(String))
      expect(updateSessionActivity).toHaveBeenCalledWith('sess-1')
    })

    it('still resolves true even when the fire-and-forget db update rejects', async () => {
      const futureIso = new Date(Date.now() + 60_000).toISOString()
      const sessionData = {
        userId: 'user-1',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        expiresAt: futureIso,
      }
      fakeRedis.get.mockResolvedValueOnce(JSON.stringify(sessionData))
      updateSessionActivity.mockRejectedValueOnce(new Error('db write failed'))

      await expect(refreshSession('sess-1')).resolves.toBe(true)
      // allow the detached .catch() microtask to run so it doesn't leak into other tests
      await new Promise((r) => setTimeout(r, 0))
    })

    it('returns false when an error is thrown in the main try block', async () => {
      fakeRedis.get.mockRejectedValueOnce(new Error('boom'))
      await expect(refreshSession('sess-err')).resolves.toBe(false)
    })
  })

  describe('invalidateSession', () => {
    it('deletes from redis (when available) and the db', async () => {
      await invalidateSession('sess-1')
      expect(fakeRedis.del).toHaveBeenCalledWith('session:sess-1')
      expect(deleteSession).toHaveBeenCalledWith('sess-1')
    })

    it('skips redis.del when redis is unavailable but still calls db deleteSession', async () => {
      getRedisClient.mockReturnValue(null)
      await invalidateSession('sess-2')
      expect(fakeRedis.del).not.toHaveBeenCalled()
      expect(deleteSession).toHaveBeenCalledWith('sess-2')
    })

    it('rethrows on error (does not swallow)', async () => {
      deleteSession.mockRejectedValueOnce(new Error('boom'))
      await expect(invalidateSession('sess-err')).rejects.toThrow('boom')
    })
  })

  describe('invalidateUserSessions', () => {
    it('deletes only the redis session keys belonging to the target user, then always calls db deleteUserSessions', async () => {
      fakeRedis.keys.mockResolvedValueOnce(['session:a', 'session:b', 'session:c'])
      fakeRedis.get.mockImplementation((key: string) => {
        if (key === 'session:a') return Promise.resolve(JSON.stringify({ userId: 'target-user' }))
        if (key === 'session:b') return Promise.resolve(JSON.stringify({ userId: 'other-user' }))
        if (key === 'session:c') return Promise.resolve(JSON.stringify({ userId: 'target-user' }))
        return Promise.resolve(null)
      })

      await invalidateUserSessions('target-user')

      expect(fakeRedis.del).toHaveBeenCalledWith('session:a')
      expect(fakeRedis.del).toHaveBeenCalledWith('session:c')
      expect(fakeRedis.del).not.toHaveBeenCalledWith('session:b')
      expect(deleteUserSessions).toHaveBeenCalledWith('target-user')
    })

    it('calls db deleteUserSessions even when redis is unavailable', async () => {
      getRedisClient.mockReturnValue(null)
      await invalidateUserSessions('target-user')
      expect(fakeRedis.keys).not.toHaveBeenCalled()
      expect(deleteUserSessions).toHaveBeenCalledWith('target-user')
    })

    it('rethrows on error (does not swallow)', async () => {
      deleteUserSessions.mockRejectedValueOnce(new Error('boom'))
      await expect(invalidateUserSessions('u1')).rejects.toThrow('boom')
    })
  })

  describe('validateSession', () => {
    it('returns null immediately when there is no session', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)
      getSession.mockResolvedValueOnce(undefined)

      await expect(validateSession('missing')).resolves.toBeNull()
    })

    it('refreshes and returns the userId when a session is found', async () => {
      const futureIso = new Date(Date.now() + 60_000).toISOString()
      const sessionData = {
        userId: 'user-42',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        expiresAt: futureIso,
      }
      // getUserSession call (first) then refreshSession's internal getUserSession call (second)
      fakeRedis.get.mockResolvedValueOnce(JSON.stringify(sessionData))
      fakeRedis.get.mockResolvedValueOnce(JSON.stringify(sessionData))

      const result = await validateSession('sess-42')

      expect(result).toBe('user-42')
      expect(updateSessionActivity).toHaveBeenCalledWith('sess-42')
    })

    it('swallows errors and resolves to null', async () => {
      fakeRedis.get.mockRejectedValueOnce(new Error('boom'))
      await expect(validateSession('sess-err')).resolves.toBeNull()
    })
  })
})
