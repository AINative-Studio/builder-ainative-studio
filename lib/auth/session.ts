import { cookies } from 'next/headers'

export interface Session {
  user?: {
    id: string
    email?: string
    name?: string
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')

    if (!sessionCookie) {
      return null
    }

    // For now, return a basic session
    // In production, you'd validate the session token
    return {
      user: {
        id: 'demo-user',
        email: 'demo@example.com',
        name: 'Demo User'
      }
    }
  } catch (error) {
    console.error('Session error:', error)
    return null
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession()

  if (!session) {
    throw new Error('Unauthorized - Session required')
  }

  return session
}
