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
 * #1204 (Coverage Phase 4) — ChatInput (components/chat/chat-input.tsx, 275
 * lines, reached live via components/chats/chat-detail-client.tsx <-
 * app/chats/[chatId]/page.tsx) had zero test coverage despite owning real
 * sessionStorage persistence and attachment orchestration.
 *
 * The prompt-input.tsx helper functions (createImageAttachment,
 * savePromptToStorage, etc.) are already independently tested
 * (prompt-input-helpers-1204.test.ts) — mocked here at their real exported
 * boundary, along with the presentational PromptInput and Suggestion
 * pieces, so this file verifies only ChatInput's own orchestration:
 * sessionStorage save/restore/clear timing, attachment wiring, and the 8
 * suggestion buttons' deferred-submit behavior.
 */

const h = vi.hoisted(() => ({
  createImageAttachment: vi.fn(),
  createImageAttachmentFromStored: vi.fn(),
  savePromptToStorage: vi.fn(),
  loadPromptFromStorage: vi.fn(),
  clearPromptFromStorage: vi.fn(),
}))

vi.mock('@/components/ai-elements/prompt-input', () => ({
  ...h,
  PromptInput: ({ children, onSubmit }: any) =>
    React.createElement('form', { 'data-testid': 'stub-prompt-form', onSubmit }, children),
  PromptInputImagePreview: ({ attachments, onRemove }: any) =>
    React.createElement('div', { 'data-testid': 'stub-attachments' },
      attachments.map((a: any) => React.createElement('button', { key: a.id, type: 'button', onClick: () => onRemove(a.id) }, `remove:${a.id}`))
    ),
  PromptInputTextarea: React.forwardRef(({ value, onChange, ...props }: any, ref: any) =>
    React.createElement('textarea', { ref, 'data-testid': 'stub-textarea', value, onChange, ...props })),
  PromptInputToolbar: ({ children }: any) => React.createElement('div', null, children),
  PromptInputTools: ({ children }: any) => React.createElement('div', null, children),
  PromptInputImageButton: ({ onImageSelect }: any) =>
    React.createElement('button', { 'data-testid': 'stub-image-btn', type: 'button', onClick: () => onImageSelect([new File(['x'], 'pic.png')]) }, 'Image'),
  PromptInputMicButton: ({ onTranscript, onError }: any) =>
    React.createElement('button', {
      'data-testid': 'stub-mic-btn',
      type: 'button',
      onClick: () => onTranscript('hello from mic'),
      onContextMenu: (e: any) => { e.preventDefault(); onError('mic failed') },
    }, 'Mic'),
  PromptInputSubmit: ({ disabled, status }: any) =>
    React.createElement('button', { 'data-testid': 'stub-submit-btn', type: 'submit', disabled }, status),
}))

