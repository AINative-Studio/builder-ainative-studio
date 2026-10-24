// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EnforcementDashboard } from '@/components/enforcement/enforcement-dashboard'
import type { EnforcementReport, RuleCheckResult, RuleViolation } from '@/lib/types/enforcement-rules'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — EnforcementDashboard (components/enforcement/
 * enforcement-dashboard.tsx, 255 lines, reached live via
 * app/settings/rules/page.tsx) had zero test coverage. RuleViolationList
 * (its own child, also untested) is mocked at its real exported boundary —
 * out of scope for this pass — so this file verifies only
 * EnforcementDashboard's own pass-rate calculation, banner/footer gating,
 * and apply-fixes loading state.
 */

vi.mock('@/components/enforcement/rule-violation-list', () => ({
  RuleViolationList: ({ violations, onAutoFix, onIgnore }: any) =>
    React.createElement('div', { 'data-testid': 'stub-violation-list' },
      `count:${violations.length}`,
      onAutoFix && React.createElement('button', { type: 'button', onClick: () => onAutoFix(violations[0]) }, 'stub-autofix'),
      onIgnore && React.createElement('button', { type: 'button', onClick: () => onIgnore(violations[0]) }, 'stub-ignore'),
    ),
}))

function makeViolation(overrides: Partial<RuleViolation> = {}): RuleViolation {
  return { ruleId: 'no-console-log', level: 'error', message: 'Found a console.log', autoFixable: false, ...overrides }
}

function makeResult(overrides: Partial<RuleCheckResult> = {}): RuleCheckResult {
  return { ruleId: 'no-console-log', passed: true, violations: [], duration: 12, ...overrides }
}

