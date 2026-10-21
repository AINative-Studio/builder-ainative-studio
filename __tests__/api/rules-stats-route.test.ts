import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/rules/stats (#1213) — comprehensive enforcement statistics, a
 * complete implementation with zero frontend callers before this issue.
 * Confirmed its backing service (rule-enforcement-db.service.ts) and tables
 * (enforcement_reports, rule_violations — lib/db/schema.ts) are real and
 * current. Wired to a new Violation History card on /settings/rules.
 */

const svc = vi.hoisted(() => ({ getRuleEnforcementDbService: vi.fn() }))
vi.mock('@/lib/services/rule-enforcement-db.service', () => ({
  getRuleEnforcementDbService: svc.getRuleEnforcementDbService,
}))

function getReq(url: string) {
  return new NextRequest(url)
}

describe('GET /api/rules/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('computes report pass-rate and top-violated-rules from the real DB service', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      getViolationStats: vi.fn().mockResolvedValue({ total: 3, fixed: 1, unfixed: 2 }),
      getReports: vi.fn().mockResolvedValue([{ passed: true }, { passed: false }, { passed: true }]),
      getViolations: vi.fn().mockResolvedValue([
        { rule_id: 'no-ai-attribution' },
        { rule_id: 'no-ai-attribution' },
        { rule_id: 'tdd-first' },
      ]),
    })

    const { GET } = await import('@/app/api/rules/stats/route')
    const res = await GET(getReq('http://localhost/api/rules/stats?projectId=playground'))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.stats.reports.total).toBe(3)
    expect(data.stats.reports.passed).toBe(2)
    expect(data.stats.reports.passRate).toBeCloseTo(66.67, 1)
    expect(data.stats.topViolatedRules[0]).toEqual({ ruleId: 'no-ai-attribution', count: 2 })
  })

  it('returns a clean 500 (not a crash) when the DB service throws', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      getViolationStats: vi.fn().mockRejectedValue(new Error('db down')),
      getReports: vi.fn(),
      getViolations: vi.fn(),
    })

    const { GET } = await import('@/app/api/rules/stats/route')
    const res = await GET(getReq('http://localhost/api/rules/stats'))

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.success).toBe(false)
  })
})
