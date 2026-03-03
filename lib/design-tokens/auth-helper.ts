import { auth } from '@/app/(auth)/auth'

/**
 * Get authenticated user from session
 * Returns user ID or null if not authenticated
 */
export async function getAuthenticatedUser() {
  const session = await auth()

  if (!session?.user?.id) {
    return null
  }

  return {
    userId: session.user.id,
    email: session.user.email,
  }
}

/**
 * Require authentication - throws error if not authenticated
 */
export async function requireAuth() {
  const user = await getAuthenticatedUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}
