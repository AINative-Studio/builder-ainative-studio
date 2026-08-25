/**
 * /profile — SPA-internal (profile lives in the account screen). Thin redirect
 * so direct links don't 404 (#83). Public (allowlisted in middleware.ts).
 */
import { redirect } from 'next/navigation'

export default function ProfilePage() {
  redirect('/build?screen=account')
}
