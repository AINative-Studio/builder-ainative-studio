// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { AgentCommand, CommandVariable } from '@/lib/types/agent-commands'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // Radix's Select measures its trigger via ResizeObserver, which jsdom
  // doesn't implement. A no-op stub is enough — this test only needs the
  // trigger/content to mount and render text, not real resize behavior.
  if (!(globalThis as any).ResizeObserver) {
    ;(globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

/**
 * #1204 (Coverage Phase 4) — follow-up to command-variable-prompt-render-
 * 1204.test.tsx, which only exercised the 'text' branch of renderInput's
 * per-type switch (components/command-variable-prompt.tsx). The real gap:
 * 'number'/'boolean'/'multiselect'/'file'/the unknown-type default (null),
 * plus the required-skills badge block — none rendered by any existing
 * test. Same fixture + mock convention as that file: a real, fully
 * type-checked AgentCommand/CommandVariable (no `as any`), validateVariables
 * mocked at its real exported boundary. Queries document.body (not the
 * render host) because Dialog portals its content there, same as the
 * original 1204 test file does.
 */

const h = vi.hoisted(() => ({ validateVariables: vi.fn() }))
vi.mock('@/lib/validation/command-variables', () => h)

function makeCommand(variables: CommandVariable[], overrides: Partial<AgentCommand> = {}): AgentCommand {
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

async function importDialog() {
  const mod = await import('@/components/command-variable-prompt')
  return mod.VariablePromptDialog
}

describe('VariablePromptDialog — number/boolean/multiselect/file inputs (#1204)', () => {
  it('renders a real number input and parses its typed value as a float, not a string', async () => {
    const onSubmit = vi.fn()
    const numberVar: CommandVariable = { name: 'replicas', label: 'Replicas', type: 'number', required: true }
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit,
      command: makeCommand([numberVar]),
    }))

    const input = document.body.querySelector('input[type="number"]') as HTMLInputElement
    expect(input).not.toBeNull()
    act(() => { setInputValue(input, '3') })

    h.validateVariables.mockReturnValue({ valid: true, errors: {} })
    const form = document.body.querySelector('form') as HTMLFormElement
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(onSubmit).toHaveBeenCalledWith({ replicas: 3 })
  })

  it('renders a real checkbox for a boolean variable and toggles its value on click', async () => {
    const onSubmit = vi.fn()
    const boolVar: CommandVariable = { name: 'dryRun', label: 'Dry run', type: 'boolean', required: false, description: 'Simulate only' }
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit,
      command: makeCommand([boolVar]),
    }))

    expect(document.body.textContent).toContain('Simulate only')
    const checkbox = document.body.querySelector('#dryRun') as HTMLButtonElement
    expect(checkbox).not.toBeNull()
    act(() => { checkbox.click() })

    h.validateVariables.mockReturnValue({ valid: true, errors: {} })
    const form = document.body.querySelector('form') as HTMLFormElement
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(onSubmit).toHaveBeenCalledWith({ dryRun: true })
  })

  it('renders a multiselect as one checkbox per option and accumulates checked values into a real array', async () => {
    const onSubmit = vi.fn()
    const multiVar: CommandVariable = {
      name: 'regions', label: 'Regions', type: 'multiselect', required: false,
      options: [
        { label: 'US East', value: 'us-east' },
        { label: 'EU West', value: 'eu-west', description: 'Ireland' },
      ],
    }
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit,
      command: makeCommand([multiVar]),
    }))

    expect(document.body.textContent).toContain('Ireland')
    const usCheckbox = document.body.querySelector('#regions-us-east') as HTMLButtonElement
    const euCheckbox = document.body.querySelector('#regions-eu-west') as HTMLButtonElement
    act(() => { usCheckbox.click() })
    act(() => { euCheckbox.click() })

    h.validateVariables.mockReturnValue({ valid: true, errors: {} })
    const form = document.body.querySelector('form') as HTMLFormElement
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(onSubmit).toHaveBeenCalledWith({ regions: ['us-east', 'eu-west'] })
  })

  it('unchecking a previously-checked multiselect option removes only that value from the array', async () => {
    const onSubmit = vi.fn()
    const multiVar: CommandVariable = {
      name: 'regions', label: 'Regions', type: 'multiselect', required: false,
      options: [{ label: 'US East', value: 'us-east' }, { label: 'EU West', value: 'eu-west' }],
    }
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit,
      command: makeCommand([multiVar]),
      initialValues: { regions: ['us-east', 'eu-west'] },
    }))

    const usCheckbox = document.body.querySelector('#regions-us-east') as HTMLButtonElement
    act(() => { usCheckbox.click() }) // uncheck

    h.validateVariables.mockReturnValue({ valid: true, errors: {} })
    const form = document.body.querySelector('form') as HTMLFormElement
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(onSubmit).toHaveBeenCalledWith({ regions: ['eu-west'] })
  })

  it('renders a real file input for a file variable and captures the picked file name', async () => {
    const onSubmit = vi.fn()
    const fileVar: CommandVariable = { name: 'manifest', label: 'Manifest', type: 'file', required: true }
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit,
      command: makeCommand([fileVar]),
    }))

    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).not.toBeNull()
    const file = new File(['content'], 'deploy.yaml', { type: 'text/yaml' })
    Object.defineProperty(input, 'files', { value: [file] })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })

    h.validateVariables.mockReturnValue({ valid: true, errors: {} })
    const form = document.body.querySelector('form') as HTMLFormElement
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(onSubmit).toHaveBeenCalledWith({ manifest: 'deploy.yaml' })
  })

  it('a file input change with no actual file picked never calls handleValueChange (real empty-FileList guard)', async () => {
    const onSubmit = vi.fn()
    const fileVar: CommandVariable = { name: 'manifest', label: 'Manifest', type: 'file', required: false }
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit,
      command: makeCommand([fileVar]),
    }))

    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [] })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })

    h.validateVariables.mockReturnValue({ valid: true, errors: {} })
    const form = document.body.querySelector('form') as HTMLFormElement
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(onSubmit).toHaveBeenCalledWith({})
  })

  it('an unrecognized variable type renders nothing for that variable (the default: return null branch)', async () => {
    const weirdVar = { name: 'mystery', label: 'Mystery', type: 'json' as unknown as CommandVariable['type'], required: false } as CommandVariable
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn(),
      command: makeCommand([weirdVar]),
    }))

    expect(document.body.textContent).not.toContain('Mystery')
  })
})

