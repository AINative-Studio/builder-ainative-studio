import { getRedisClient } from './redis'
import {
  createSession,
  getSession,
  updateSessionActivity,
  deleteSession,
  deleteUserSessions,
} from './db/queries'
import { nanoid } from 'nanoid'

// Session TTL: 7 days in seconds
const SESSION_TTL = 7 * 24 * 60 * 60

// Redis key prefix for sessions
const SESSION_KEY = (sessionId: string) => `session:${sessionId}`

export interface SessionData {
  userId: string
  email?: string
  createdAt: string
  lastActivity: string
  expiresAt: string
}

/**
 * Create a new session in both Redis and PostgreSQL
 * US-010: Session Management with Redis
 */
export async function createUserSession(
  userId: string,
  email?: string
): Promise<{ sessionId: string; expiresAt: Date }> {
  const redis = getRedisClient()

  try {
    const sessionId = nanoid(32) // Generate secure session ID
    const now = new Date()
    const expiresAt = new Date(now.getTime() + SESSION_TTL * 1000)

    const sessionData: SessionData = {
      userId,
      email,
      createdAt: now.toISOString(),
      lastActivity: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }

    // Store in Redis with TTL
    await redis.setex(
      SESSION_KEY(sessionId),
      SESSION_TTL,
      JSON.stringify(sessionData)
    )

    // Store in PostgreSQL for persistence
    await createSession({
      sessionId,
      userId,
      expiresAt,
    })

    console.log(`Session created for user ${userId}: ${sessionId}`)
    return { sessionId, expiresAt }
  } catch (error) {
    console.error('Failed to create session:', error)
    throw error
  }
}

/**
 * Get session data from Redis (fast) or fall back to PostgreSQL
 */
export async function getUserSession(
  sessionId: string
): Promise<SessionData | null> {
  const redis = getRedisClient()

  try {
    // Try Redis first (fast path)
    const redisData = await redis.get(SESSION_KEY(sessionId))

    if (redisData) {
      const sessionData: SessionData = JSON.parse(redisData)

      // Check if session is expired
      if (new Date(sessionData.expiresAt) < new Date()) {
        await invalidateSession(sessionId)
        return null
      }

      return sessionData
    }

    // Fall back to PostgreSQL
    const dbSession = await getSession(sessionId)

    if (!dbSession) {
      return null
    }

    // Check if session is expired
    if (dbSession.expires_at < new Date()) {
      await invalidateSession(sessionId)
      return null
    }

    // Reconstruct session data and cache in Redis
    const sessionData: SessionData = {
      userId: dbSession.user_id,
      createdAt: dbSession.created_at.toISOString(),
      lastActivity: dbSession.last_activity.toISOString(),
      expiresAt: dbSession.expires_at.toISOString(),
    }

    // Re-cache in Redis
    const ttl = Math.floor(
      (dbSession.expires_at.getTime() - Date.now()) / 1000
    )
    if (ttl > 0) {
      await redis.setex(
        SESSION_KEY(sessionId),
        ttl,
        JSON.stringify(sessionData)
      )
    }

    return sessionData
  } catch (error) {
    console.error('Failed to get session:', error)
    return null
  }
}

/**
 * Refresh session TTL on activity
 * US-010: Refresh TTL on activity
 */
export async function refreshSession(sessionId: string): Promise<boolean> {
  const redis = getRedisClient()

  try {
    const sessionData = await getUserSession(sessionId)

    if (!sessionData) {
      return false
    }

    // Update last activity
    sessionData.lastActivity = new Date().toISOString()

    // Reset TTL in Redis
    await redis.setex(
      SESSION_KEY(sessionId),
      SESSION_TTL,
      JSON.stringify(sessionData)
    )

    // Update activity in PostgreSQL (async, don't wait)
    updateSessionActivity(sessionId).catch((error) => {
      console.error('Failed to update session activity in DB:', error)
    })

    return true
  } catch (error) {
    console.error('Failed to refresh session:', error)
    return false
  }
}

/**
 * Invalidate session immediately (for logout)
 * US-010: Logout invalidates session immediately
 */
export async function invalidateSession(sessionId: string): Promise<void> {
  const redis = getRedisClient()

  try {
    // Delete from Redis immediately
    await redis.del(SESSION_KEY(sessionId))

    // Delete from PostgreSQL
    await deleteSession(sessionId)

    console.log(`Session invalidated: ${sessionId}`)
  } catch (error) {
    console.error('Failed to invalidate session:', error)
    throw error
  }
}

/**
 * Invalidate all sessions for a user
 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  const redis = getRedisClient()

  try {
    // Get all session keys from Redis
    const keys = await redis.keys(SESSION_KEY('*'))

    // Filter sessions for this user
    for (const key of keys) {
      const data = await redis.get(key)
      if (data) {
        const sessionData: SessionData = JSON.parse(data)
        if (sessionData.userId === userId) {
          await redis.del(key)
        }
      }
    }

    // Delete from PostgreSQL
    await deleteUserSessions(userId)

    console.log(`All sessions invalidated for user: ${userId}`)
  } catch (error) {
    console.error('Failed to invalidate user sessions:', error)
    throw error
  }
}

/**
 * Validate session and return user ID
 * Returns null if session is invalid or expired
 */
export async function validateSession(
  sessionId: string
): Promise<string | null> {
  try {
    const sessionData = await getUserSession(sessionId)

    if (!sessionData) {
      return null
    }

    // Refresh session on successful validation
    await refreshSession(sessionId)

    return sessionData.userId
  } catch (error) {
    console.error('Failed to validate session:', error)
    return null
  }
}