function makeReport(overrides: Partial<EnforcementReport> = {}): EnforcementReport {
  return {
    action: { type: 'commit', data: {}, userId: 'u1', projectId: 'p1', timestamp: new Date('2026-01-15T10:00:00Z') },
    results: [makeResult()],
    passed: true,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    totalDuration: 42,
    timestamp: new Date('2026-01-15T10:00:00Z'),
    canAutoFix: false,
    suggestions: [],
    ...overrides,
  }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('EnforcementDashboard — real pass-rate/gating/apply-fixes coverage (#1204)', () => {
  it('shows the real "Passed" state and the real metric counts for a genuinely passing report', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport() }))
    expect(host.textContent).toContain('Passed')
    expect(host.textContent).toContain('42ms')
  })

  it('shows the real "Failed" state for a genuinely failing report', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport({ passed: false, errorCount: 2 }) }))
    expect(host.textContent).toContain('Failed')
  })

  it('computes a real 100% pass rate when the report has genuinely zero error/warning/info counts', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport({ results: [makeResult({ passed: false })] }) }))
    expect(host.textContent).toContain('100%')
  })

  it('computes the real pass rate from the real ratio of passing rule results once counts are non-zero', () => {
    const report = makeReport({
      errorCount: 1,
      results: [makeResult({ passed: true }), makeResult({ ruleId: 'r2', passed: false, violations: [makeViolation()] })],
    })
    render(React.createElement(EnforcementDashboard, { report }))
    expect(host.textContent).toContain('50%')
  })

  it('shows the real Apply Fixes banner only when canAutoFix AND a real onApplyFixes handler are both present', () => {
    const onApplyFixes = vi.fn().mockResolvedValue(undefined)
    render(React.createElement(EnforcementDashboard, { report: makeReport({ canAutoFix: true }), onApplyFixes }))
    expect(host.textContent).toContain('Some violations can be automatically fixed')
  })

  it('never shows the Apply Fixes banner when canAutoFix is true but there is genuinely no onApplyFixes handler', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport({ canAutoFix: true }) }))
    expect(host.textContent).not.toContain('Some violations can be automatically fixed')
  })

  it('a real Apply Fixes click shows the real "Applying..." loading state, calls onApplyFixes, then resets', async () => {
    let resolveFix: () => void = () => {}
    const onApplyFixes = vi.fn(() => new Promise<void>((resolve) => { resolveFix = resolve }))
    render(React.createElement(EnforcementDashboard, { report: makeReport({ canAutoFix: true }), onApplyFixes }))

    const applyBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Apply Fixes') as HTMLButtonElement
    await act(async () => { applyBtn.click() })

    expect(host.textContent).toContain('Applying...')
    expect(applyBtn.disabled).toBe(true)

    await act(async () => { resolveFix(); await Promise.resolve(); await Promise.resolve() })

    expect(onApplyFixes).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Apply Fixes')
    expect(host.textContent).not.toContain('Applying...')
  })

  it('renders the real suggestions list only when the report genuinely has suggestions', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport({ suggestions: ['Use const instead of var'] }) }))
    expect(host.textContent).toContain('Use const instead of var')
  })

  it('never renders a suggestions heading when the report has none', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport({ suggestions: [] }) }))
    expect(host.textContent).not.toContain('Suggestions:')
  })

  it('shows the real "Ignore All Violations" footer button only when onIgnoreAll is given AND the report genuinely failed', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport({ passed: false }), onIgnoreAll: vi.fn() }))
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent === 'Ignore All Violations')).toBe(true)
  })

  it('never shows the Ignore All footer button for a genuinely passing report, even with onIgnoreAll given', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport({ passed: true }), onIgnoreAll: vi.fn() }))
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent === 'Ignore All Violations')).toBe(false)
  })

  it('clicking the real Ignore All footer button calls the real onIgnoreAll callback', async () => {
    const onIgnoreAll = vi.fn()
    render(React.createElement(EnforcementDashboard, { report: makeReport({ passed: false }), onIgnoreAll }))

    const ignoreBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Ignore All Violations') as HTMLButtonElement
    await act(async () => { ignoreBtn.click() })

    expect(onIgnoreAll).toHaveBeenCalled()
  })

  it('never renders the real Violations section when every rule result has genuinely zero violations', () => {
    render(React.createElement(EnforcementDashboard, { report: makeReport() }))
    expect(host.querySelector('[data-testid="stub-violation-list"]')).toBeNull()
  })

  it('renders the real Violations section with the real flattened violation count once any rule result has violations', () => {
    const report = makeReport({
      results: [
        makeResult({ ruleId: 'r1', passed: false, violations: [makeViolation({ ruleId: 'r1' })] }),
        makeResult({ ruleId: 'r2', passed: false, violations: [makeViolation({ ruleId: 'r2' }), makeViolation({ ruleId: 'r2', message: 'second' })] }),
      ],
    })
    render(React.createElement(EnforcementDashboard, { report }))
    expect(host.querySelector('[data-testid="stub-violation-list"]')?.textContent).toContain('count:3')
  })

  it('wires the real onApplyFixes handler through to RuleViolationList\'s onAutoFix (ignoring the violation arg, by its own real implementation)', async () => {
    const onApplyFixes = vi.fn().mockResolvedValue(undefined)
    const report = makeReport({ results: [makeResult({ passed: false, violations: [makeViolation()] })] })
    render(React.createElement(EnforcementDashboard, { report, onApplyFixes }))

    const autoFixBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'stub-autofix') as HTMLButtonElement
    await act(async () => { autoFixBtn.click(); await Promise.resolve() })

    expect(onApplyFixes).toHaveBeenCalledTimes(1)
  })

  it('wires the real onIgnoreAll handler through to RuleViolationList\'s onIgnore', async () => {
    const onIgnoreAll = vi.fn()
    const report = makeReport({ results: [makeResult({ passed: false, violations: [makeViolation()] })] })
    render(React.createElement(EnforcementDashboard, { report, onIgnoreAll }))

    const ignoreBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'stub-ignore') as HTMLButtonElement
    await act(async () => { ignoreBtn.click() })

    expect(onIgnoreAll).toHaveBeenCalled()
  })

  it('renders a real passed/failed row per rule check result in the Rule Check Results section', () => {
    const report = makeReport({ results: [makeResult({ ruleId: 'rule-a', passed: true }), makeResult({ ruleId: 'rule-b', passed: false, violations: [makeViolation()] })] })
    render(React.createElement(EnforcementDashboard, { report }))

    expect(host.textContent).toContain('rule-a')
    expect(host.textContent).toContain('rule-b')
    expect(host.textContent).toContain('2 rules checked')
    expect(host.textContent).toContain('(1 violation)')
  })
})
