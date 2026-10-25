// @vitest-environment node
import { describe, it, expect } from 'vitest'

/**
 * #1204 (Coverage Phase 4) — components/a2ui/index.tsx is a real barrel
 * re-exported by preview-panel.tsx (`import { A2UIPreviewWithFallback }
 * from '@/components/a2ui'`), but every test that imports preview-panel.tsx
 * mocks '@/components/a2ui' at that boundary, so this file itself never
 * actually executes under any existing test. A real gap, not orphaned code
 * — this imports the barrel directly (unmocked) to confirm its re-exports
 * are the genuine bindings from their source modules, catching a future
 * accidental rename/break in the barrel itself.
 */
describe('components/a2ui barrel (#1204)', () => {
  it('re-exports the real A2UIPreview/A2UIPreviewWithFallback bindings', async () => {
    const barrel = await import('@/components/a2ui')
    const direct = await import('@/components/a2ui/A2UIPreview')
    expect(barrel.A2UIPreview).toBe(direct.A2UIPreview)
    expect(barrel.A2UIPreviewWithFallback).toBe(direct.A2UIPreviewWithFallback)
  })

  it('re-exports the real AgentConnection bindings', async () => {
    const barrel = await import('@/components/a2ui')
    const direct = await import('@/components/a2ui/AgentConnection')
    expect(barrel.useAgentConnection).toBe(direct.useAgentConnection)
    expect(barrel.AgentConnectionStatus).toBe(direct.AgentConnectionStatus)
    expect(barrel.ConnectionStatus).toBe(direct.ConnectionStatus)
  })

  it('re-exports the real ComponentMapper bindings', async () => {
    const barrel = await import('@/components/a2ui')
    const direct = await import('@/components/a2ui/ComponentMapper')
    expect(barrel.ComponentMapper).toBe(direct.ComponentMapper)
    expect(barrel.componentRegistry).toBe(direct.componentRegistry)
    expect(barrel.parseA2UISpec).toBe(direct.parseA2UISpec)
    expect(barrel.validateA2UIComponent).toBe(direct.validateA2UIComponent)
  })
})

/**
 * components/context-budget/index.ts is the same shape of gap: a real
 * barrel used by app/context-budget-demo/page.tsx, but every one of its 5
 * components (BudgetMeter/BudgetBreakdown/OptimizationSuggestions/
 * ContextItemsList/BudgetDashboard) already has its own dedicated render
 * test that imports the component directly, never through this barrel —
 * so the barrel's own re-export lines never execute under any existing test.
 */
describe('components/context-budget barrel (#1204)', () => {
  it('re-exports the real bindings for all 5 budget components', async () => {
    const barrel = await import('@/components/context-budget')
    const meter = await import('@/components/context-budget/budget-meter')
    const breakdown = await import('@/components/context-budget/budget-breakdown')
    const suggestions = await import('@/components/context-budget/optimization-suggestions')
    const itemsList = await import('@/components/context-budget/context-items-list')
    const dashboard = await import('@/components/context-budget/budget-dashboard')

    expect(barrel.BudgetMeter).toBe(meter.BudgetMeter)
    expect(barrel.BudgetBreakdown).toBe(breakdown.BudgetBreakdown)
    expect(barrel.OptimizationSuggestions).toBe(suggestions.OptimizationSuggestions)
    expect(barrel.ContextItemsList).toBe(itemsList.ContextItemsList)
    expect(barrel.BudgetDashboard).toBe(dashboard.BudgetDashboard)
  })
})
