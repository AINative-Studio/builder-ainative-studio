import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/rules/auto-fix + POST /api/rules/validate (#1193)
 *
 * The auto-fix route carried this dead loop:
 *
 *   // Mark violations as fixed in database
 *   for (const violation of fixableViolations) {
 *     // In a real implementation, we'd have violation IDs from the database
 *     // For now, we'll just track that auto-fix was applied
 *   }
 *
 * It ran, did nothing, and the route still answered
 * `Auto-fixed N violation(s)`. markViolationFixed() was never called, so
 * every auto-fixed violation stayed `pending` forever and
 * /api/rules/stats's autoFixed/fixed/pending counts were permanently wrong.
 *
 * The missing piece was only the id plumbing: recordViolation() already
 * `.returning()`s the persisted row, /api/rules/validate was throwing that
 * away, so no caller could ever name a violation to mark. validate now
 * returns each violation's real `violationId`, and auto-fix marks the ones
 * it is given.
 */

const h = vi.hoisted(() => ({
  getRuleEnforcementService: vi.fn(),
  getRuleEnforcementDbService: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/lib/services/rule-enforcement.service', () => ({
  getRuleEnforcementService: h.getRuleEnforcementService,
}))
vi.mock('@/lib/services/rule-enforcement-db.service', () => ({
  getRuleEnforcementDbService: h.getRuleEnforcementDbService,
}))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))

