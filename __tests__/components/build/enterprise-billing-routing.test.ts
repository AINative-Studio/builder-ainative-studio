import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real gap (customer-reported, 2026-09-09, Vamsi — enterprise account with
 * companies Ledra/Pathlo/Voya, screenshot of /?view=preview "My companies"):
 * every "Manage plan" link on MyCompanies and Live unconditionally opened
 * Builder's own Stripe-portal proxy (/api/build/subscription/portal), which
 * has no real customer to manage for Enterprise — that billing is a
 * contract/invoice relationship on the AINative dashboard, not Stripe
 * self-serve (already fixed for the AINative-staff-admin case in Account.tsx,
 * 2026-09-08, but never applied to MyCompanies/Live nor to real, non-staff
 * Enterprise subscribers). Enterprise accounts must route to
 * ainative.studio/billing; everyone else keeps the in-Builder self-serve
 * upgrade/cancel portal.
 */
describe('MyCompanies screen — enterprise accounts route to the real AINative dashboard', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/MyCompanies.tsx'),
    'utf8',
  )

  it('derives isEnterpriseBilling from the hydrated account plan', () => {
    expect(source).toMatch(/isEnterpriseBilling = state\.activePlan === 'enterprise'/)
  })

  it('the header-level "Manage plan / billing" link is conditional on isEnterpriseBilling', () => {
    const idx = source.indexOf('{isEnterpriseBilling ? (')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 300)
    expect(nearby).toContain('https://ainative.studio/billing')
  })

  it('the per-company "Manage plan" button also checks the company\'s own plan, not just the account plan', () => {
    expect(source).toMatch(/isEnterpriseBilling \|\| c\.plan === 'enterprise'/)
  })

  it('every ainative.studio billing link opens in a new tab with a safe rel', () => {
    const matches = [...source.matchAll(/href="https:\/\/ainative\.studio\/billing"/g)]
    expect(matches.length).toBeGreaterThanOrEqual(2)
    for (const m of matches) {
      const nearby = source.slice(m.index!, m.index! + 150)
      expect(nearby).toMatch(/target="_blank"/)
      expect(nearby).toMatch(/rel="noopener noreferrer"/)
    }
  })

  it('non-enterprise founders still get the working Builder self-serve portal button', () => {
    expect(source).toContain("data-testid=\"manage-billing\"")
    expect(source).toMatch(/onClick=\{manageBilling\}/)
  })
})

describe('Live screen — enterprise accounts route to the real AINative dashboard', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('the "Manage plan" link on the paid-plan funnel banner is conditional on activePlan === enterprise', () => {
    const idx = source.indexOf("activePlan === 'enterprise' ? (")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 600)
    expect(nearby).toContain('https://ainative.studio/billing')
    expect(nearby).toMatch(/target="_blank"/)
    expect(nearby).toMatch(/rel="noopener noreferrer"/)
  })

  it('non-enterprise founders still get the working Builder self-serve portal button', () => {
    expect(source).toMatch(/data-testid="manage-plan"[\s\S]{0,20}onClick=\{manageBilling\}/)
  })
})
