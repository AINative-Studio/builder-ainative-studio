/**
 * /refer — SPA-internal Refer & Earn screen (GOTO_SCREEN screen:'refer', #59).
 * Thin redirect so direct/shared referral links don't 404 (#83). Public
 * (allowlisted in middleware.ts).
 */
import { redirect } from 'next/navigation'

export default function ReferPage() {
  redirect('/build?screen=refer')
}
