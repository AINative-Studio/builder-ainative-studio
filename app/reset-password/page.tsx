/**
 * /reset-password (#7698) — the landing page for the link in core's password
 * reset email. Core builds that link as `{frontend_url}/reset-password?token=…`,
 * and for a Builder-originated reset frontend_url is now
 * https://builder.ainative.studio — so without this route the founder clicks
 * their reset link and hits a 404 on Builder.
 *
 * The password-entry UI itself already exists as the SPA's 'reset' screen
 * (components/build/screens/Auth.tsx, mode='reset'), and 'reset' is already an
 * allowed deep-link screen (#651). So this is a thin redirect that forwards the
 * token into the SPA, exactly like /refer → /build?screen=refer.
 *
 * Public: a founder resetting a password is by definition logged out, so
 * middleware.ts allowlists this path anonymously.
 */
import { redirect } from 'next/navigation'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const qs = token ? `&token=${encodeURIComponent(token)}` : ''
  redirect(`/build?screen=reset${qs}`)
}
