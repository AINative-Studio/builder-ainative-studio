// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — CommandPalette (components/command-palette.tsx,
 * 339 lines, reached live via app/layout.tsx — genuinely global, mounted on
 * EVERY page via command-palette-provider.tsx) had zero test coverage.
 *
 * Child dialogs (VariablePromptDialog, CommandProgressTracker) are stubbed
 * here — they're separately covered by their own dedicated #1204 test files
 * (command-variable-prompt.tsx / command-progress-tracker.tsx) elsewhere in
 * this same pass. lib/client/command-client.ts (the real data layer) is
 * already independently tested (__tests__/lib/command-client.test.ts) — its
 * real exported function shapes are mocked here, not re-tested.
 */

const h = vi.hoisted(() => ({
  getRecentCommands: vi.fn(),
  searchCommands: vi.fn(),
  executeCommand: vi.fn(),
  toggleFavorite: vi.fn(),
}))
vi.mock('@/lib/client/command-client', () => h)
vi.mock('@/components/command-variable-prompt', () => ({ VariablePromptDialog: () => React.createElement('div', { 'data-testid': 'stub-variable-prompt' }) }))
vi.mock('@/components/command-progress-tracker', () => ({ CommandProgressTracker: () => React.createElement('div', { 'data-testid': 'stub-progress-tracker' }) }))

import type { AgentCommand } from '@/lib/types/agent-commands'

/** Real, type-checked fixture (no `as any` escape hatch) — an earlier
 *  draft of this file used a partial, hand-guessed metadata shape that
 *  silently omitted `tags`/`author`/`usageCount`/etc. (all genuinely
 *  REQUIRED in the real CommandMetadata type, confirmed by reading
 *  lib/types/agent-commands.ts directly) and crashed the real component at
 *  `command.metadata.tags.slice(...)` — not a bug in CommandPalette itself
 *  (the real command-client always returns type-correct data), but a real
 *  reminder that a loosely-typed test fixture can hide exactly this class
 *  of bug instead of catching it. */
