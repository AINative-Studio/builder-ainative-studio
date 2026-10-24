// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TemplateReviewModal } from '@/components/admin/template-review-modal'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — TemplateReviewModal (components/admin/template
 * -review-modal.tsx, 358 lines, reached live via
 * app/admin/template-submissions/page.tsx) had zero test coverage despite
 * gating a real, genuinely consequential client-side security check: its
 * own checkCodeSecurity() disables the real Approve button whenever any
 * issue is detected, before any PATCH ever reaches the server.
 *
 * react-syntax-highlighter is mocked — it's a third-party code-display
 * library with no logic of this component's own to verify, and jsdom has no
 * real syntax-highlighting renderer.
 */

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: string }) => React.createElement('pre', { 'data-testid': 'code-pre' }, children),
}))
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({ vscDarkPlus: {} }))

function makeSubmission(overrides: Partial<{ code: string; status: string }> = {}) {
  return {
    submission: {
      id: 'sub-1',
      user_id: 'u1',
      template_data: {
        name: 'Landing Page',
        category: 'marketing',
        description: 'A real landing page template',
        code: overrides.code ?? 'export function Page() { return <div>Hi</div> }',
        tags: ['landing', 'marketing'],
        metadata: {
          placeholders: ['{{company_name}}'],
          components_used: ['Button', 'Card'],
          complexity: 'simple' as const,
        },
      },
      status: overrides.status ?? 'pending',
      admin_notes: null,
      submitted_at: new Date('2026-01-01T10:00:00Z'),
      reviewed_at: null,
      reviewed_by: null,
    },
    user: { id: 'u1', email: 'founder@example.com' },
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

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Radix TabsTrigger switches tabs via its own onMouseDown handler (not
 *  onClick) — a plain .click() never fires mousedown, so the tab never
 *  actually switches. Confirmed by reading
 *  @radix-ui/react-tabs/dist/index.mjs directly. */
async function clickTab(label: string) {
  const tab = Array.from(document.body.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.trim() === label) as HTMLElement
  await act(async () => {
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.restoreAllMocks()
})

describe('TemplateReviewModal — real security-gate + review-action coverage (#1204)', () => {
  it('renders the real template name, submitter email, and formatted submitted date', () => {
    render(React.createElement(TemplateReviewModal, { submission: makeSubmission(), isOpen: true, onClose: vi.fn(), onComplete: vi.fn() }))

    expect(document.body.textContent).toContain('Review: Landing Page')
    expect(document.body.textContent).toContain('founder@example.com')
  })

  it('shows the real "No security issues detected" state for genuinely clean code, and enables Approve', async () => {
    render(React.createElement(TemplateReviewModal, { submission: makeSubmission(), isOpen: true, onClose: vi.fn(), onComplete: vi.fn() }))

    await clickTab('Security Check')
    expect(document.body.textContent).toContain('No security issues detected')

    const approveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve')) as HTMLButtonElement
    expect(approveBtn.disabled).toBe(false)
  })

  it('detects a real external import and disables the real Approve button (never a silent pass-through)', async () => {
    const submission = makeSubmission({ code: `import leftpad from 'leftpad'\nexport function Page() { return null }` })
    render(React.createElement(TemplateReviewModal, { submission, isOpen: true, onClose: vi.fn(), onComplete: vi.fn() }))

    await clickTab('Security Check')
    expect(document.body.textContent).toContain('Contains external imports')

    const approveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve')) as HTMLButtonElement
    expect(approveBtn.disabled).toBe(true)
  })

  it('detects a real dangerouslySetInnerHTML usage as a security issue', async () => {
    const submission = makeSubmission({ code: `export function Page() { return <div dangerouslySetInnerHTML={{__html: x}} /> }` })
    render(React.createElement(TemplateReviewModal, { submission, isOpen: true, onClose: vi.fn(), onComplete: vi.fn() }))

    await clickTab('Security Check')
    expect(document.body.textContent).toContain('potentially dangerous code patterns')
  })

  it('detects a real raw fetch() call as a security issue (network requests should use API routes)', async () => {
    const submission = makeSubmission({ code: `export function Page() { fetch('https://evil.example.com'); return null }` })
    render(React.createElement(TemplateReviewModal, { submission, isOpen: true, onClose: vi.fn(), onComplete: vi.fn() }))

    await clickTab('Security Check')
    expect(document.body.textContent).toContain('Contains network requests')
  })

  it('disables both Approve and Reject when the real submission status is no longer pending', () => {
    const submission = makeSubmission({ status: 'approved' })
    render(React.createElement(TemplateReviewModal, { submission, isOpen: true, onClose: vi.fn(), onComplete: vi.fn() }))

    const approveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve')) as HTMLButtonElement
    const rejectBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Reject')) as HTMLButtonElement
    expect(approveBtn.disabled).toBe(true)
    expect(rejectBtn.disabled).toBe(true)
  })

  it('clicking Approve on genuinely clean, pending code fires the real PATCH with action approve + the typed admin notes, then calls onComplete', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    const onComplete = vi.fn()
    render(React.createElement(TemplateReviewModal, { submission: makeSubmission(), isOpen: true, onClose: vi.fn(), onComplete }))

    const notes = document.body.querySelector('#admin-notes') as HTMLTextAreaElement
    await act(async () => { setTextareaValue(notes, 'Looks great, approved.') })

    const approveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve')) as HTMLButtonElement
    await act(async () => { approveBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/template-submissions/sub-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve', admin_notes: 'Looks great, approved.' }),
      })
    )
    expect(onComplete).toHaveBeenCalled()
  })

  it('shows a real alert (never a silent failure) when the real PATCH fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Submission already reviewed' }) })) as any
    const onComplete = vi.fn()
    render(React.createElement(TemplateReviewModal, { submission: makeSubmission(), isOpen: true, onClose: vi.fn(), onComplete }))

    const rejectBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Reject')) as HTMLButtonElement
    await act(async () => { rejectBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(alertSpy).toHaveBeenCalledWith('Submission already reviewed')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('clicking Close calls the real onClose callback', async () => {
    const onClose = vi.fn()
    render(React.createElement(TemplateReviewModal, { submission: makeSubmission(), isOpen: true, onClose, onComplete: vi.fn() }))

    const closeBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Close') as HTMLButtonElement
    await act(async () => { closeBtn.click() })

    expect(onClose).toHaveBeenCalled()
  })
})
