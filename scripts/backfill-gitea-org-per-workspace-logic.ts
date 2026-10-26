/**
 * #1545 — pure, testable logic for the Gitea org-per-workspace migration
 * (scripts/backfill-gitea-org-per-workspace.ts).
 *
 * Split out of the CLI for the same reason #1013's
 * backfill-zerodb-keys-args.ts was: the CLI itself runs `main()` on import
 * and makes real network calls, which makes it untestable in place — and
 * this is exactly the code path where a silent "helpful" fallback is most
 * expensive (see resolveFounderWorkspaceId's own doc comment).
 */
import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

interface AdminWorkspace {
  id: string
  name: string
  is_default: boolean
  created_at: string
}

/**
 * Resolve a founder's REAL workspace id from their email, via the admin
 * endpoint core built for exactly this (builder#1555 → core PR #9214,
 * confirmed live 2026-10-26): `GET /api/v1/admin/users/by-email/{email}/
 * workspaces`, authenticated with Builder's existing service key (the same
 * X-API-Key path company-export.ts already uses for its own admin-style
 * reads — core traced this through and deliberately did NOT mint a new
 * Builder-specific credential). Response is `{user_id, email, workspaces:
 * [{id, name, is_default, created_at}]}`, ordered `is_default DESC,
 * created_at ASC` — workspaces[0] is the founder's real default, matching
 * the exact ordering resolveDefaultWorkspace() (app/(auth)/auth.ts) already
 * relies on for the live-login path.
 *
 * Returns null — never the stored (untrustworthy) AppEntry.workspaceId, and
 * never a guess — on: unknown email (404, a real "no such founder" case,
 * not an error), a founder with zero workspaces (shouldn't happen per the
 * platform's own "every user has a default workspace" invariant, but fails
 * safe rather than assuming), or any network/auth failure. The caller
 * (main(), in the sibling CLI file) reports every null as
 * `skipped_unresolvable_workspace` rather than falling back to a value this
 * exact migration exists because it was proven untrustworthy.
 */
export async function resolveFounderWorkspaceId(ownerEmail: string): Promise<string | null> {
  const email = (ownerEmail || '').trim()
  if (!email) return null
  const apiKey = getAinativeApiKey()
  if (!apiKey) return null

  try {
    const res = await fetch(
      `${AINATIVE_API}/api/v1/admin/users/by-email/${encodeURIComponent(email)}/workspaces`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(15000),
      },
    )
    if (!res.ok) return null // 404 (unknown email) and any auth/server error both fail safe to null
    const data = (await res.json()) as { workspaces?: AdminWorkspace[] }
    const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : []
    if (workspaces.length === 0) return null
    // Trust the endpoint's own documented ordering (is_default DESC,
    // created_at ASC) rather than re-sorting here — re-deriving "default"
    // client-side from a flag that might be absent/stale is exactly the
    // kind of silent-fallback risk this whole migration exists to avoid.
    return workspaces[0]?.id || null
  } catch {
    return null
  }
}
