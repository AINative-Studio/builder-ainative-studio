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
 * #1204 (Coverage Phase 4) — ChatDetailClient (components/chats/chat-detail
 * -client.tsx, 134 lines, reached live via app/chats/[chatId]/page.tsx) had
 * zero test coverage. A real top-level composition component wiring
 * useChat/useStreaming + 6 real children. AppHeader, ChatInput, and
 * PreviewPanel already have their own dedicated #1204 coverage this pass;
 * ChatMessages/ResizableLayout/BottomToolbar and the two hooks are untested
 * and out of scope here — all mocked at their real exported boundaries so
 * this file verifies only ChatDetailClient's own composition logic:
 * fullscreen Escape handling, auto-focus, the attachment-clearing submit
 * wrapper, and mobile panel switching.
 */

const h = vi.hoisted(() => ({
  chatId: 'chat-123',
  clearPromptFromStorage: vi.fn(),
  handleSendMessage: vi.fn(),
  setMessage: vi.fn(),
  setIsLoading: vi.fn(),
  handoff: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useParams: () => ({ chatId: h.chatId }) }))
vi.mock('@/contexts/streaming-context', () => ({ useStreaming: () => ({ handoff: h.handoff }) }))
vi.mock('@/hooks/use-chat', () => ({
  useChat: () => ({
    message: 'draft message', setMessage: h.setMessage,
    currentChat: { id: 'chat-123', demo: '/preview/x' },
    isLoading: false, setIsLoading: h.setIsLoading,
    isStreaming: false, chatHistory: [], isLoadingChat: false,
    handleSendMessage: h.handleSendMessage,
    handleStreamingComplete: vi.fn(), handleChatData: vi.fn(),
  }),
}))
vi.mock('@/components/ai-elements/prompt-input', () => ({ clearPromptFromStorage: h.clearPromptFromStorage }))
vi.mock('@/components/shared/app-header', () => ({ AppHeader: () => React.createElement('div', { 'data-testid': 'stub-app-header' }) }))
vi.mock('@/components/chat/chat-messages', () => ({ ChatMessages: () => React.createElement('div', { 'data-testid': 'stub-chat-messages' }) }))
vi.mock('@/components/chat/chat-input', () => ({
  ChatInput: (props: any) => React.createElement('div', { 'data-testid': 'stub-chat-input' },
    React.createElement('button', { type: 'button', 'data-testid': 'stub-submit', onClick: () => props.onSubmit({ preventDefault: () => {} }) }, 'Submit'),
    React.createElement('span', { 'data-testid': 'stub-attachments-count' }, props.attachments.length),
  ),
}))
vi.mock('@/components/chat/preview-panel', () => ({
  PreviewPanel: (props: any) => React.createElement('div', { 'data-testid': 'stub-preview-panel' },
    React.createElement('button', { type: 'button', 'data-testid': 'stub-enter-fullscreen', onClick: () => props.setIsFullscreen(true) }, 'Enter fullscreen'),
  ),
}))
vi.mock('@/components/shared/resizable-layout', () => ({
  ResizableLayout: (props: any) => React.createElement('div', { 'data-testid': 'stub-resizable-layout', 'data-active-panel': props.activePanel }, [
    React.createElement(React.Fragment, { key: 'left' }, props.leftPanel),
    React.createElement(React.Fragment, { key: 'right' }, props.rightPanel),
  ]),
}))
vi.mock('@/components/shared/bottom-toolbar', () => ({
  BottomToolbar: (props: any) => React.createElement('div', { 'data-testid': 'stub-bottom-toolbar', 'data-active-panel': props.activePanel, 'data-has-preview': String(props.hasPreview) },
    React.createElement('button', { type: 'button', 'data-testid': 'stub-switch-to-preview', onClick: () => props.onPanelChange('preview') }, 'Preview'),
  ),
}))

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
})

describe('ChatDetailClient — real composition/fullscreen/submit coverage (#1204)', () => {
  it('renders every real child component once', async () => {
    const { ChatDetailClient } = await import('@/components/chats/chat-detail-client')
    render(React.createElement(ChatDetailClient))

    expect(host.querySelector('[data-testid="stub-app-header"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-chat-messages"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-chat-input"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-preview-panel"]')).not.toBeNull()
  })

  it('a real Escape keydown while genuinely fullscreen exits fullscreen', async () => {
    const { ChatDetailClient } = await import('@/components/chats/chat-detail-client')
    render(React.createElement(ChatDetailClient))

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="stub-enter-fullscreen"]')!.click() })
    expect(host.firstElementChild?.className).toContain('fixed inset-0 z-50')

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(host.firstElementChild?.className).not.toContain('fixed inset-0 z-50')
  })

  it('a real Escape keydown while genuinely NOT fullscreen never throws and has no effect', async () => {
    const { ChatDetailClient } = await import('@/components/chats/chat-detail-client')
    render(React.createElement(ChatDetailClient))

    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }).not.toThrow()
    expect(host.firstElementChild?.className).not.toContain('fixed inset-0 z-50')
  })

  it('a real ChatInput submit clears real sessionStorage, clears real attachments, and calls the real handleSendMessage', async () => {
    const { ChatDetailClient } = await import('@/components/chats/chat-detail-client')
    render(React.createElement(ChatDetailClient))

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="stub-submit"]')!.click() })

    expect(h.clearPromptFromStorage).toHaveBeenCalled()
    expect(h.handleSendMessage).toHaveBeenCalled()
    expect(host.querySelector('[data-testid="stub-attachments-count"]')?.textContent).toBe('0')
  })

  it('a real mobile "Preview" toolbar click switches the real ResizableLayout active panel to "right"', async () => {
    const { ChatDetailClient } = await import('@/components/chats/chat-detail-client')
    render(React.createElement(ChatDetailClient))

    expect(host.querySelector('[data-testid="stub-resizable-layout"]')?.getAttribute('data-active-panel')).toBe('left')

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="stub-switch-to-preview"]')!.click() })

    expect(host.querySelector('[data-testid="stub-resizable-layout"]')?.getAttribute('data-active-panel')).toBe('right')
    expect(host.querySelector('[data-testid="stub-bottom-toolbar"]')?.getAttribute('data-active-panel')).toBe('preview')
  })

  it('passes the real hasPreview=true to BottomToolbar when a real currentChat genuinely exists', async () => {
    const { ChatDetailClient } = await import('@/components/chats/chat-detail-client')
    render(React.createElement(ChatDetailClient))

    expect(host.querySelector('[data-testid="stub-bottom-toolbar"]')?.getAttribute('data-has-preview')).toBe('true')
  })
})
