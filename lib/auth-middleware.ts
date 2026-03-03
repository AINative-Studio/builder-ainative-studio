import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from './auth-jwt'

export interface AuthenticatedRequest extends NextRequest {
  userId?: string
  email?: string
}

/**
 * US-009: Protected middleware for authenticated routes
 * Verify JWT from httpOnly cookie and attach user info to request
 */
export async function withAuth(
  request: NextRequest,
  handler: (
    req: AuthenticatedRequest
  ) => Promise<NextResponse> | NextResponse
): Promise<NextResponse> {
  try {
    // Get token from cookie
    const token = request.cookies.get('auth-token')?.value

    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Verify JWT
    const payload = await verifyJWT(token)

    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Attach user info to request
    const authenticatedRequest = request as AuthenticatedRequest
    authenticatedRequest.userId = payload.userId
    authenticatedRequest.email = payload.email

    // Call handler with authenticated request
    return await handler(authenticatedRequest)
  } catch (error) {
    console.error('Authentication middleware error:', error)
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    )
  }
}

/**
 * Optional auth middleware - doesn't fail if no token
 * Just attaches user info if token is valid
 */
export async function withOptionalAuth(
  request: NextRequest,
  handler: (
    req: AuthenticatedRequest
  ) => Promise<NextResponse> | NextResponse
): Promise<NextResponse> {
  try {
    const token = request.cookies.get('auth-token')?.value

    if (token) {
      const payload = await verifyJWT(token)

      if (payload) {
        const authenticatedRequest = request as AuthenticatedRequest
        authenticatedRequest.userId = payload.userId
        authenticatedRequest.email = payload.email
      }
    }

    return await handler(request as AuthenticatedRequest)
  } catch (error) {
    console.error('Optional auth middleware error:', error)
    return await handler(request as AuthenticatedRequest)
  }
}

/**
 * Extract user from request (for use in server components)
 */
export async function getUserFromRequest(
  request: NextRequest
): Promise<{ userId: string; email?: string } | null> {
  try {
    const token = request.cookies.get('auth-token')?.value

    if (!token) {
      return null
    }

    const payload = await verifyJWT(token)

    if (!payload) {
      return null
    }

    return {
      userId: payload.userId,
      email: payload.email,
    }
  } catch (error) {
    console.error('Failed to get user from request:', error)
    return null
  }
}
