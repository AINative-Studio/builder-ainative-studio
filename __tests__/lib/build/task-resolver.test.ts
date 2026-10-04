import { describe, it, expect } from 'vitest'
import { decideOutcomeFromCoverage, buildTaskIssueBody } from '@/lib/build/task-resolver'

/**
 * #374 (epic #371) — pure-logic tests for the coverage→stage decision.
 * See task-resolver-io.test.ts for the full mocked end-to-end pipeline tests.
 */

describe('decideOutcomeFromCoverage', () => {
  it('accepts a genuinely untestable app (no test suite) on implementation alone — never blocked on an impossible number', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: null, testable: false, passed: false })
    expect(result.stage).toBe('completed')
    expect(result.reason).toMatch(/no test suite/i)
  })

  it('#917: never auto-completes when testable:false means the sandbox refused, not "no tests exist"', () => {
    const result = decideOutcomeFromCoverage({
      coveragePercent: null,
      testable: false,
      passed: false,
      reason: 'E2B not configured — sandboxed execution required for untrusted code',
      sandboxRefused: true,
    })
    expect(result.stage).toBe('failed')
    expect(result.reason).toMatch(/sandbox/i)
  })

  it('fails when tests genuinely did not pass', () => {
    const result = decideOutcomeFromCoverage({
      coveragePercent: 90, testable: true, passed: false, reason: 'Test run exited with code 1',
    })
    expect(result.stage).toBe('failed')
    expect(result.reason).toBe('Test run exited with code 1')
  })

  it('fails honestly when tests passed but coverage could not be measured — never fabricates a number to force a pass', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: null, testable: true, passed: true })
    expect(result.stage).toBe('failed')
    expect(result.reason).toMatch(/could not be measured/i)
  })

  it('fails when a REAL coverage number is below the floor', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: 42, testable: true, passed: true })
    expect(result.stage).toBe('failed')
    expect(result.reason).toMatch(/42%/)
    expect(result.reason).toMatch(/80%/)
  })

  it('completes when a REAL coverage number meets the floor', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: 85, testable: true, passed: true })
    expect(result.stage).toBe('completed')
    expect(result.reason).toMatch(/85%/)
  })

  it('completes when coverage is exactly at the floor (>= not >)', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: 80, testable: true, passed: true })
    expect(result.stage).toBe('completed')
  })

  it('respects a custom floor override', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: 70, testable: true, passed: true }, 60)
    expect(result.stage).toBe('completed')
  })
})

/**
 * #905 — "No Code Without An Issue" (.ainative/ISSUE_TRACKING_ENFORCEMENT.md's
 * Golden Rule). buildTaskIssueBody() renders the issue body resolveTask() opens
 * on the company's own Gitea repo BEFORE implementation begins.
 */
describe('buildTaskIssueBody (#905)', () => {
  it('includes the problem/context drawn from the task title and detail', () => {
    const body = buildTaskIssueBody({ title: 'Add dark mode', detail: 'Founder asked for a toggle in settings.', storyPoints: null, estimateRationale: null })
    expect(body).toContain('Add dark mode')
    expect(body).toContain('Founder asked for a toggle in settings.')
    expect(body).toMatch(/## Problem\/Context/)
  })

  it('falls back to the title alone when detail is absent', () => {
    const body = buildTaskIssueBody({ title: 'Add dark mode', storyPoints: null, estimateRationale: null })
    expect(body).toContain('Add dark mode')
    expect(body).not.toMatch(/undefined/)
  })

  it('includes an honest acceptance criteria section', () => {
    const body = buildTaskIssueBody({ title: 'Add dark mode', storyPoints: null, estimateRationale: null })
    expect(body).toMatch(/## Acceptance Criteria/)
  })
})

/**
 * #906 — attach the task's REAL Fibonacci estimate (#902) + rationale to the
 * issue body opened by #905, matching ISSUE_TRACKING_ENFORCEMENT.md's required
 * "## Estimate" template section (Story Points / Rationale). A task with no
 * estimate yet (storyPoints: null — a pre-#902 row, or a failed estimation
 * call) must show an honest "unestimated" state, never a fabricated number.
 */
describe('buildTaskIssueBody — estimate section (#906)', () => {
  it('includes the real Fibonacci story points and rationale when the task has an estimate', () => {
    const body = buildTaskIssueBody({
      title: 'Add dark mode',
      storyPoints: 3,
      estimateRationale: 'Moderate — one clear feature slice across settings + theme provider.',
    })
    expect(body).toMatch(/## Estimate/)
    expect(body).toMatch(/\*\*Story Points:\*\*\s*3/)
    expect(body).toContain('Moderate — one clear feature slice across settings + theme provider.')
  })

  it('renders each of the six canonical Fibonacci values verbatim (0 included — falsy but valid)', () => {
    for (const points of [0, 1, 2, 3, 5, 8] as const) {
      const body = buildTaskIssueBody({ title: 'T', storyPoints: points, estimateRationale: 'r' })
      expect(body).toMatch(new RegExp(`\\*\\*Story Points:\\*\\*\\s*${points}\\b`))
    }
  })

  it('shows an honest "unestimated" state when storyPoints is null — never fabricates a number', () => {
    const body = buildTaskIssueBody({ title: 'Add dark mode', storyPoints: null, estimateRationale: null })
    expect(body).toMatch(/## Estimate/)
    expect(body).toMatch(/\*\*Story Points:\*\*\s*Unestimated/i)
    expect(body).not.toMatch(/\*\*Story Points:\*\*\s*\d/)
  })

  it('shows an honest unestimated state when storyPoints is null even if a stray rationale string is present', () => {
    // Defensive: task-store.ts's own invariant keeps these null together, but
    // buildTaskIssueBody must not trust an inconsistent rationale alone to
    // fabricate a number — null storyPoints always wins.
    const body = buildTaskIssueBody({ title: 'Add dark mode', storyPoints: null, estimateRationale: 'stray text' })
    expect(body).toMatch(/\*\*Story Points:\*\*\s*Unestimated/i)
  })

  it('omits a rationale line when unestimated rather than printing "null" or "undefined"', () => {
    const body = buildTaskIssueBody({ title: 'Add dark mode', storyPoints: null, estimateRationale: null })
    expect(body).not.toMatch(/null/i)
    expect(body).not.toMatch(/undefined/i)
  })

  it('still includes Problem/Context and Acceptance Criteria alongside the new Estimate section', () => {
    const body = buildTaskIssueBody({ title: 'Add dark mode', storyPoints: 1, estimateRationale: 'Tiny, single-file.' })
    expect(body).toMatch(/## Problem\/Context/)
    expect(body).toMatch(/## Acceptance Criteria/)
    expect(body).toMatch(/## Estimate/)
  })

  it('defaults to an unestimated state when storyPoints/estimateRationale are omitted entirely (back-compat callers)', () => {
    const body = buildTaskIssueBody({ title: 'Add dark mode' })
    expect(body).toMatch(/\*\*Story Points:\*\*\s*Unestimated/i)
  })
})
