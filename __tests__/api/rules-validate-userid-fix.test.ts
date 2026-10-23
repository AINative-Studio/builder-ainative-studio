import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/rules/validate (#1213) — fixes a real, live-breaking bug found
 * while investigating rules/stats + rules/violations (both read-only
 * consumers of the SAME persistence this route writes).
 *
 * The route used to trust a client-supplied `userId`. The only real caller
 * (app/settings/rules/page.tsx's Validation Playground) always sent the
 * literal string 'playground'. enforcement_reports.user_id and
 * rule_violations.user_id are both NOT NULL `uuid` columns with a real FK
 * into users(id) (lib/db/schema.ts) — 'playground' is not a valid UUID and
 * matches no user row, so dbService.saveReport()/recordViolation() threw a
 * Postgres error on every real validate call, 500ing before a report was
 * ever returned. This was a structural bug independent of #1213, but meant
 * rules/stats + rules/violations could never show real data without it.
 *
 * Fix: userId is now resolved from the real signed-in session, never the
 * request body, which also closes an unauthenticated write path.
 */

const h = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))

const svc = vi.hoisted(() => ({
  getRuleEnforcementService: vi.fn(),
  getRuleEnforcementDbService: vi.fn(),
}))
vi.mock('@/lib/services/rule-enforcement.service', () => ({
  getRuleEnforcementService: svc.getRuleEnforcementService,
}))
vi.mock('@/lib/services/rule-enforcement-db.service', () => ({
  getRuleEnforcementDbService: svc.getRuleEnforcementDbService,
}))

function postReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/rules/validate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/rules/validate — userId resolution (#1213)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an unauthenticated caller with 401, never touching the DB service', async () => {
    h.auth.mockResolvedValue(null)

    const { POST } = await import('@/app/api/rules/validate/route')
    const res = await POST(postReq({ type: 'commit', data: { commitMessage: 'x' }, projectId: 'playground' }))

    expect(res.status).toBe(401)
    expect(svc.getRuleEnforcementDbService).not.toHaveBeenCalled()
  })

  it('uses the REAL session user id for persistence, ignoring any client-supplied userId', async () => {
    h.auth.mockResolvedValue({ user: { id: 'real-user-uuid-123' } })

    const saveReport = vi.fn().mockResolvedValue({})
    const recordViolation = vi.fn().mockResolvedValue({})
    svc.getRuleEnforcementDbService.mockReturnValue({ saveReport, recordViolation })
    svc.getRuleEnforcementService.mockReturnValue({
      config: { projectId: 'playground' },
      initialize: vi.fn(),
      validateAction: vi.fn().mockResolvedValue({
        action: { type: 'commit', data: {}, userId: 'real-user-uuid-123', projectId: 'playground', timestamp: new Date() },
        results: [{ ruleId: 'no-ai-attribution', passed: false, violations: [{ ruleId: 'no-ai-attribution', level: 'error', message: 'bad', autoFixable: false }], duration: 1 }],
        passed: false,
        errorCount: 1,
        warningCount: 0,
        infoCount: 0,
        totalDuration: 1,
        canAutoFix: false,
        suggestions: [],
      }),
    })

    const { POST } = await import('@/app/api/rules/validate/route')
    const res = await POST(postReq({
      type: 'commit',
      data: { commitMessage: 'feat: x' },
      // A malicious/stale client-supplied userId — must be ignored entirely.
      userId: 'playground',
      projectId: 'playground',
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)

    // The real session id, NEVER 'playground', reaches persistence.
    expect(saveReport).toHaveBeenCalledWith('real-user-uuid-123', 'playground', expect.anything())
    expect(recordViolation).toHaveBeenCalledWith('no-ai-attribution', 'real-user-uuid-123', expect.anything(), expect.anything())
  })
})
