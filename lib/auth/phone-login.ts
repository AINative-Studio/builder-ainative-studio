/**
 * #944 Part 2 — authorize() logic for the `phone-login` next-auth
 * Credentials provider, extracted into a standalone, directly-testable
 * function (app/(auth)/auth.ts exports only the built NextAuth() instance,
 * not a reusable authOptions object — same pattern as
 * resolve-default-organization-id.test.ts testing a sibling helper out of
 * this auth module family in isolation).
 *
 * Mirrors the existing `ainative-oauth` provider's shape exactly: adopts an
 * ALREADY-VERIFIED access token (core's /register-phone or /login-phone
 * already issued it) into a session — no password, ever, on this path.
 *
 * `email` is a SYNTHETIC string (`phone-<id>@phone.ainative.studio`), not a
 * real address — a phone-only account has none. Initially this was a literal
 * `null`, which a fresh-context review (2026-10-06) caught breaking ~22
 * call sites across this app that key account identity off
 * session.user.email with a plain `if (!email) return 401` check. The
 * synthetic form mirrors the EXISTING guest-account convention
 * (`guest-${id}@example.com` in lib/db/queries.ts) so every one of those
 * call sites keeps working unchanged.
 */
export type PhoneLoginCreds = {
  accessToken?: string
  refreshToken?: string
  expiresIn?: string | number
}

type Workspace = { id: string | null; name: string | null }

async function resolveWorkspace(accessToken: string): Promise<Workspace> {
  try {
    const res = await fetch(
      `${process.env.AINATIVE_API_BASE_URL}/api/v1/workspaces`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (res.ok) {
      const data = await res.json()
      const workspaces: any[] = data?.workspaces ?? []
      if (workspaces.length > 0) {
        const chosen = workspaces.find((w) => w.is_default) ?? workspaces[0]
        return { id: chosen.id ?? null, name: chosen.name ?? null }
      }
    }
  } catch {
    /* best-effort, falls through to null */
  }
  return { id: null, name: null }
}

export async function authorizePhoneLogin(creds: PhoneLoginCreds) {
  if (!creds?.accessToken) return null

  try {
    const profileRes = await fetch(`${process.env.AINATIVE_API_BASE_URL}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    })
    if (!profileRes.ok) return null
    const profile = await profileRes.json()
    if (!profile?.id) return null

    const workspace = await resolveWorkspace(creds.accessToken)

    return {
      id: profile.id,
      // Review finding #3 (2026-10-06): a literal null here broke every one
      // of the ~22 call sites across this app that key account identity off
      // session.user.email (my-companies, credits, provision, chat-store's
      // deriveOwnerKey, secrets, domains, export, uploads, redeploy,
      // danger-zone, and more) — each does `if (!email) return 401`, so a
      // phone founder's session would authenticate successfully and then
      // immediately 401 on every subsequent authenticated call. Mirrors the
      // EXISTING synthetic-email convention guest accounts already use
      // (lib/db/queries.ts: `guest-${guestId}@example.com`) rather than
      // inventing a new one — a real, stable, unique string that satisfies
      // every truthy check downstream without any of those 22 call sites
      // needing to change. Distinguishable via its own `phone-` prefix +
      // `@phone.ainative.studio` domain if a caller ever needs to special-
      // case it the way deriveOwnerKey already special-cases guest emails.
      email: `phone-${profile.id}@phone.ainative.studio`,
      name: profile.full_name || profile.phone || 'AINative User',
      type: 'ainative' as const,
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken || undefined,
      expiresIn: creds.expiresIn ? Number(creds.expiresIn) : undefined,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }
  } catch {
    return null
  }
}
