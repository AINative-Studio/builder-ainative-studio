import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { compare } from 'bcrypt-ts'
import { getUser } from '@/lib/db/queries'
import { generateJWT } from '@/lib/auth-jwt'

// Validation schema for login
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

/**
 * US-009: POST /api/auth/login
 * Authenticate user and create session
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const validation = loginSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const { email, password } = validation.data

    // Get user from database
    const users = await getUser(email)

    if (users.length === 0) {
      // Use timing-safe comparison to prevent user enumeration
      await compare(password, '$2b$10$dummy.hash.to.prevent.timing.attacks')
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    const [user] = users

    // Verify password
    if (!user.password) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    const passwordMatch = await compare(password, user.password)

    if (!passwordMatch) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Generate JWT token and create session
    const { token, sessionId } = await generateJWT(user.id, user.email)

    // Create response
    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
        },
        sessionId,
      },
      { status: 200 }
    )

    // Set httpOnly cookie with JWT
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Failed to authenticate user' },
      { status: 500 }
    )
  }
}
