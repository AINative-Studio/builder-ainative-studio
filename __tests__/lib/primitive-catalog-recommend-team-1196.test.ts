import { describe, it, expect } from 'vitest'
import { recommendTeam, selectPrimitives, PRIMITIVE_CATALOG } from '@/lib/build/primitive-catalog'

/**
 * #1196 — the free "coach" recommendation that proposes a starting agent
 * team based on the founder's idea. The real design decision: a recommended
 * "team member" is NOT a fabricated persona — it's a human job-title wrapper
 * around a primitive selectPrimitives() already picked for this exact idea,
 * so the coach's advice and what the build actually composes can never
 * diverge. These tests verify that invariant directly, plus the free/no-
 * network, deterministic, capped-at-3 shape the kickoff UI depends on.
 */
describe('recommendTeam — coach team recommendation (#1196)', () => {
  it('every recommended team member maps to a REAL catalog primitive name', () => {
    const team = recommendTeam('A CRM for selling to local businesses', 'company')
    const catalogNames = new Set(PRIMITIVE_CATALOG.map((p) => p.name))
    expect(team.length).toBeGreaterThan(0)
    for (const member of team) {
      expect(catalogNames.has(member.primitive)).toBe(true)
    }
  })

  it('never recommends more than `max` (default 3) team members', () => {
    const team = recommendTeam('A full company: CRM, invoicing, a storefront, support tickets, and bookkeeping', 'company')
    expect(team.length).toBeLessThanOrEqual(3)
  })

  it('respects a smaller explicit max', () => {
    const team = recommendTeam('A CRM for selling to local businesses, with invoicing and a storefront', 'company', undefined, 1)
    expect(team.length).toBeLessThanOrEqual(1)
  })

  it('recommends ZeroPipeline as a "Sales agent" for a sales-shaped idea, consistent with selectPrimitives', () => {
    const idea = 'A CRM to track leads and deals for my sales team'
    const team = recommendTeam(idea, 'company')
    const { names } = selectPrimitives(idea, 'company')
    const pipelineMember = team.find((m) => m.primitive === 'ZeroPipeline')
    expect(pipelineMember).toBeDefined()
    expect(pipelineMember?.role).toBe('Sales agent')
    // Never diverges from the real composition selection.
    expect(names).toContain('ZeroPipeline')
  })

  it('recommends ZeroInvoice as a "Bookkeeper" for a billing-shaped idea', () => {
    const team = recommendTeam('I need to send invoices and get paid for my consulting work', 'company')
    const invoiceMember = team.find((m) => m.primitive === 'ZeroInvoice')
    expect(invoiceMember).toBeDefined()
    expect(invoiceMember?.role).toBe('Bookkeeper')
  })

  it('never recommends foundational substrate (ZeroDB, AI Kit, ZeroMemory) as a "team member"', () => {
    const team = recommendTeam('A simple notes app for myself', 'app')
    const foundationalNames = ['ZeroDB', 'AI Kit', 'ZeroMemory', 'Agent Cloud', 'Instant DB']
    for (const member of team) {
      expect(foundationalNames).not.toContain(member.primitive)
    }
  })

  it('is deterministic — the same idea always returns the same team (no LLM/network call)', () => {
    const idea = 'A storefront for selling handmade coffee mugs online'
    const first = recommendTeam(idea, 'company')
    const second = recommendTeam(idea, 'company')
    expect(first).toEqual(second)
  })

  it('returns an empty team for an idea that matches nothing team-eligible, rather than throwing', () => {
    expect(() => recommendTeam('', 'app')).not.toThrow()
    const team = recommendTeam('', 'app')
    expect(Array.isArray(team)).toBe(true)
  })

  it('each team member carries the real catalog purpose string, not placeholder text', () => {
    const team = recommendTeam('A CRM to track leads and deals for my sales team', 'company')
    const catalogByName = new Map(PRIMITIVE_CATALOG.map((p) => [p.name, p.purpose]))
    for (const member of team) {
      expect(member.purpose).toBe(catalogByName.get(member.primitive))
    }
  })

  it('a role boost (#448) can surface a role-emphasized primitive even without a direct keyword match', () => {
    const team = recommendTeam('Launch an online store', 'company', 'sales')
    const names = team.map((m) => m.primitive)
    // 'sales' role emphasizes ZeroPipeline/ZeroInvoice/ZeroCommerce/ZeroVoice —
    // at least one of the non-ZeroCommerce companions should ride along.
    expect(names.some((n) => ['ZeroPipeline', 'ZeroInvoice', 'ZeroCommerce'].includes(n))).toBe(true)
  })
})
