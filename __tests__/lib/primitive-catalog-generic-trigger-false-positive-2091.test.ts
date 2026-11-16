import { describe, it, expect } from 'vitest'
import { recommendTeam, selectPrimitives } from '@/lib/build/primitive-catalog'

/**
 * #2091 — the kickoff "coach" team recommendation (recommendTeam, which
 * reuses selectPrimitives' deterministic trigger scoring) suggested a team
 * member semantically unrelated to the idea, because a single overly-generic
 * trigger word matched: 'customers' (ZeroPipeline, a CRM/sales-pipeline
 * primitive) and 'booking' (Intent-Casting Marketplace, a two-sided
 * marketplace primitive). Both reproduced live against two unrelated real
 * ideas. Fix: removed those two triggers; every remaining trigger on each
 * primitive is a much stronger, more specific signal.
 */
describe('recommendTeam / selectPrimitives — no false-positive match on a lone generic word (#2091)', () => {
  it('a cafe customer-feedback-board idea does not recommend ZeroPipeline (Sales agent) merely for saying "customers"', () => {
    const idea =
      'A simple customer feedback board for a small cafe: customers submit feedback with a star rating, and the owner can view all feedback in a dashboard sorted by rating.'
    const { names } = selectPrimitives(idea, 'company')
    expect(names).not.toContain('ZeroPipeline')
    const team = recommendTeam(idea, 'company')
    expect(team.find((m) => m.primitive === 'ZeroPipeline')).toBeUndefined()
  })

  it('a solo-hairdresser appointment booking widget does not recommend Intent-Casting Marketplace merely for saying "booking"', () => {
    const idea =
      'A simple appointment booking widget for a solo hairdresser: clients pick an available time slot and book it, and the stylist can see all upcoming bookings in one place.'
    const { names } = selectPrimitives(idea, 'company')
    expect(names).not.toContain('Intent-Casting Marketplace')
    const team = recommendTeam(idea, 'company')
    expect(team.find((m) => m.primitive === 'Intent-Casting Marketplace')).toBeUndefined()
  })

  it('a genuinely CRM/sales-shaped idea still selects ZeroPipeline via its other, stronger triggers', () => {
    const idea = 'A CRM to track leads and deals for my sales team'
    const { names } = selectPrimitives(idea, 'company')
    expect(names).toContain('ZeroPipeline')
  })

  it('a genuinely two-sided marketplace idea still selects Intent-Casting Marketplace via its other, stronger triggers', () => {
    const idea = 'A two-sided marketplace matching buyers and sellers of freelance gig services'
    const { names } = selectPrimitives(idea, 'company')
    expect(names).toContain('Intent-Casting Marketplace')
  })
})
