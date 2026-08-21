import { describe, it, expect } from 'vitest'
import { rollup, type LearningRow } from '@/lib/build/learning'

const row = (o: Partial<LearningRow>): LearningRow => ({
  slug: o.slug || 'slug',
  idea: o.idea,
  brand: o.brand,
  track: o.track,
  chatId: o.chatId,
  codeStatus: o.codeStatus,
  domainFound: o.domainFound,
  plan: o.plan,
  keyKind: o.keyKind,
  converted: o.converted ?? false,
  createdAt: o.createdAt || '2026-08-20T00:00:00.000Z',
})

describe('rollup (#270 recursive learning)', () => {
  it('counts distinct builds by slug and merges a later conversion row', () => {
    // Rows arrive newest-first (as readLearningRows sorts them).
    const rows: LearningRow[] = [
      row({ slug: 'acme', converted: true, plan: 'business', createdAt: '2026-08-20T10:00:00Z' }),
      row({ slug: 'acme', idea: 'a crm for plumbers', brand: 'Acme', track: 'company', codeStatus: 'success', createdAt: '2026-08-20T09:00:00Z' }),
      row({ slug: 'nova', idea: 'a habit tracker', brand: 'Nova', track: 'company', codeStatus: 'success', converted: false, createdAt: '2026-08-20T08:00:00Z' }),
    ]
    const r = rollup(rows)
    expect(r.totalBuilds).toBe(2)
    expect(r.converted).toBe(1)
    expect(r.conversionRate).toBeCloseTo(0.5)
    // non-converter list surfaces nova's idea, not acme's (it converted)
    expect(r.nonConverterIdeas.map((n) => n.slug)).toEqual(['nova'])
    expect(r.nonConverterIdeas[0].idea).toBe('a habit tracker')
  })

  it('computes codegen failure rate only over rows that have a status', () => {
    const rows: LearningRow[] = [
      row({ slug: 'a', codeStatus: 'failure' }),
      row({ slug: 'b', codeStatus: 'success' }),
      row({ slug: 'c', codeStatus: 'success' }),
      row({ slug: 'd' }), // no status → excluded from denominator
    ]
    const r = rollup(rows)
    expect(r.totalBuilds).toBe(4)
    expect(r.codegenFailureRate).toBeCloseTo(1 / 3)
  })

  it('treats a plan (paid) as converted even without an explicit converted flag', () => {
    const rows: LearningRow[] = [row({ slug: 'paid', plan: 'pro', converted: false })]
    const r = rollup(rows)
    expect(r.converted).toBe(1)
    expect(r.conversionRate).toBe(1)
    expect(r.nonConverterIdeas).toHaveLength(0)
  })

  it('splits builds/conversions by track', () => {
    const rows: LearningRow[] = [
      row({ slug: 'a', track: 'company', converted: true }),
      row({ slug: 'b', track: 'company' }),
      row({ slug: 'c', track: 'app', converted: true }),
    ]
    const r = rollup(rows)
    expect(r.byTrack.company).toEqual({ builds: 2, converted: 1 })
    expect(r.byTrack.app).toEqual({ builds: 1, converted: 1 })
  })

  it('is empty-safe', () => {
    const r = rollup([])
    expect(r.totalBuilds).toBe(0)
    expect(r.conversionRate).toBe(0)
    expect(r.codegenFailureRate).toBe(0)
    expect(r.nonConverterIdeas).toEqual([])
  })
})
