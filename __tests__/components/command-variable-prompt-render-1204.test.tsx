// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { AgentCommand, CommandVariable } from '@/lib/types/agent-commands'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — VariablePromptDialog (components/command
 * -variable-prompt.tsx, 345 lines, reached live via command-palette.tsx ->
 * app/layout.tsx) had zero test coverage. Real per-type input rendering
 * (text/number/boolean/select/file), real default-value hydration, and
 * real validation-gated submit. lib/validation/command-variables.ts's
 * validateVariables() is already independently tested
 * (__tests__/lib/command-variables.test.ts) — mocked here at its real
 * exported boundary, not re-tested.
 *
 * Reuses the real, fully type-checked AgentCommand fixture pattern
 * established in command-palette-render-1204.test.tsx (no `as any` escape
 * hatch — a loosely-typed fixture there silently hid a real crash).
 */

const h = vi.hoisted(() => ({ validateVariables: vi.fn() }))
vi.mock('@/lib/validation/command-variables', () => h)

function makeCommand(variables: CommandVariable[]): AgentCommand {
  return {
    metadata: {
      id: 'cmd-1', name: 'Deploy app', description: 'Deploys the real app',
      category: 'deployment', tags: [], author: { id: 'system', name: 'System' },
      isBuiltIn: true, isTeam: false, usageCount: 0, isActive: true,
      createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    },
    template: 'deploy {{env}}',
    variables,
    requiredSkills: [],
    preConditions: [],
    checkpoints: [],
    output: { type: 'deployment' },
    version: '1.0.0',
  }
}

function textVar(overrides: Partial<CommandVariable> = {}): CommandVariable {
  return { name: 'env', label: 'Environment', type: 'text', required: true, ...overrides }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

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

describe('VariablePromptDialog — real form/validation coverage (#1204)', () => {
  it('renders the real command name/description and a real labeled input for each real variable', async () => {
    const { VariablePromptDialog } = await import('@/components/command-variable-prompt')
    const command = makeCommand([textVar()])

    render(React.createElement(VariablePromptDialog, {
      open: true, onOpenChange: vi.fn(), command, onSubmit: vi.fn(), onCancel: vi.fn(),
    }))

    expect(document.body.textContent).toContain('Configure: Deploy app')
    expect(document.body.textContent).toContain('Deploys the real app')
    expect(document.body.querySelector('#env')).not.toBeNull()
  })

  it('hydrates a real default value from the variable definition on mount', async () => {
    const { VariablePromptDialog } = await import('@/components/command-variable-prompt')
    const command = makeCommand([textVar({ defaultValue: 'production' })])

    render(React.createElement(VariablePromptDialog, {
      open: true, onOpenChange: vi.fn(), command, onSubmit: vi.fn(), onCancel: vi.fn(),
    }))

    const input = document.body.querySelector('#env') as HTMLInputElement
    expect(input.value).toBe('production')
  })

  it('submitting with genuinely invalid values never calls onSubmit, shows the real validation errors instead', async () => {
    h.validateVariables.mockReturnValue({ valid: false, errors: { env: 'Environment is required' } })
    const onSubmit = vi.fn()
    const { VariablePromptDialog } = await import('@/components/command-variable-prompt')
    const command = makeCommand([textVar()])

    render(React.createElement(VariablePromptDialog, {
      open: true, onOpenChange: vi.fn(), command, onSubmit, onCancel: vi.fn(),
    }))

    const form = document.body.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Environment is required')
  })

  it('submitting with genuinely valid values calls onSubmit with the real entered values', async () => {
    h.validateVariables.mockReturnValue({ valid: true, errors: {} })
    const onSubmit = vi.fn()
    const { VariablePromptDialog } = await import('@/components/command-variable-prompt')
    const command = makeCommand([textVar()])

    render(React.createElement(VariablePromptDialog, {
      open: true, onOpenChange: vi.fn(), command, onSubmit, onCancel: vi.fn(),
    }))

    const input = document.body.querySelector('#env') as HTMLInputElement
    await act(async () => { setInputValue(input, 'staging') })

    const form = document.body.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ env: 'staging' }))
  })

  it('typing into a field clears the real prior error for that field (not every field)', async () => {
    h.validateVariables.mockReturnValue({ valid: false, errors: { env: 'Environment is required' } })
    const { VariablePromptDialog } = await import('@/components/command-variable-prompt')
    const command = makeCommand([textVar()])

    render(React.createElement(VariablePromptDialog, {
      open: true, onOpenChange: vi.fn(), command, onSubmit: vi.fn(), onCancel: vi.fn(),
    }))

    const form = document.body.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(document.body.textContent).toContain('Environment is required')

    const input = document.body.querySelector('#env') as HTMLInputElement
    await act(async () => { setInputValue(input, 'p') })

    expect(document.body.textContent).not.toContain('Environment is required')
  })

  it('Cancel resets real values to initialValues and calls the real onCancel callback', async () => {
    h.validateVariables.mockReturnValue({ valid: true, errors: {} })
    const onCancel = vi.fn()
    const { VariablePromptDialog } = await import('@/components/command-variable-prompt')
    const command = makeCommand([textVar()])

    render(React.createElement(VariablePromptDialog, {
      open: true, onOpenChange: vi.fn(), command, onSubmit: vi.fn(), onCancel, initialValues: { env: 'dev' },
    }))

    const input = document.body.querySelector('#env') as HTMLInputElement
    await act(async () => { setInputValue(input, 'prod-typed-but-not-submitted') })

    const cancelBtn = Array.from(document.body.querySelectorAll('button')).find((b) => /^Cancel$/.test((b.textContent || '').trim())) as HTMLButtonElement
    await act(async () => { cancelBtn.click() })

    expect(onCancel).toHaveBeenCalled()
  })

  it('renders a real pre-conditions warning only when the command genuinely has pre-conditions', async () => {
    const { VariablePromptDialog } = await import('@/components/command-variable-prompt')
    const withPreConditions: AgentCommand = { ...makeCommand([textVar()]), preConditions: [{ type: 'file_exists', description: 'config.json must exist' } as any] }

    render(React.createElement(VariablePromptDialog, {
      open: true, onOpenChange: vi.fn(), command: withPreConditions, onSubmit: vi.fn(), onCancel: vi.fn(),
    }))

    expect(document.body.textContent).toMatch(/1 pre-condition/)
  })

  it('never shows a pre-conditions warning for a command with none', async () => {
    const { VariablePromptDialog } = await import('@/components/command-variable-prompt')
    const command = makeCommand([textVar()])

    render(React.createElement(VariablePromptDialog, {
      open: true, onOpenChange: vi.fn(), command, onSubmit: vi.fn(), onCancel: vi.fn(),
    }))

    expect(document.body.textContent).not.toMatch(/pre-condition/)
  })
})
