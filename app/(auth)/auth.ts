import { compare } from 'bcrypt-ts'
import NextAuth, { type DefaultSession } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { createGuestUser, getUser } from '@/lib/db/queries'
import { authConfig } from './auth.config'
import { DUMMY_PASSWORD } from '@/lib/constants'
import type { DefaultJWT } from 'next-auth/jwt'

const isDevelopment = process.env.NODE_ENV === 'development'

// Check for required environment variables
// Set default AUTH_SECRET for development if missing
if (!process.env.AUTH_SECRET && isDevelopment) {
  console.warn(
    '⚠️  AUTH_SECRET not found. Using default secret for development.\n' +
      'For production, please set AUTH_SECRET in your environment variables.\n',
  )
  process.env.AUTH_SECRET = 'dev-secret-key-not-for-production'
}

// AINative Authentication Helper
async function authenticateWithAINative(email: string, password: string) {
  try {
    const formData = new URLSearchParams()
    formData.append('username', email)
    formData.append('password', password)

    const response = await fetch(`${process.env.AINATIVE_API_BASE_URL}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    })

    if (!response.ok) {
      console.error('[AINative Auth] Login failed:', response.status)
      return null
    }

    const data = await response.json()

    if (data.access_token) {
      // Get user profile with token
      const profileResponse = await fetch(`${process.env.AINATIVE_API_BASE_URL}/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${data.access_token}`,
        },
      })

      if (profileResponse.ok) {
        const profile = await profileResponse.json()
        console.log('[AINative Auth] Successfully authenticated:', profile.email)
        return {
          id: profile.id,
          email: profile.email,
          name: profile.full_name || profile.username,
          type: 'ainative' as const,
          accessToken: data.access_token,
          expiresIn: data.expires_in,
        }
      }
    }

    return null
  } catch (error) {
    console.error('[AINative Auth] Error:', error)
    return null
  }
}

export type UserType = 'guest' | 'regular' | 'ainative'

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string
      type: UserType
    } & DefaultSession['user']
  }

  interface User {
    id?: string
    email?: string | null
    type: UserType
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string
    type: UserType
    accessToken?: string
    expiresIn?: number
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {},
      async authorize({ email, password }: any) {
        // First, try AINative authentication
        console.log('[Auth] Attempting AINative authentication for:', email)
        const ainativeUser = await authenticateWithAINative(email, password)

        if (ainativeUser) {
          console.log('[Auth] AINative authentication successful')
          return ainativeUser
        }

        // Fallback to local database authentication
        console.log('[Auth] Falling back to local database authentication')
        const users = await getUser(email)

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD)
          return null
        }

        const [user] = users

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD)
          return null
        }

        const passwordsMatch = await compare(password, user.password)

        if (!passwordsMatch) return null

        return { ...user, type: 'regular' }
      },
    }),
    Credentials({
      id: 'guest',
      credentials: {},
      async authorize() {
        const [guestUser] = await createGuestUser()
        return { ...guestUser, type: 'guest' }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.type = user.type
        // Store AINative access token if present
        if ((user as any).accessToken) {
          token.accessToken = (user as any).accessToken
          token.expiresIn = (user as any).expiresIn
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.type = token.type
        // Pass access token to session if needed
        if (token.accessToken) {
          (session as any).accessToken = token.accessToken
        }
      }

      return session
    },
  },
})
