import { describe, it, expect } from 'vitest'
import { buildMeters, formatResetLine } from '@/components/build/screens/Account'

/**
 * #312 — Account "Usage this month" meters read the live credit ledger via
 * /api/credits. The hardcoded 3400/10000 mock array is gone; these tests assert
 * the pure mapping (buildMeters/formatResetLine) that drives the render.
 */

describe('buildMeters (#312 live ledger)', () => {
  it('returns null when no ledger data is present (graceful zero state)', () => {
    expect(buildMeters(undefined, undefined)).toBeNull()
    expect(buildMeters({}, null)).toBeNull()
  })

  it('builds the API credits meter from live granted/used', () => {
    const meters = buildMeters({ granted: 10000, used: 250, remaining: 9750 }, null)!
    const api = meters.find((m) => m.label === 'API credits')!
    expect(api.used).toBe(250)
    expect(api.total).toBe(10000)
  })

  it('never surfaces the old hardcoded 3400 / 10000 mock numbers', () => {
    const meters = buildMeters({ granted: 500, used: 42 }, null)!
    const api = meters.find((m) => m.label === 'API credits')!
    expect(api.used).not.toBe(3400)
    expect(api.total).not.toBe(10000)
    expect(api.used).toBe(42)
    expect(api.total).toBe(500)
  })

  it('adds an LLM tokens meter only when usage reports real token figures', () => {
    const withTokens = buildMeters({ granted: 100, used: 10 }, { tokens_used: 1200, tokens_limit: 5000 })!
    expect(withTokens.some((m) => m.label === 'LLM tokens')).toBe(true)
    const tok = withTokens.find((m) => m.label === 'LLM tokens')!
    expect(tok.used).toBe(1200)
    expect(tok.total).toBe(5000)

    const noTokens = buildMeters({ granted: 100, used: 10 }, null)!
    expect(noTokens.some((m) => m.label === 'LLM tokens')).toBe(false)
  })

  it('handles a used-only ledger (granted absent)', () => {
    const meters = buildMeters({ used: 7 }, null)!
    const api = meters.find((m) => m.label === 'API credits')!
    expect(api.used).toBe(7)
    expect(api.total).toBe(0)
  })
})

describe('formatResetLine (#312)', () => {
  it('formats a real ISO reset date', () => {
    expect(formatResetLine('2026-09-01T00:00:00Z')).toMatch(/Resets/)
  })

  it('returns null (hidden) when the reset date is unknown', () => {
    expect(formatResetLine(null)).toBeNull()
    expect(formatResetLine('')).toBeNull()
    expect(formatResetLine('not-a-date')).toBeNull()
    expect(formatResetLine(undefined)).toBeNull()
  })

  it('never shows the old hardcoded "Resets in 12 days" copy', () => {
    expect(formatResetLine('2026-09-01T00:00:00Z')).not.toContain('12 days')
  })
})