function makeCommand(overrides: Partial<{ id: string; name: string; category: AgentCommand['metadata']['category']; variables: AgentCommand['variables'] }> = {}): AgentCommand {
  return {
    metadata: {
      id: overrides.id ?? 'cmd-1',
      name: overrides.name ?? 'Run tests',
      description: 'Runs the real test suite',
      category: overrides.category ?? 'testing',
      tags: [],
      author: { id: 'system', name: 'System' },
      isBuiltIn: true,
      isTeam: false,
      usageCount: 0,
      isActive: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    template: 'run tests',
    variables: overrides.variables ?? [],
    requiredSkills: [],
    preConditions: [],
    checkpoints: [],
    output: { type: 'chat' },
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

/** Real finding reused from __tests__/components/CompanyNameEdit.test.tsx's
 *  own established pattern: React tracks a controlled input's value through
 *  the native setter it installed, so a plain `input.value = x` followed by
 *  a dispatched 'input' event silently no-ops — React never sees the
 *  change. Must go through the real native value setter first. */
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('CommandPalette — real search/execution orchestration coverage (#1204)', () => {
  it('loads real recent commands and searches with the real empty/popular query when opened with no search text', async () => {
    h.getRecentCommands.mockResolvedValue([makeCommand({ id: 'recent-1', name: 'Deploy to prod' })])
    h.searchCommands.mockResolvedValue({ commands: [] })

    const { CommandPalette } = await import('@/components/command-palette')
    render(React.createElement(CommandPalette, { open: true, onOpenChange: vi.fn(), userId: 'u1' }))
    await act(async () => { await Promise.resolve() })

    expect(h.getRecentCommands).toHaveBeenCalledWith(5)
    expect(h.searchCommands).toHaveBeenCalledWith(expect.objectContaining({ query: '', sortBy: 'popular' }))
    expect(document.body.textContent).toContain('Deploy to prod')
  })

  it('never loads recent commands or searches while closed', async () => {
    h.getRecentCommands.mockResolvedValue([])
    h.searchCommands.mockResolvedValue({ commands: [] })

    const { CommandPalette } = await import('@/components/command-palette')
    render(React.createElement(CommandPalette, { open: false, onOpenChange: vi.fn(), userId: 'u1' }))
    await act(async () => { await Promise.resolve() })

    expect(h.getRecentCommands).not.toHaveBeenCalled()
    expect(h.searchCommands).not.toHaveBeenCalled()
  })

  it('typing a real search query re-searches with sortBy: relevance', async () => {
    h.getRecentCommands.mockResolvedValue([])
    h.searchCommands.mockResolvedValue({ commands: [makeCommand({ id: 'found-1', name: 'Write a test' })] })

    const { CommandPalette } = await import('@/components/command-palette')
    render(React.createElement(CommandPalette, { open: true, onOpenChange: vi.fn(), userId: 'u1' }))
    await act(async () => { await Promise.resolve() })

    const input = document.body.querySelector('input[placeholder="Search commands..."]') as HTMLInputElement
    expect(input).toBeTruthy()

    await act(async () => {
      setInputValue(input, 'test')
      await Promise.resolve()
    })

    expect(h.searchCommands).toHaveBeenCalledWith(expect.objectContaining({ query: 'test', sortBy: 'relevance' }))
  })

  it('selecting a command with zero real variables executes it directly, closing the palette and showing the real progress tracker', async () => {
    const noVarCommand = makeCommand({ id: 'cmd-novars', name: 'Quick deploy', variables: [] })
    h.getRecentCommands.mockResolvedValue([noVarCommand])
    h.searchCommands.mockResolvedValue({ commands: [] })
    h.executeCommand.mockResolvedValue({ status: 'running' })
    const onOpenChange = vi.fn()

    const { CommandPalette } = await import('@/components/command-palette')
    render(React.createElement(CommandPalette, { open: true, onOpenChange, userId: 'u1', chatId: 'chat-1' }))
    await act(async () => { await Promise.resolve() })

    const item = Array.from(document.body.querySelectorAll('[data-value="cmd-novars"]'))[0] as HTMLElement
    expect(item).toBeTruthy()
    await act(async () => {
      item.click()
      await Promise.resolve()
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(h.executeCommand).toHaveBeenCalledWith('cmd-novars', {}, { chatId: 'chat-1' })
    expect(document.body.querySelector('[data-testid="stub-progress-tracker"]')).not.toBeNull()
  })

  it('selecting a command WITH real variables shows the real variable-prompt dialog instead of executing immediately', async () => {
    const withVarsCommand = makeCommand({ id: 'cmd-vars', name: 'Deploy with options', variables: [{ name: 'env', label: 'Environment', type: 'text', required: true }] })
    h.getRecentCommands.mockResolvedValue([withVarsCommand])
    h.searchCommands.mockResolvedValue({ commands: [] })

    const { CommandPalette } = await import('@/components/command-palette')
    render(React.createElement(CommandPalette, { open: true, onOpenChange: vi.fn(), userId: 'u1' }))
    await act(async () => { await Promise.resolve() })

    const item = document.body.querySelector('[data-value="cmd-vars"]') as HTMLElement
    await act(async () => {
      item.click()
      await Promise.resolve()
    })

    expect(h.executeCommand).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="stub-variable-prompt"]')).not.toBeNull()
  })

  it('the real global Cmd+K / Ctrl+K keyboard shortcut toggles the palette open', async () => {
    h.getRecentCommands.mockResolvedValue([])
    h.searchCommands.mockResolvedValue({ commands: [] })
    const onOpenChange = vi.fn()

    const { CommandPalette } = await import('@/components/command-palette')
    render(React.createElement(CommandPalette, { open: false, onOpenChange, userId: 'u1' }))
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('never searches/loads recent commands for an anonymous visitor (no real userId)', async () => {
    h.getRecentCommands.mockResolvedValue([])
    h.searchCommands.mockResolvedValue({ commands: [] })

    const { CommandPalette } = await import('@/components/command-palette')
    render(React.createElement(CommandPalette, { open: true, onOpenChange: vi.fn(), userId: '' }))
    await act(async () => { await Promise.resolve() })

    expect(h.getRecentCommands).not.toHaveBeenCalled()
  })
})
