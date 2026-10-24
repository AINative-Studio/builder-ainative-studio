// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { FileTree, type FileGroup, type FileNode } from '@/components/chat/file-tree'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — FileTree (components/chat/file-tree.tsx, 137
 * lines, reached live via components/chat/chat-messages.tsx <-
 * components/chats/chat-detail-client.tsx) had zero test coverage. Plain
 * nested collapse state, no Radix — real .click() works directly.
 */

function makeFile(overrides: Partial<FileNode> = {}): FileNode {
  return { id: 'f1', path: 'src/app.ts', name: 'app.ts', type: 'file', status: 'pending', ...overrides }
}

function makeGroup(overrides: Partial<FileGroup> = {}): FileGroup {
  return { id: 'g1', title: 'Backend', files: [makeFile()], ...overrides }
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

describe('FileTree — real progress/collapse/status coverage (#1204)', () => {
  it('renders genuinely nothing when there are no real groups', () => {
    render(React.createElement(FileTree, { groups: [] }))
    expect(host.innerHTML).toBe('')
  })

  it('shows the real "N of M completed" count and the real overall progress bar width', () => {
    const groups = [makeGroup({ files: [makeFile({ id: 'a', status: 'completed' }), makeFile({ id: 'b', status: 'pending' })] })]
    render(React.createElement(FileTree, { groups }))

    expect(host.textContent).toContain('1 of 2 completed')
    const bar = host.querySelector('.h-full.bg-gray-900') as HTMLElement
    expect(bar.style.width).toBe('50%')
  })

  it('renders every real group title and its own real "completed/total" sub-count', () => {
    const groups = [
      makeGroup({ id: 'g1', title: 'Backend', files: [makeFile({ id: 'a', status: 'completed' })] }),
      makeGroup({ id: 'g2', title: 'Frontend', files: [makeFile({ id: 'b' }), makeFile({ id: 'c' })] }),
    ]
    render(React.createElement(FileTree, { groups }))

    expect(host.textContent).toContain('Backend')
    expect(host.textContent).toContain('1/1')
    expect(host.textContent).toContain('Frontend')
    expect(host.textContent).toContain('0/2')
  })

  it('is genuinely expanded by default (real file names visible) when defaultCollapsed is not given', () => {
    const groups = [makeGroup({ files: [makeFile({ name: 'index.ts' })] })]
    render(React.createElement(FileTree, { groups }))

    expect(host.textContent).toContain('index.ts')
    expect(host.textContent).toContain('▾')
  })

  it('is genuinely collapsed when defaultCollapsed is true, hiding real sub-groups entirely', () => {
    const groups = [makeGroup({ title: 'Backend', files: [makeFile({ name: 'index.ts' })] })]
    render(React.createElement(FileTree, { groups, defaultCollapsed: true }))

    expect(host.textContent).not.toContain('index.ts')
    expect(host.textContent).not.toContain('Backend')
    expect(host.textContent).toContain('▸')
  })

  it('a real click on the main header toggles the real collapsed state', async () => {
    const groups = [makeGroup({ files: [makeFile({ name: 'index.ts' })] })]
    render(React.createElement(FileTree, { groups }))

    const mainHeader = host.querySelector('button') as HTMLButtonElement
    await act(async () => { mainHeader.click() })

    expect(host.textContent).not.toContain('index.ts')
    expect(host.textContent).toContain('▸')

    await act(async () => { mainHeader.click() })
    expect(host.textContent).toContain('index.ts')
  })

  it('a real click on a sub-group header toggles only that group, leaving others genuinely expanded', async () => {
    const groups = [
      makeGroup({ id: 'g1', title: 'Backend', files: [makeFile({ id: 'a', name: 'server.ts' })] }),
      makeGroup({ id: 'g2', title: 'Frontend', files: [makeFile({ id: 'b', name: 'client.ts' })] }),
    ]
    render(React.createElement(FileTree, { groups }))

    const subHeaders = Array.from(host.querySelectorAll('button')).slice(1) as HTMLButtonElement[]
    await act(async () => { subHeaders[0].click() })

    expect(host.textContent).not.toContain('server.ts')
    expect(host.textContent).toContain('client.ts')
  })

  it('renders the real "(created)"/"(modified)"/"(deleted)" status text only for completed files with a matching action', () => {
    const groups = [makeGroup({ files: [
      makeFile({ id: 'a', name: 'new.ts', status: 'completed', action: 'create' }),
      makeFile({ id: 'b', name: 'old.ts', status: 'completed', action: 'update' }),
      makeFile({ id: 'c', name: 'gone.ts', status: 'completed', action: 'delete' }),
    ] })]
    render(React.createElement(FileTree, { groups }))

    expect(host.textContent).toContain('(created)')
    expect(host.textContent).toContain('(modified)')
    expect(host.textContent).toContain('(deleted)')
  })

  it('renders the real "(building...)" status text for an in_progress file regardless of action', () => {
    const groups = [makeGroup({ files: [makeFile({ status: 'in_progress' })] })]
    render(React.createElement(FileTree, { groups }))
    expect(host.textContent).toContain('(building...)')
  })

  it('never renders a status text for a genuinely pending file', () => {
    const groups = [makeGroup({ files: [makeFile({ name: 'fresh.ts', status: 'pending' })] })]
    render(React.createElement(FileTree, { groups }))
    expect(host.textContent).toContain('fresh.ts')
    expect(host.textContent).not.toMatch(/\(.*\)/)
  })

  it('never crashes when every real file in every group has zero total files (0/0 progress)', () => {
    const groups = [makeGroup({ files: [] })]
    expect(() => render(React.createElement(FileTree, { groups }))).not.toThrow()
  })
})
