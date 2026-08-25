/**
 * /billing — Redirect to account settings
 *
 * /billing is SPA-internal in the build screen (GOTO_SCREEN). This route
 * catches direct navigation and deep-links, preventing a 404 or auth-redirect
 * loop. Redirects to /build?screen=account so the billing/account UI renders.
 *
 * Public (allowlisted in middleware.ts) so the redirect works for anonymous
 * users too — they land on /build and see the sign-in gate naturally.
 */

import { redirect } from 'next/navigation'

export default function BillingPage() {
  redirect('/build?screen=account')
}
