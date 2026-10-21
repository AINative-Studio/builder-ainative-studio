import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/rules/violations (#1213) — violation history with filtering, a
 * complete implementation with zero frontend callers before this issue.
 * Wired to the new Violation History card on /settings/rules.
 */

const svc = vi.hoisted(() => ({ getRuleEnforcementDbService: vi.fn() }))
vi.mock('@/lib/services/rule-enforcement-db.service', () => ({
  getRuleEnforcementDbService: svc.getRuleEnforcementDbService,
}))

function getReq(url: string) {
  return new NextRequest(url)
}

describe('GET /api/rules/violations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns real violations plus stats, filtered by projectId', async () => {
    const getViolations = vi.fn().mockResolvedValue([
      { id: 'v1', rule_id: 'no-ai-attribution', violation_message: 'bad', fixed: false },
    ])
    const getViolationStats = vi.fn().mockResolvedValue({ total: 1, fixed: 0, unfixed: 1 })
    svc.getRuleEnforcementDbService.mockReturnValue({ getViolations, getViolationStats })

    const { GET } = await import('@/app/api/rules/violations/route')
    const res = await GET(getReq('http://localhost/api/rules/violations?projectId=playground&limit=20'))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.count).toBe(1)
    expect(getViolations).toHaveBeenCalledWith({ userId: undefined, projectId: 'playground', ruleId: undefined, fixed: undefined, limit: 20 })
  })

  it('passes the fixed=true/false filter through as a real boolean, not a string', async () => {
    const getViolations = vi.fn().mockResolvedValue([])
    svc.getRuleEnforcementDbService.mockReturnValue({
      getViolations,
      getViolationStats: vi.fn().mockResolvedValue({}),
    })

    const { GET } = await import('@/app/api/rules/violations/route')
    await GET(getReq('http://localhost/api/rules/violations?fixed=true'))

    expect(getViolations).toHaveBeenCalledWith(expect.objectContaining({ fixed: true }))
  })

  it('returns a clean 500 (not a crash) when the DB service throws', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      getViolations: vi.fn().mockRejectedValue(new Error('db down')),
      getViolationStats: vi.fn(),
    })

    const { GET } = await import('@/app/api/rules/violations/route')
    const res = await GET(getReq('http://localhost/api/rules/violations'))

    expect(res.status).toBe(500)
  })
})