describe('VariablePromptDialog — required skills badges (#1204)', () => {
  it('renders a real badge per required skill when the command genuinely has required skills', async () => {
    const textVar: CommandVariable = { name: 'env', label: 'Environment', type: 'text', required: true }
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn(),
      command: makeCommand([textVar], { requiredSkills: ['docker', 'kubernetes'] }),
    }))

    expect(document.body.textContent).toContain('Required Skills')
    expect(document.body.textContent).toContain('docker')
    expect(document.body.textContent).toContain('kubernetes')
  })

  it('never renders the required-skills section for a command with none', async () => {
    const textVar: CommandVariable = { name: 'env', label: 'Environment', type: 'text', required: true }
    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn(),
      command: makeCommand([textVar], { requiredSkills: [] }),
    }))

    expect(document.body.textContent).not.toContain('Required Skills')
  })
})

describe('VariablePromptDialog — select input (#1204)', () => {
  it('renders a select trigger with the real placeholder and shows an error state when a validation error exists', async () => {
    const selectVar: CommandVariable = {
      name: 'env', label: 'Environment', type: 'select', required: true,
      placeholder: 'Choose an environment',
      options: [{ label: 'Staging', value: 'staging' }, { label: 'Production', value: 'production', description: 'Live traffic' }],
    }
    h.validateVariables.mockReturnValue({ valid: false, errors: { env: 'Environment is required' } })

    const Dialog = await importDialog()
    render(React.createElement(Dialog, {
      open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn(),
      command: makeCommand([selectVar]),
    }))

    expect(document.body.textContent).toContain('Choose an environment')

    const form = document.body.querySelector('form') as HTMLFormElement
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(document.body.textContent).toContain('Environment is required')
  })
})
