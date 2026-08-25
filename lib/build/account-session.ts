/**
 * Account session helpers (#50) — honest guest vs authenticated state detection.
 *
 * A "guest" session is one provisioned by the 'guest' credentials provider;
 * its user.type is 'guest' and its email matches the guestRegex pattern
 * (`guest-<uuid>@example.com`). We check both as defense-in-depth: type is
 * the canonical signal; the email regex is the fallback for environments where
 * the JWT type field isn't propagated (e.g. stale tokens).
 */

import { guestRegex } from '@/lib/constants'
import type { Session } from 'next-auth'

/**
 * Returns true when the session belongs to a temporary anonymous guest —
 * never signed-in, no real identity, no persisted account.
 *
 * Rules (any one is sufficient):
 *   1. No session at all (unauthenticated).
 *   2. session.user.type === 'guest'
 *   3. session.user.email matches the guest-<uuid>@example.com pattern.
 */
export function isGuestSession(session: Session | null | undefined): boolean {
  if (!session) return true
  // Primary signal: explicit type from the auth provider.
  const userType = (session.user as any)?.type
  if (userType === 'guest') return true
  // Fallback: email shape (covers stale tokens where type may be absent).
  const email = session.user?.email ?? ''
  return guestRegex.test(email)
}

/**
 * Returns a display-safe name for the authenticated user.
 * Falls back to the local-part of the email, then 'You'.
 * Never exposes the guest-uuid email to the UI.
 */
export function getDisplayName(session: Session | null | undefined): string {
  if (isGuestSession(session)) return 'Guest'
  const name = session?.user?.name
  if (name) return name
  const email = session?.user?.email ?? ''
  const local = email.split('@')[0]
  return local || 'You'
}

/**
 * Returns the display email for an authenticated user, or null for guests.
 * Suppresses the synthetic guest-<uuid>@example.com address entirely.
 */
export function getDisplayEmail(session: Session | null | undefined): string | null {
  if (isGuestSession(session)) return null
  const email = session?.user?.email
  return email || null
}
