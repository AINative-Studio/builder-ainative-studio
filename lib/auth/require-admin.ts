/**
 * Single, shared admin-access gate for every admin-only API route (#919).
 *
 * Previously, three separate routes each re-implemented their own admin
 * check inline as `email?.includes('admin')` — an unconditional substring
 * match that granted real admin access to any account whose email merely
 * CONTAINS "admin" anywhere (e.g. `notanadmin@foo.com`,
 * `administrator@gmail.com`). That is not an access-control check at all.
 *
 * This resolves admin status through the SAME real mechanism Builder
 * already uses elsewhere for privileged access (#309 staff bypass / #762
 * plan-resolution consistency): `fetchCorePlanIdentity()`, which reads
 * core's real `/api/v1/auth/me` and trusts only core's own `role` /
 * `is_admin` / `is_superuser` fields — never anything client-supplied like
 * the user's own email string.
 *
 * Fails closed in every ambiguous case: no session, no access token, or an
 * unverified core response are all treated as "not admin", never as
 * "assume admin".
 */

import { auth } from '@/app/(auth)/auth'
import { fetchCorePlanIdentity } from '@/lib/ainative/resolve-plan'

export type RequireAdminResult =
  | { ok: true; email: string | null; userId: string | null }
  | { ok: false; status: 401 | 403; message: string }

export async function requireAdmin(): Promise<RequireAdminResult> {
  const session = await auth()
  const token = (session as any)?.accessToken as string | undefined

  if (!session || !token) {
    return { ok: false, status: 401, message: 'Authentication required' }
  }

  const identity = await fetchCorePlanIdentity(token)

  if (!identity.verified || !identity.admin) {
    return { ok: false, status: 403, message: 'Admin access required' }
  }

  return {
    ok: true,
    email: identity.email ?? (session as any)?.user?.email ?? null,
    userId: (session as any)?.user?.id ?? null,
  }
}
