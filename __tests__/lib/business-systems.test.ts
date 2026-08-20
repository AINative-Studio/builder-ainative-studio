import { describe, it, expect } from 'vitest'
import { buildSystems } from '@/lib/build/business-systems'

describe('business-systems (#233)', () => {
  it('returns the 4 systems with real primitive names + URLs', () => {
    const s = buildSystems()
    expect(s.map((x) => x.key)).toEqual(['pipeline', 'invoices', 'helpdesk', 'voice'])
    expect(s.find((x) => x.key === 'pipeline')!.primitive).toBe('ZeroPipeline')
    expect(s.find((x) => x.key === 'invoices')!.primitive).toBe('ZeroInvoice')
    for (const x of s) expect(x.url).toMatch(/^https:\/\//)
  })

  it('shows honest zero-state for a fresh company', () => {
    const s = buildSystems()
    expect(s.find((x) => x.key === 'invoices')!.stat).toMatch(/\$0 collected/)
    expect(s.find((x) => x.key === 'helpdesk')!.stat).toMatch(/0 tickets/)
    expect(s.every((x) => x.count === 0)).toBe(true)
  })

  it('reflects real counts when the company has data', () => {
    const s = buildSystems({
      pipeline: { count: 5, value: 86000 },
      invoices: { value: 4200 },
      helpdesk: { count: 2 },
      voice: { count: 18 },
    })
    expect(s.find((x) => x.key === 'pipeline')!.stat).toBe('5 open · $86k')
    expect(s.find((x) => x.key === 'invoices')!.stat).toBe('$4.2k collected')
    expect(s.find((x) => x.key === 'helpdesk')!.stat).toBe('2 open tickets')
    expect(s.find((x) => x.key === 'voice')!.stat).toBe('18 calls')
  })
})
