// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TasksPanel } from '@/components/build/TasksPanel'
import type { BuildTask } from '@/lib/build/task-store'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — TasksPanel (components/build/TasksPanel.tsx,
 * 203 lines, reached live via components/build/screens/Live.tsx) had zero
 * test coverage. Plain custom tabs (not Radix) — real .click() works
 * directly, no special event-dispatch gotchas here.
 */

function makeTask(overrides: Partial<BuildTask> = {}): BuildTask {
  return {
    id: 't1',
    scopeKey: 'owner:co-1',
    title: 'Wire up the signup flow',
    stage: 'todo',
    source: 'cody',
    storyPoints: 3,
    estimateRationale: 'Moderate scope',
    createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60000).toISOString(),
    ...overrides,
  }
}

function jsonResponse(data: any, ok = true) {
  return { ok, json: async () => data }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function byTestId(id: string): HTMLElement | null {
  return host.querySelector(`[data-testid="${id}"]`)
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('TasksPanel — real load/filter/detail coverage (#1204)', () => {
  it('fetches the real /api/build/tasks with the real companyId, shows the real loading state first', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))

    expect(byTestId('tasks-loading')).not.toBeNull()
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/build/tasks?companyId=co-1'))
  })

  it('shows the real honest empty state for a brand-new company with zero tasks', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ tasks: [], counts: {} })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('tasks-empty')).not.toBeNull()
    expect(byTestId('tasks-empty')?.textContent).toContain('No tasks yet')
  })

  it('never crashes and falls back to an empty list when the real response is malformed (non-array tasks, non-object counts)', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ tasks: 'not-an-array', counts: null })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('tasks-empty')).not.toBeNull()
  })

  it('never crashes on a genuinely rejected fetch, stops the real loading state', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('tasks-loading')).toBeNull()
  })

  it('renders the real task cards with title, stage badge, source, and relative time', async () => {
    const task = makeTask({ title: 'Ship the pricing page', stage: 'in_progress', source: 'swarm' })
    global.fetch = vi.fn(async () => jsonResponse({ tasks: [task], counts: { todo: 0, in_progress: 1 } })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('task-title')?.textContent).toBe('Ship the pricing page')
    expect(byTestId('task-stage-badge')?.textContent).toBe('In Progress')
    expect(byTestId('task-source')?.textContent).toBe('swarm')
    expect(host.querySelector('.m-task-meta')?.textContent).toBe('5m ago')
  })

  it('renders the real total count (summed across the 6 real stages) in the All tab', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ tasks: [], counts: { todo: 2, in_progress: 1, completed: 4, recurring: 0, rejected: 0, failed: 0 } })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('task-tab-all')?.textContent).toContain('7')
  })

  it('a real stage-tab click filters to only that stage\'s real tasks', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Todo task', stage: 'todo' }), makeTask({ id: 't2', title: 'Done task', stage: 'completed' })]
    global.fetch = vi.fn(async () => jsonResponse({ tasks, counts: { todo: 1, completed: 1 } })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('task-tab-completed')!.click() })

    expect(host.textContent).toContain('Done task')
    expect(host.textContent).not.toContain('Todo task')
    expect(byTestId('task-tab-completed')?.getAttribute('aria-selected')).toBe('true')
  })

  it('shows the real "No <Stage> tasks" message when a real filtered stage is genuinely empty', async () => {
    const tasks = [makeTask({ stage: 'todo' })]
    global.fetch = vi.fn(async () => jsonResponse({ tasks, counts: { todo: 1 } })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('task-tab-failed')!.click() })

    expect(byTestId('tasks-stage-empty')?.textContent).toContain('No Failed tasks')
  })

  it('a real VIEW click opens the real detail panel with the real title, source, and output', async () => {
    const task = makeTask({ title: 'Fix the checkout bug', output: 'Patched the race condition in checkout.ts', taskId: 'task-abc-123' })
    global.fetch = vi.fn(async () => jsonResponse({ tasks: [task], counts: { todo: 1 } })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('task-detail')).toBeNull()
    await act(async () => { byTestId('task-view')!.click() })

    expect(byTestId('task-detail-title')?.textContent).toBe('Fix the checkout bug')
    expect(byTestId('task-detail-output')?.textContent).toBe('Patched the race condition in checkout.ts')
    expect(byTestId('task-detail-taskid')?.textContent).toBe('task-abc-123')
  })

  it('shows the real "No agent output yet" fallback when a real task has no output', async () => {
    const task = makeTask({ output: undefined })
    global.fetch = vi.fn(async () => jsonResponse({ tasks: [task], counts: { todo: 1 } })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('task-view')!.click() })
    expect(host.textContent).toContain('No agent output yet')
    expect(byTestId('task-detail-output')).toBeNull()
  })

  it('never shows a task_id row when the real task genuinely has none', async () => {
    const task = makeTask({ taskId: null })
    global.fetch = vi.fn(async () => jsonResponse({ tasks: [task], counts: { todo: 1 } })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('task-view')!.click() })
    expect(byTestId('task-detail-taskid')).toBeNull()
  })

  it('a real close click in the detail panel hides it again', async () => {
    const task = makeTask()
    global.fetch = vi.fn(async () => jsonResponse({ tasks: [task], counts: { todo: 1 } })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('task-view')!.click() })
    expect(byTestId('task-detail')).not.toBeNull()

    await act(async () => { byTestId('task-detail-close')!.click() })
    expect(byTestId('task-detail')).toBeNull()
  })

  it('re-fetches real tasks when the companyId prop changes', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ tasks: [], counts: {} })) as any
    render(React.createElement(TasksPanel, { companyId: 'co-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const callsBefore = (global.fetch as any).mock.calls.length
    await act(async () => { root.render(React.createElement(TasksPanel, { companyId: 'co-2' })) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect((global.fetch as any).mock.calls.length).toBe(callsBefore + 1)
    expect((global.fetch as any).mock.calls.at(-1)[0]).toContain('companyId=co-2')
  })
})