function postReq(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ACTION = {
  type: 'commit',
  data: { commitMessage: 'feat: add thing' },
  userId: 'user-1',
  projectId: 'proj-1',
}

describe('POST /api/rules/auto-fix — marks the violations it fixed', () => {
  let markViolationFixed: ReturnType<typeof vi.fn>
  let autoFixViolations: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    markViolationFixed = vi.fn().mockResolvedValue(undefined)
    autoFixViolations = vi.fn().mockResolvedValue({
      ...ACTION,
      data: { commitMessage: 'feat: add thing (cleaned)' },
    })
    h.getRuleEnforcementService.mockReturnValue({ autoFixViolations })
    h.getRuleEnforcementDbService.mockReturnValue({ markViolationFixed })
  })

  it('calls markViolationFixed with the real violation id and auto fix method', async () => {
    const { POST } = await import('@/app/api/rules/auto-fix/route')

    const res = await POST(
      postReq('http://localhost/api/rules/auto-fix', {
        action: ACTION,
        violations: [
          {
            violationId: 'viol-abc',
            ruleId: 'git/no-ai-attribution',
            level: 'error',
            message: 'AI attribution found',
            autoFixable: true,
          },
        ],
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(markViolationFixed).toHaveBeenCalledTimes(1)
    expect(markViolationFixed).toHaveBeenCalledWith(
      'viol-abc',
      'auto',
      expect.any(Number)
    )

    // The response now reports what was actually persisted, not just a count
    // of what it attempted.
    expect(json.fixedCount).toBe(1)
    expect(json.markedFixedCount).toBe(1)
    expect(json.unmarkedCount).toBe(0)
  })

  it('does not mark non-auto-fixable violations', async () => {
    const { POST } = await import('@/app/api/rules/auto-fix/route')

    await POST(
      postReq('http://localhost/api/rules/auto-fix', {
        action: ACTION,
        violations: [
          {
            violationId: 'viol-fixable',
            ruleId: 'git/no-ai-attribution',
            level: 'error',
            message: 'AI attribution found',
            autoFixable: true,
          },
          {
            violationId: 'viol-manual',
            ruleId: 'testing/require-tests',
            level: 'error',
            message: 'No tests',
            autoFixable: false,
          },
        ],
      })
    )

    expect(markViolationFixed).toHaveBeenCalledTimes(1)
    expect(markViolationFixed).toHaveBeenCalledWith(
      'viol-fixable',
      'auto',
      expect.any(Number)
    )
  })

  it('reports honestly when a fixable violation carries no persisted id to mark', async () => {
    const { POST } = await import('@/app/api/rules/auto-fix/route')

    const res = await POST(
      postReq('http://localhost/api/rules/auto-fix', {
        action: ACTION,
        violations: [
          {
            // No violationId — an unpersisted violation (e.g. a caller that
            // never went through /api/rules/validate).
            ruleId: 'git/no-ai-attribution',
            level: 'error',
            message: 'AI attribution found',
            autoFixable: true,
          },
        ],
      })
    )
    const json = await res.json()

    expect(markViolationFixed).not.toHaveBeenCalled()
    // The code fix still happened...
    expect(json.fixedCount).toBe(1)
    // ...but the route does not pretend the database was updated.
    expect(json.markedFixedCount).toBe(0)
    expect(json.unmarkedCount).toBe(1)
  })

  it('still returns the fixed action when marking fails, and says marking did not complete', async () => {
    markViolationFixed.mockRejectedValue(new Error('relation does not exist'))
    const { POST } = await import('@/app/api/rules/auto-fix/route')

    const res = await POST(
      postReq('http://localhost/api/rules/auto-fix', {
        action: ACTION,
        violations: [
          {
            violationId: 'viol-abc',
            ruleId: 'git/no-ai-attribution',
            level: 'error',
            message: 'AI attribution found',
            autoFixable: true,
          },
        ],
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    // The auto-fixed action is the valuable part and must survive.
    expect(json.action.data.commitMessage).toBe('feat: add thing (cleaned)')
    expect(json.fixedCount).toBe(1)
    // But the route must not claim a database update that failed.
    expect(json.markedFixedCount).toBe(0)
    expect(json.unmarkedCount).toBe(1)
  })

  it('short-circuits with no marking when nothing is auto-fixable', async () => {
    const { POST } = await import('@/app/api/rules/auto-fix/route')

    const res = await POST(
      postReq('http://localhost/api/rules/auto-fix', {
        action: ACTION,
        violations: [
          {
            violationId: 'viol-manual',
            ruleId: 'testing/require-tests',
            level: 'error',
            message: 'No tests',
            autoFixable: false,
          },
        ],
      })
    )
    const json = await res.json()

    expect(json.fixedCount).toBe(0)
    expect(markViolationFixed).not.toHaveBeenCalled()
    expect(autoFixViolations).not.toHaveBeenCalled()
  })
})

describe('POST /api/rules/validate — returns the persisted violation ids', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('surfaces each violation real database id so auto-fix can mark it', async () => {
    const violation = {
      ruleId: 'git/no-ai-attribution',
      level: 'error',
      message: 'AI attribution found',
      autoFixable: true,
    }

    h.getRuleEnforcementService.mockReturnValue({
      config: {},
      initialize: vi.fn(),
      validateAction: vi.fn().mockResolvedValue({
        action: ACTION,
        passed: false,
        errorCount: 1,
        warningCount: 0,
        infoCount: 0,
        totalDuration: 5,
        canAutoFix: true,
        suggestions: ['remove attribution'],
        results: [{ ruleId: violation.ruleId, violations: [violation] }],
      }),
    })

    const recordViolation = vi.fn().mockResolvedValue({ id: 'viol-persisted-1' })
    h.getRuleEnforcementDbService.mockReturnValue({
      saveReport: vi.fn().mockResolvedValue({ id: 'report-1' }),
      recordViolation,
    })

    const { POST } = await import('@/app/api/rules/validate/route')
    const res = await POST(
      postReq('http://localhost/api/rules/validate', {
        type: 'commit',
        data: { commitMessage: 'feat: thing' },
        projectId: 'proj-1',
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(recordViolation).toHaveBeenCalledTimes(1)
    // The id from the real insert is handed back to the caller — this is the
    // plumbing whose absence made the auto-fix loop impossible to implement.
    expect(json.report.violations).toHaveLength(1)
    expect(json.report.violations[0].violationId).toBe('viol-persisted-1')
    expect(json.report.violations[0].ruleId).toBe('git/no-ai-attribution')
  })
})
