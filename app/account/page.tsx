/**
 * /account — SPA-internal screen (GOTO_SCREEN screen:'account'). This thin route
 * catches direct navigation / deep-links so they don't 404 (#83). Redirects to
 * /build?screen=account. Public (allowlisted in middleware.ts).
 */
import { redirect } from 'next/navigation'

export default function AccountPage() {
  redirect('/build?screen=account')
}