vi.mock('@/components/ai-elements/suggestion', () => ({
  Suggestions: ({ children }: any) => React.createElement('div', { 'data-testid': 'stub-suggestions' }, children),
  Suggestion: ({ suggestion, onClick }: any) => React.createElement('button', { type: 'button', onClick }, suggestion),
}))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function baseProps(overrides: Record<string, any> = {}) {
  return {
    message: '',
    setMessage: vi.fn(),
    onSubmit: vi.fn(),
    isLoading: false,
    showSuggestions: false,
    ...overrides,
  }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('ChatInput — real sessionStorage + attachment + suggestion orchestration coverage (#1204)', () => {
  it('saves to real sessionStorage via savePromptToStorage when the real message is non-empty', async () => {
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ message: 'Build me a CRM' })))

    expect(h.savePromptToStorage).toHaveBeenCalledWith('Build me a CRM', [])
    expect(h.clearPromptFromStorage).not.toHaveBeenCalled()
  })

  it('clears real sessionStorage when both message and attachments are genuinely empty', async () => {
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ message: '' })))

    expect(h.clearPromptFromStorage).toHaveBeenCalled()
    expect(h.savePromptToStorage).not.toHaveBeenCalled()
  })

  it('restores a real stored draft on mount only when there is genuinely no existing message/attachments', async () => {
    h.loadPromptFromStorage.mockReturnValue({ message: 'Restored draft', attachments: [] })
    const setMessage = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ message: '', setMessage })))

    expect(setMessage).toHaveBeenCalledWith('Restored draft')
  })

  it('never restores a stored draft when the real message already has content', async () => {
    h.loadPromptFromStorage.mockReturnValue({ message: 'Should not be used', attachments: [] })
    const setMessage = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ message: 'Already typing', setMessage })))

    expect(setMessage).not.toHaveBeenCalled()
  })

  it('restores real stored attachments via createImageAttachmentFromStored and calls onAttachmentsChange', async () => {
    h.loadPromptFromStorage.mockReturnValue({ message: '', attachments: [{ id: 'stored-1', dataUrl: 'data:x' }] })
    h.createImageAttachmentFromStored.mockImplementation((a: any) => ({ ...a, restored: true }))
    const onAttachmentsChange = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ onAttachmentsChange })))

    expect(h.createImageAttachmentFromStored).toHaveBeenCalledWith({ id: 'stored-1', dataUrl: 'data:x' }, 0, [{ id: 'stored-1', dataUrl: 'data:x' }])
    expect(onAttachmentsChange).toHaveBeenCalledWith([{ id: 'stored-1', dataUrl: 'data:x', restored: true }])
  })

  it('a real image-button selection creates a real attachment and appends it via onAttachmentsChange', async () => {
    h.createImageAttachment.mockResolvedValue({ id: 'new-1', dataUrl: 'data:new' })
    const onAttachmentsChange = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ attachments: [{ id: 'existing-1', dataUrl: 'data:old' }], onAttachmentsChange })))

    const imageBtn = host.querySelector('[data-testid="stub-image-btn"]') as HTMLButtonElement
    await act(async () => { imageBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(onAttachmentsChange).toHaveBeenCalledWith([
      { id: 'existing-1', dataUrl: 'data:old' },
      { id: 'new-1', dataUrl: 'data:new' },
    ])
  })

  it('a real remove-attachment click filters out only the real matching attachment id', async () => {
    const onAttachmentsChange = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({
      attachments: [{ id: 'att-a', dataUrl: 'x' }, { id: 'att-b', dataUrl: 'y' }],
      onAttachmentsChange,
    })))

    const removeBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'remove:att-a') as HTMLButtonElement
    await act(async () => { removeBtn.click() })

    expect(onAttachmentsChange).toHaveBeenCalledWith([{ id: 'att-b', dataUrl: 'y' }])
  })

  it('a real mic transcript appends to the existing real message with a leading space when non-empty', async () => {
    const setMessage = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ message: 'Build a', setMessage })))

    const micBtn = host.querySelector('[data-testid="stub-mic-btn"]') as HTMLButtonElement
    await act(async () => { micBtn.click() })

    expect(setMessage).toHaveBeenCalledWith('Build a hello from mic')
  })

  it('submitting clears real sessionStorage immediately and calls onSubmit with the real attachment URLs', async () => {
    const onSubmit = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({
      message: 'Go',
      onSubmit,
      attachments: [{ id: 'a1', dataUrl: 'data:1' }],
    })))

    vi.clearAllMocks()
    const form = host.querySelector('[data-testid="stub-prompt-form"]') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(h.clearPromptFromStorage).toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), [{ url: 'data:1' }])
  })

  it('submitting with genuinely no attachments calls onSubmit with undefined (never an empty array)', async () => {
    const onSubmit = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ message: 'Go', onSubmit })))

    const form = host.querySelector('[data-testid="stub-prompt-form"]') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), undefined)
  })

  it('never renders the real suggestions block when showSuggestions is false', async () => {
    const { ChatInput } = await import('@/components/chat/chat-input')
    render(React.createElement(ChatInput, baseProps({ showSuggestions: false })))

    expect(host.querySelector('[data-testid="stub-suggestions"]')).toBeNull()
  })

  it('renders all 8 real suggestion buttons when showSuggestions is true, and clicking one sets the real message then requestSubmits the real enclosing form after the real deferred timeout', async () => {
    // textareaRef must attach to the REAL rendered textarea (via a
    // forwardRef stub, matching the real PromptInputTextarea's own ref
    // forwarding) so textareaRef.current.form resolves to the mocked
    // PromptInput's own real rendered <form> element — the actual DOM
    // ancestor the real component relies on, not a separately constructed,
    // never-rendered form/textarea pair.
    vi.useFakeTimers()
    const setMessage = vi.fn()
    const { ChatInput } = await import('@/components/chat/chat-input')
    const textareaRef = { current: null as HTMLTextAreaElement | null }

    render(React.createElement(ChatInput, baseProps({ setMessage, showSuggestions: true, textareaRef })))

    const renderedForm = host.querySelector('form') as HTMLFormElement
    renderedForm.requestSubmit = vi.fn()
    expect(textareaRef.current?.form).toBe(renderedForm)

    const suggestionButtons = Array.from(host.querySelectorAll('[data-testid="stub-suggestions"] button'))
    expect(suggestionButtons.length).toBe(8)

    const landingBtn = suggestionButtons.find((b) => b.textContent === 'Landing page') as HTMLButtonElement
    await act(async () => { landingBtn.click() })
    expect(setMessage).toHaveBeenCalledWith('Landing page')

    await act(async () => { vi.advanceTimersByTime(0) })
    expect(renderedForm.requestSubmit).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
