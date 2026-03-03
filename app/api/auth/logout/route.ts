import { NextRequest, NextResponse } from 'next/server'
import { invalidateJWT } from '@/lib/auth-jwt'

/**
 * US-009: POST /api/auth/logout
 * Logout user and invalidate session
 * US-010: Logout invalidates session immediately
 */
export async function POST(request: NextRequest) {
  try {
    // Get token from cookie
    const token = request.cookies.get('auth-token')?.value

    if (!token) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      )
    }

    // Invalidate session immediately
    await invalidateJWT(token)

    // Create response
    const response = NextResponse.json(
      { success: true, message: 'Logged out successfully' },
      { status: 200 }
    )

    // Clear auth cookie
    response.cookies.set('auth-token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0, // Expire immediately
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: 'Failed to logout' },
      { status: 500 }
    )
  }
}
