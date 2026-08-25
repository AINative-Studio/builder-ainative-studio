/**
 * /settings — SPA-internal (settings lives in the account screen). Thin redirect
 * so direct links don't 404 (#83). Public (allowlisted in middleware.ts).
 */
import { redirect } from 'next/navigation'

export default function SettingsPage() {
  redirect('/build?screen=account')
}
