/**
 * Pending-build persistence (#dashboard-ux — auth wall).
 *
 * When an anonymous founder submits an idea, we stash the generated idea/brand and
 * send them to signup BEFORE any generation runs. The signup flow then routes them
 * to "check your email to verify" — which means they LEAVE the app (open their
 * inbox, click the link) and come back on a fresh page load, losing React state.
 *
 * To survive that round-trip we persist the pending build to localStorage under a
 * single fixed key (there is only ever one in-flight deferred build per browser).
 * On the next load the context restores it, so after the founder verifies + logs
 * back in, the deferred START_BUILD still fires and their prototype gets built.
 */

export interface PendingBuild {
  idea: string
  appSub: string
  companyName: string
  brandTagline: string
  brandColor: string
}

const KEY = 'ainative_pending_build'

export function savePendingBuild(pb: PendingBuild): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(KEY, JSON.stringify(pb))
  } catch {
    /* private mode / quota — non-fatal, the in-memory state still drives the flow */
  }
}

export function loadPendingBuild(): PendingBuild | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const pb = JSON.parse(raw) as Partial<PendingBuild>
    // Only accept a well-formed record — never resume a half-written stash.
    if (!pb || typeof pb.idea !== 'string' || typeof pb.appSub !== 'string' || !pb.appSub) {
      return null
    }
    return {
      idea: pb.idea,
      appSub: pb.appSub,
      companyName: pb.companyName || '',
      brandTagline: pb.brandTagline || '',
      brandColor: pb.brandColor || '#2f6d86',
    }
  } catch {
    return null
  }
}

export function clearPendingBuild(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.removeItem(KEY)
  } catch {
    /* non-fatal */
  }
}
