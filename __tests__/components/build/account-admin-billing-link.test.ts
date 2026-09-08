import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * 2026-09-08 — an AINative admin's "Enterprise" plan (lib/ainative/active-
 * plan.ts's staff bypass, rawPlan: 'admin') has no real Stripe customer
 * behind it. Confirmed live: clicking "Manage plan / billing" correctly
 * returned "No active Stripe subscription found" for such an account — the
 * button was never going to succeed. Account.tsx now reads `admin` from
 * GET /api/build/subscription/status and, for an admin, replaces the
 * Stripe-portal button with a link to the real AINative platform billing
 * dashboard (ainative.studio/billing) instead of a button that can only fail.
 */
describe('Account screen — AINative admin billing link (2026-09-08)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Account.tsx'),
    'utf8',
  )

  it('reads `admin` from the subscription/status response', () => {
    expect(source).toMatch(/d\?\.admin === true/)
  })

  it('links to the real ainative.studio billing dashboard for admins', () => {
    expect(source).toContain('https://ainative.studio/billing')
  })

  it('opens the admin billing link in a new tab with a safe rel', () => {
    expect(source).toMatch(/href="https:\/\/ainative\.studio\/billing"[\s\S]{0,120}target="_blank"/)
    expect(source).toMatch(/rel="noopener noreferrer"/)
  })

  it('gates the admin link behind isAinativeAdmin, not shown unconditionally', () => {
    expect(source).toMatch(/isAinativeAdmin \?[\s\S]{0,600}ainative\.studio\/billing/)
  })
})
