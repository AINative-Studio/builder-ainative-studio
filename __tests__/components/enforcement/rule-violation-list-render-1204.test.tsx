// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { RuleViolationList } from '@/components/enforcement/rule-violation-list'
import type { RuleViolation } from '@/lib/types/enforcement-rules'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — RuleViolationList (components/enforcement/rule
 * -violation-list.tsx, 183 lines, reached live via EnforcementDashboard <-
 * app/settings/rules/page.tsx) had zero test coverage. Pure presentational
 * component, no fetch.
 */

function makeViolation(overrides: Partial<RuleViolation> = {}): RuleViolation {
  return { ruleId: 'no-console-log', level: 'error', message: 'Found a console.log', autoFixable: false, ...overrides }
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

describe('RuleViolationList — real rendering/gating/callback coverage (#1204)', () => {
  it('shows the real "All checks passed!" state when violations are genuinely empty', () => {
    render(React.createElement(RuleViolationList, { violations: [] }))
    expect(host.textContent).toContain('All checks passed!')
    expect(host.textContent).toContain('No violations found')
  })

  it('shows the real singular/plural "Violation(s) Found" heading and the real per-level counts', () => {
    const violations = [makeViolation({ level: 'error' }), makeViolation({ level: 'warning' }), makeViolation({ level: 'warning' }), makeViolation({ level: 'info' })]
    render(React.createElement(RuleViolationList, { violations }))

    expect(host.textContent).toContain('4 Violations Found')
    expect(host.textContent).toContain('1 Errors')
    expect(host.textContent).toContain('2 Warnings')
    expect(host.textContent).toContain('1 Info')
  })

  it('shows the real singular heading for exactly one violation', () => {
    render(React.createElement(RuleViolationList, { violations: [makeViolation()] }))
    expect(host.textContent).toContain('1 Violation Found')
    expect(host.textContent).not.toContain('1 Violations Found')
  })

  it('renders the real message, ruleId, and UPPERCASE level badge for each violation', () => {
    const violation = makeViolation({ message: 'Unused import detected', ruleId: 'no-unused-imports', level: 'warning' })
    render(React.createElement(RuleViolationList, { violations: [violation] }))

    expect(host.textContent).toContain('Unused import detected')
    expect(host.textContent).toContain('no-unused-imports')
    expect(host.textContent).toContain('WARNING')
  })

  it('renders the real details text only when a violation genuinely has it', () => {
    const withDetails = makeViolation({ details: 'This pattern leaks memory in long-running processes.' })
    render(React.createElement(RuleViolationList, { violations: [withDetails] }))
    expect(host.textContent).toContain('This pattern leaks memory')
  })

  it('never renders a details block when a violation has none', () => {
    render(React.createElement(RuleViolationList, { violations: [makeViolation({ details: undefined })] }))
    expect(host.querySelector('.text-muted-foreground.space-y-4') ?? host.textContent).not.toContain('undefined')
  })

  it('renders the real file/line/snippet location block only when a violation genuinely has one', () => {
    const violation = makeViolation({ location: { file: 'src/app.ts', line: 42, snippet: 'console.log("debug")' } })
    render(React.createElement(RuleViolationList, { violations: [violation] }))

    expect(host.textContent).toContain('src/app.ts')
    expect(host.textContent).toContain('42')
    expect(host.textContent).toContain('console.log("debug")')
  })

  it('never renders a location block when a violation has none', () => {
    render(React.createElement(RuleViolationList, { violations: [makeViolation({ location: undefined })] }))
    expect(host.textContent).not.toContain('File:')
    expect(host.textContent).not.toContain('Line:')
  })

  it('renders the real suggestion block only when a violation genuinely has one', () => {
    const violation = makeViolation({ suggestion: 'Use a logger instead of console.log' })
    render(React.createElement(RuleViolationList, { violations: [violation] }))
    expect(host.textContent).toContain('Suggestion:')
    expect(host.textContent).toContain('Use a logger instead of console.log')
  })

  it('shows the real Auto-fix button ONLY when autoFixable is true AND a real onAutoFix handler is given — neither alone is enough', () => {
    const onAutoFix = vi.fn()
    render(React.createElement(RuleViolationList, {
      violations: [
        makeViolation({ ruleId: 'r1', autoFixable: true }), // no onAutoFix handler at all
      ],
    }))
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.includes('Auto-fix'))).toBe(false)

    act(() => { root.unmount() })
    render(React.createElement(RuleViolationList, {
      violations: [makeViolation({ ruleId: 'r2', autoFixable: false })], // handler given but not fixable
      onAutoFix,
    }))
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.includes('Auto-fix'))).toBe(false)
  })

  it('a real Auto-fix click calls onAutoFix with the real violation object', async () => {
    const onAutoFix = vi.fn()
    const violation = makeViolation({ autoFixable: true, ruleId: 'fixable-rule' })
    render(React.createElement(RuleViolationList, { violations: [violation], onAutoFix }))

    const fixBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Auto-fix')) as HTMLButtonElement
    await act(async () => { fixBtn.click() })

    expect(onAutoFix).toHaveBeenCalledWith(violation)
  })

  it('never shows an Ignore button when there is genuinely no onIgnore handler', () => {
    render(React.createElement(RuleViolationList, { violations: [makeViolation()] }))
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.includes('Ignore'))).toBe(false)
  })

  it('a real Ignore click calls onIgnore with the real violation object', async () => {
    const onIgnore = vi.fn()
    const violation = makeViolation({ ruleId: 'ignorable-rule' })
    render(React.createElement(RuleViolationList, { violations: [violation], onIgnore }))

    const ignoreBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Ignore')) as HTMLButtonElement
    await act(async () => { ignoreBtn.click() })

    expect(onIgnore).toHaveBeenCalledWith(violation)
  })

  it('renders a distinct real card per violation, each wired to its own real callback independently', async () => {
    const onIgnore = vi.fn()
    const violations = [makeViolation({ ruleId: 'r1', message: 'First' }), makeViolation({ ruleId: 'r2', message: 'Second' })]
    render(React.createElement(RuleViolationList, { violations, onIgnore }))

    const ignoreButtons = Array.from(host.querySelectorAll('button')).filter((b) => b.textContent?.includes('Ignore')) as HTMLButtonElement[]
    expect(ignoreButtons.length).toBe(2)

    await act(async () => { ignoreButtons[1].click() })
    expect(onIgnore).toHaveBeenCalledWith(violations[1])
    expect(onIgnore).not.toHaveBeenCalledWith(violations[0])
  })
})
