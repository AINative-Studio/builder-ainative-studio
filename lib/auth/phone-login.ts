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
 * `email` is explicitly null (not omitted) since a phone-only account has
 * none — downstream code reading session.user.email must see an explicit
 * absence, not undefined from a missing key.
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
      email: null,
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
