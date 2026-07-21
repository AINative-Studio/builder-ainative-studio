import { compare } from 'bcrypt-ts'
import NextAuth, { type DefaultSession } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { createGuestUser, getUser } from '@/lib/db/queries'
import { authConfig } from './auth.config'
import { DUMMY_PASSWORD } from '@/lib/constants'
import type { DefaultJWT } from 'next-auth/jwt'
import { shouldRefreshToken, refreshAINativeToken } from '@/lib/auth/tokenRefresh'

const isDevelopment = process.env.NODE_ENV === 'development'

// Ensure AUTH_SECRET is always set — required by NextAuth
if (!process.env.AUTH_SECRET) {
  // Derive from any available secret so sessions work even if AUTH_SECRET is missing
  const seed = process.env.ANTHROPIC_API_KEY || process.env.AINATIVE_API_TOKEN || process.env.DATABASE_URL || 'ainative-builder-fallback'
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  process.env.AUTH_SECRET = `ainative-${Math.abs(hash).toString(36)}-${seed.slice(-8)}`
  console.warn('[auth] AUTH_SECRET not set — using derived fallback. Set AUTH_SECRET for production security.')
}

/**
 * Resolve the user's DEFAULT workspace authoritatively.
 *
 * `/v1/auth/me` returns organization_uuid via a non-deterministic
 * `LEFT JOIN user_organizations ... LIMIT 1` (no ORDER BY), so for multi-org
 * users it can return the wrong org or NULL. `/api/v1/workspaces` is ordered
 * (is_default DESC, created_at ASC), so it's the source of truth for "default".
 * Falls back to the /me fields if the workspaces call is unavailable.
 */
async function resolveDefaultWorkspace(
  accessToken: string,
  fallback: { id: string | null; name: string | null },
): Promise<{ id: string | null; name: string | null }> {
  try {
    const res = await fetch(
      `${process.env.AINATIVE_API_BASE_URL}/api/v1/workspaces`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (res.ok) {
      const data = await res.json()
      const workspaces: any[] = data?.workspaces ?? []
      if (workspaces.length > 0) {
        const chosen =
          workspaces.find((w) => w.is_default) ?? workspaces[0]
        return { id: chosen.id ?? null, name: chosen.name ?? null }
      }
    }
  } catch (err) {
    console.error('[AINative Auth] workspace resolution failed:', err)
  }
  return fallback
}

// AINative Authentication Helper
async function authenticateWithAINative(email: string, password: string) {
  try {
    const response = await fetch(`${process.env.AINATIVE_API_BASE_URL}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: email, password }),
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
        // Every AINative user has a permanent default workspace. Resolve it
        // authoritatively via /api/v1/workspaces (ordered), not the /me org
        // fields which can be null/wrong for multi-org users.
        const workspace = await resolveDefaultWorkspace(data.access_token, {
          id: profile.organization_uuid || null,
          name: profile.organization_name || null,
        })
        return {
          id: profile.id,
          email: profile.email,
          name: profile.full_name || profile.username,
          type: 'ainative' as const,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
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
    refreshToken?: string
    expiresAt?: number
    expiresIn?: number
    workspaceId?: string
    workspaceName?: string
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
    // "Sign in with AINative" — completes the OAuth2.1/PKCE flow. The
    // authorization-code exchange + userinfo lookup happen in
    // app/api/auth/ainative/callback; this provider just adopts the already
    // verified tokens into the NextAuth session (same shape as password login).
    Credentials({
      id: 'ainative-oauth',
      credentials: {},
      async authorize(creds: any) {
        if (!creds?.accessToken || !creds?.sub) return null
        // Resolve the default workspace authoritatively (userinfo only carries
        // the primary org), matching the password path.
        const workspace = await resolveDefaultWorkspace(creds.accessToken, {
          id: creds.workspaceId || null,
          name: creds.workspaceName || null,
        })
        return {
          id: String(creds.sub),
          email: creds.email || null,
          name: creds.name || (creds.email ? String(creds.email).split('@')[0] : 'AINative User'),
          type: 'ainative' as const,
          accessToken: creds.accessToken,
          refreshToken: creds.refreshToken || undefined,
          expiresIn: creds.expiresIn ? Number(creds.expiresIn) : undefined,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.type = user.type
        token.name = (user as any).name || user.email?.split('@')[0]
        // Store AINative access + refresh tokens if present
        if ((user as any).accessToken) {
          token.accessToken = (user as any).accessToken
          token.refreshToken = (user as any).refreshToken
          token.expiresAt = (user as any).expiresIn
            ? Date.now() + (user as any).expiresIn * 1000
            : undefined
        }
        // Default workspace (Organization) captured at sign-in.
        if ((user as any).workspaceId) {
          token.workspaceId = (user as any).workspaceId
          token.workspaceName = (user as any).workspaceName
        }
      }

      // Auto-refresh AINative token if close to expiry
      if (token.type === 'ainative' && token.accessToken && token.expiresAt) {
        if (shouldRefreshToken(token.expiresAt as number)) {
          try {
            const result = await refreshAINativeToken((token.refreshToken || token.accessToken) as string)
            if (result) {
              token.accessToken = result.accessToken
              token.expiresAt = result.expiresIn
                ? Date.now() + result.expiresIn * 1000
                : token.expiresAt
            }
          } catch (error) {
            console.error('[Auth] Token refresh failed:', error)
          }
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.type = token.type
        session.user.name = token.name as string
        // Pass access token to session for API calls
        if (token.accessToken) {
          (session as any).accessToken = token.accessToken
        }
        // Expose the user's default workspace on the session.
        if (token.workspaceId) {
          (session as any).workspaceId = token.workspaceId
          ;(session as any).workspaceName = token.workspaceName
        }
      }

      return session
    },
  },
})
