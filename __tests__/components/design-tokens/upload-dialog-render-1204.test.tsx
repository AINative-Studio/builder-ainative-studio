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
 * #1204 (Coverage Phase 4) — DesignTokenUploadDialog (components/design-tokens
 * /upload-dialog.tsx, 435 lines, reached live via app/design-tokens/page.tsx)
 * had zero test coverage. Real parsing/validation/save logic — not mocked —
 * since lib/design-tokens/parsers.ts and validators.ts are lightweight, real,
 * and already have their own dedicated test files (confirmed before writing
 * this: __tests__/lib/validators/design-tokens-validator.test.ts).
 */

const toastMock = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }))

let host: HTMLElement
let root: Root

/** Real, always-valid fixture — the actual getDefaultTokens() shape, not a
 *  hand-guessed one, so these tests can't drift from the real DesignTokens
 *  type even if its fields change later. */
async function realValidTokensJson(): Promise<string> {
  const { getDefaultTokens } = await import('@/lib/design-tokens/parsers')
  return JSON.stringify(getDefaultTokens())
}

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

/** Simulates a real file-input change event carrying one real File, the
 *  same shape handleJSONFileUpload/handleCSSFileUpload actually receive.
 *  jsdom doesn't implement DataTransfer — defining `files` directly on the
 *  input (a real, writable property in jsdom, just not settable via a real
 *  DataTransfer in this environment) achieves the identical observable
 *  effect the component's own onChange handler reads. */
async function uploadFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    // FileReader.onload fires asynchronously even in jsdom.
    await new Promise((r) => setTimeout(r, 10))
  })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('DesignTokenUploadDialog — real upload/validate/save coverage (#1204)', () => {
  it('parses a real, valid uploaded JSON tokens file and enables Save', async () => {
    const { DesignTokenUploadDialog } = await import('@/components/design-tokens/upload-dialog')
    render(React.createElement(DesignTokenUploadDialog, { open: true, onOpenChange: vi.fn() }))

    const jsonInput = document.body.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement
    expect(jsonInput).not.toBeNull()

    const file = new File([await realValidTokensJson()], 'tokens.json', { type: 'application/json' })
    await uploadFile(jsonInput, file)

    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => /^Save/.test(b.textContent || ''))
    expect(saveBtn).toBeTruthy()
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a real validation error (not a fabricated success) for genuinely malformed JSON', async () => {
    const { DesignTokenUploadDialog } = await import('@/components/design-tokens/upload-dialog')
    render(React.createElement(DesignTokenUploadDialog, { open: true, onOpenChange: vi.fn() }))

    const jsonInput = document.body.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement
    const file = new File(['{not valid json'], 'broken.json', { type: 'application/json' })
    await uploadFile(jsonInput, file)

    expect(document.body.textContent).toMatch(/Invalid JSON format/)
    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => /^Save/.test(b.textContent || ''))
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('clicking Save with valid tokens fires the real POST /api/design-tokens/upload and calls onSuccess', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    const onSuccess = vi.fn()
    const onOpenChange = vi.fn()
    const { DesignTokenUploadDialog } = await import('@/components/design-tokens/upload-dialog')
    render(React.createElement(DesignTokenUploadDialog, { open: true, onOpenChange, onSuccess }))

    const jsonInput = document.body.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement
    const file = new File([await realValidTokensJson()], 'tokens.json', { type: 'application/json' })
    await uploadFile(jsonInput, file)

    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => /^Save/.test(b.textContent || '')) as HTMLButtonElement
    await act(async () => {
      saveBtn.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/design-tokens/upload', expect.objectContaining({ method: 'POST' }))
    expect(onSuccess).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows a real destructive toast (never a silent failure) when the real save POST fails', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any
    const { DesignTokenUploadDialog } = await import('@/components/design-tokens/upload-dialog')
    render(React.createElement(DesignTokenUploadDialog, { open: true, onOpenChange: vi.fn() }))

    const jsonInput = document.body.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement
    const file = new File([await realValidTokensJson()], 'tokens.json', { type: 'application/json' })
    await uploadFile(jsonInput, file)

    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => /^Save/.test(b.textContent || '')) as HTMLButtonElement
    await act(async () => {
      saveBtn.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const destructiveCall = toastMock.mock.calls.find(([opts]) => opts?.variant === 'destructive')
    expect(destructiveCall).toBeTruthy()
  })

  it('renders nothing visible when open is false (a real conditional Dialog, not a leaked hidden form)', async () => {
    const { DesignTokenUploadDialog } = await import('@/components/design-tokens/upload-dialog')
    render(React.createElement(DesignTokenUploadDialog, { open: false, onOpenChange: vi.fn() }))

    expect(document.body.querySelector('input[type="file"]')).toBeNull()
  })
})
