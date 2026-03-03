import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createUser, getUser } from '@/lib/db/queries'
import { generateJWT } from '@/lib/auth-jwt'

// Validation schema for registration
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
})

/**
 * US-009: POST /api/auth/register
 * Register a new user with AINative Authentication
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const validation = registerSchema.safeParse(body)

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

    // Check if user already exists
    const existingUsers = await getUser(email)

    if (existingUsers.length > 0) {
      return NextResponse.json(
        { error: 'User already exists with this email' },
        { status: 409 }
      )
    }

    // Create user
    const [newUser] = await createUser(email, password)

    // Generate JWT token
    const { token, sessionId } = await generateJWT(newUser.id, newUser.email)

    // Create response with httpOnly cookie
    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
        },
        sessionId,
      },
      { status: 201 }
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
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Failed to register user' },
      { status: 500 }
    )
  }
}
