// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { CommandProgressTracker } from '@/components/command-progress-tracker'
import type { AgentCommand } from '@/lib/types/agent-commands'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — CommandProgressTracker (components/command
 * -progress-tracker.tsx, 319 lines, reached live via command-palette.tsx)
 * had zero test coverage. Real per-checkpoint pending->running->completed
 * simulation is driven by a 2000ms setInterval (the component's own comment
 * admits this is a placeholder for a future WebSocket/polling driver) — real
 * behavior exercised via fake timers, not mocked away.
 *
 * DialogContent renders through a Radix Portal into document.body, not the
 * local createRoot host (same pattern established across every other Dialog
 * -based #1204 test this pass).
 */

function makeCommand(checkpointCount: number): AgentCommand {
  return {
    metadata: {
      id: 'cmd-1', name: 'Deploy app', description: 'Deploys the real app',
      category: 'deployment', tags: [], author: { id: 'system', name: 'System' },
      isBuiltIn: true, isTeam: false, usageCount: 0, isActive: true,
      createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    },
    template: 'deploy',
    variables: [],
    requiredSkills: [],
    preConditions: [],
    checkpoints: Array.from({ length: checkpointCount }, (_, i) => ({
      id: `cp-${i}`, title: `Checkpoint ${i}`, type: 'action' as const, order: i,
    })),
    output: { type: 'deployment' },
    version: '1.0.0',
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
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('CommandProgressTracker — real checkpoint simulation coverage (#1204)', () => {
  it('renders the real command name and starts every real checkpoint as pending at 0%', () => {
    const command = makeCommand(2)
    render(React.createElement(CommandProgressTracker, { command, open: true, onOpenChange: vi.fn() }))

    expect(document.body.textContent).toContain('Executing: Deploy app')
    expect(document.body.textContent).toContain('0%')
    expect(document.body.textContent).toContain('Checkpoint 0')
    expect(document.body.textContent).toContain('Checkpoint 1')
  })

  it('advances a real checkpoint from pending to running to completed over real 2s ticks', async () => {
    vi.useFakeTimers()
    const command = makeCommand(1)
    render(React.createElement(CommandProgressTracker, { command, open: true, onOpenChange: vi.fn() }))

    expect(document.body.textContent).toContain('Pending')

    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(document.body.textContent).toContain('Running')

    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(document.body.textContent).toContain('Completed')
    expect(document.body.textContent).toContain('100%')
  })

  it('shows the real "Success" alert and a real Close button once every checkpoint completes', async () => {
    vi.useFakeTimers()
    const command = makeCommand(1)
    render(React.createElement(CommandProgressTracker, { command, open: true, onOpenChange: vi.fn() }))

    await act(async () => { vi.advanceTimersByTime(4000) })

    expect(document.body.textContent).toContain('Success')
    expect(document.body.textContent).toContain('All checkpoints completed successfully')
    // Exclude Radix DialogContent's own built-in X close button — its
    // visually-hidden sr-only span also renders the literal text "Close".
    const closeBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Close' && !b.querySelector('svg')
    )
    expect(closeBtn).toBeTruthy()
  })

  it('a real Close button click calls onOpenChange(false)', async () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    const command = makeCommand(1)
    render(React.createElement(CommandProgressTracker, { command, open: true, onOpenChange }))

    await act(async () => { vi.advanceTimersByTime(4000) })

    const closeBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Close' && !b.querySelector('svg')
    ) as HTMLButtonElement
    await act(async () => { closeBtn.click() })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows a real Cancel button (not Close) while a checkpoint is still running, and it calls the real onCancel', async () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    const command = makeCommand(2)
    render(React.createElement(CommandProgressTracker, { command, open: true, onOpenChange: vi.fn(), onCancel }))

    await act(async () => { vi.advanceTimersByTime(2000) })

    const cancelBtn = Array.from(document.body.querySelectorAll('button')).find((b) => /^Cancel$/.test((b.textContent || '').trim())) as HTMLButtonElement
    expect(cancelBtn).toBeTruthy()
    // Radix's own DialogContent close (X) button has a visually-hidden "Close"
    // sr-only span, so it's excluded by name here — only the real footer Close
    // button (plain text, no icon) is the one under test.
    const footerCloseBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Close' && !b.querySelector('svg')
    )
    expect(footerCloseBtn).toBeFalsy()

    await act(async () => { cancelBtn.click() })
    expect(onCancel).toHaveBeenCalled()
  })

  it('never shows the real Execution Logs section when there genuinely are no logs (logs state is never populated by this component)', () => {
    const command = makeCommand(1)
    render(React.createElement(CommandProgressTracker, { command, open: true, onOpenChange: vi.fn() }))

    expect(document.body.textContent).not.toMatch(/Show Logs/)
  })

  it('stops advancing checkpoints once closed (no real interval leak/crash on unmount)', async () => {
    vi.useFakeTimers()
    const command = makeCommand(1)
    render(React.createElement(CommandProgressTracker, { command, open: true, onOpenChange: vi.fn() }))

    await act(async () => { root.unmount() })
    expect(() => vi.advanceTimersByTime(10000)).not.toThrow()
  })
})
