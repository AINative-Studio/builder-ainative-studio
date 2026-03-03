import { SignJWT, jwtVerify } from 'jose'
import { createUserSession, validateSession, invalidateSession } from './session-manager'

// JWT Secret from environment variable
const JWT_SECRET = process.env.AUTH_SECRET || 'fallback-secret-for-development'
const secret = new TextEncoder().encode(JWT_SECRET)

// JWT expiration: 7 days
const JWT_EXPIRATION = '7d'

export interface JWTPayload {
  userId: string
  email?: string
  sessionId: string
  iat?: number
  exp?: number
}

/**
 * Generate JWT token for authenticated user
 * US-009: JWT stored in httpOnly cookies
 */
export async function generateJWT(
  userId: string,
  email?: string
): Promise<{ token: string; sessionId: string }> {
  try {
    // Create session
    const { sessionId } = await createUserSession(userId, email)

    // Create JWT with session ID
    const token = await new SignJWT({
      userId,
      email,
      sessionId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(JWT_EXPIRATION)
      .sign(secret)

    return { token, sessionId }
  } catch (error) {
    console.error('Failed to generate JWT:', error)
    throw error
  }
}

/**
 * Verify and decode JWT token
 * Returns null if token is invalid
 */
export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret)

    // Validate session still exists
    const userId = await validateSession(payload.sessionId as string)

    if (!userId) {
      return null
    }

    return payload as unknown as JWTPayload
  } catch (error) {
    console.error('JWT verification failed:', error)
    return null
  }
}

/**
 * Invalidate JWT by invalidating the session
 */
export async function invalidateJWT(token: string): Promise<void> {
  try {
    const { payload } = await jwtVerify(token, secret)
    await invalidateSession(payload.sessionId as string)
  } catch (error) {
    console.error('Failed to invalidate JWT:', error)
    throw error
  }
}

/**
 * Refresh JWT token (generate new token with same session)
 */
export async function refreshJWT(token: string): Promise<string | null> {
  try {
    const payload = await verifyJWT(token)

    if (!payload) {
      return null
    }

    // Generate new JWT with same session
    const newToken = await new SignJWT({
      userId: payload.userId,
      email: payload.email,
      sessionId: payload.sessionId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(JWT_EXPIRATION)
      .sign(secret)

    return newToken
  } catch (error) {
    console.error('Failed to refresh JWT:', error)
    return null
  }
}
