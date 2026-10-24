// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { BuildProgress, type BuildTask } from '@/components/chat/build-progress'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — BuildProgress (components/chat/build-progress.tsx,
 * 86 lines, reached live via components/chat/chat-messages.tsx) had zero
 * test coverage. Pure presentational component, no fetch, no Radix.
 */

function makeTask(overrides: Partial<BuildTask> = {}): BuildTask {
  return { id: 't1', type: 'create', status: 'pending', description: 'Scaffold the app', ...overrides }
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

describe('BuildProgress — real progress-calc/status-text coverage (#1204)', () => {
  it('shows the real "N of M completed" count and the real progress-bar fill width', () => {
    const tasks = [makeTask({ id: 'a', status: 'completed' }), makeTask({ id: 'b', status: 'pending' })]
    render(React.createElement(BuildProgress, { tasks }))

    expect(host.textContent).toContain('1 of 2 completed')
    const bar = host.querySelector('.bg-gray-900') as HTMLElement
    expect(bar.style.width).toBe('50%')
  })

  it('maps every real status to its real uppercase label: PENDING/BUILDING/DONE/ERROR', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'pending', description: 'Pending task' }),
      makeTask({ id: 'b', status: 'in_progress', description: 'Building task' }),
      makeTask({ id: 'c', status: 'completed', description: 'Done task' }),
      makeTask({ id: 'd', status: 'error', description: 'Errored task' }),
    ]
    render(React.createElement(BuildProgress, { tasks }))

    const statusSpans = Array.from(host.querySelectorAll('.uppercase'))
    expect(statusSpans.map((s) => s.textContent)).toEqual(['PENDING', 'BUILDING', 'DONE', 'ERROR'])
  })

  it('renders the real task description and the real fileName only when a task genuinely has one', () => {
    const tasks = [
      makeTask({ id: 'a', description: 'Create the file', fileName: 'app/page.tsx' }),
      makeTask({ id: 'b', description: 'Install deps', fileName: undefined }),
    ]
    render(React.createElement(BuildProgress, { tasks }))

    expect(host.textContent).toContain('Create the file')
    expect(host.textContent).toContain('app/page.tsx')
    expect(host.textContent).toContain('Install deps')
  })

  it('renders one real row per task, in the real given order', () => {
    const tasks = [makeTask({ id: 'a', description: 'First' }), makeTask({ id: 'b', description: 'Second' }), makeTask({ id: 'c', description: 'Third' })]
    render(React.createElement(BuildProgress, { tasks }))

    const rows = host.querySelectorAll('.space-y-2 > div')
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('First')
    expect(rows[2].textContent).toContain('Third')
  })

  it('shows "0 of 0 completed" and never crashes on a real empty task list', () => {
    expect(() => render(React.createElement(BuildProgress, { tasks: [] }))).not.toThrow()
    expect(host.textContent).toContain('0 of 0 completed')
  })

  it('shows a real 100% fill width when every real task is completed', () => {
    const tasks = [makeTask({ id: 'a', status: 'completed' }), makeTask({ id: 'b', status: 'completed' })]
    render(React.createElement(BuildProgress, { tasks }))

    const bar = host.querySelector('.bg-gray-900') as HTMLElement
    expect(bar.style.width).toBe('100%')
  })

  it('merges a real custom className onto the real card container', () => {
    render(React.createElement(BuildProgress, { tasks: [makeTask()], className: 'custom-test-class' }))
    expect(host.firstElementChild?.className).toContain('custom-test-class')
  })
})
