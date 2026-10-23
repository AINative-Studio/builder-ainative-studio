// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom doesn't implement scrollIntoView — ChatMessages calls it on an
  // auto-scroll effect unrelated to what this file tests.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

/**
 * #1195 — the real chat UI must show the real Context Budget Manager status
 * for the real active session (reported by chat-ws's `budget` SSE event),
 * not just on the disconnected app/context-budget-demo page. This covers
 * the indicator ChatMessages renders from the `budgetStatus` prop:
 *  - hidden by default (a healthy budget shouldn't clutter the chat UI)
 *  - shown once the real session is warning/critical, or once real history
 *    was actually trimmed
 *  - fails open visually too: no budgetStatus (e.g. the check failed/timed
 *    out server-side) renders nothing extra, never an error state
 */

vi.mock('@ainative/ai-kit', () => ({
  StreamingMessage: (props: any) =>
    React.createElement('div', { 'data-testid': 'streaming-message' }, props.content),
}))

vi.mock('@/components/ai-elements/message', () => ({
  Message: (props: any) => React.createElement('div', null, props.children),
  MessageContent: (props: any) => React.createElement('div', null, props.children),
}))

vi.mock('@/components/ai-elements/conversation', () => ({
  Conversation: (props: any) => React.createElement('div', null, props.children),
  ConversationContent: (props: any) => React.createElement('div', null, props.children),
}))

vi.mock('@/components/ai-elements/loader', () => ({
  Loader: () => React.createElement('div', { 'data-testid': 'loader' }),
}))

vi.mock('@/components/message-renderer', () => ({
  MessageRenderer: () => React.createElement('div'),
}))

vi.mock('@/components/shared-components', () => ({
  sharedComponents: {},
}))

vi.mock('@/components/chat/build-progress', () => ({
  BuildProgress: () => React.createElement('div', { 'data-testid': 'build-progress' }),
}))

vi.mock('@/components/chat/file-tree', () => ({
  FileTree: () => React.createElement('div', { 'data-testid': 'file-tree' }),
}))

vi.mock('@/lib/file-parser', () => ({
  createFileTree: () => [],
  simulateFileProgress: () => () => {},
  createFileTreeFromFiles: () => [],
}))

import { ChatMessages } from '@/components/chat/chat-messages'

let host: HTMLElement
let root: Root

function mount(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(el)
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
})

const baseChatHistory = [
  { type: 'user' as const, content: 'build me a crm' },
  { type: 'assistant' as const, content: '', isStreaming: false },
]

describe('ChatMessages real context budget indicator (#1195)', () => {
  it('renders nothing when budgetStatus is null (new chat / failed budget check — fail-open)', () => {
    mount(
      React.createElement(ChatMessages, {
        chatHistory: baseChatHistory,
        isLoading: false,
        currentChat: null,
        onStreamingComplete: () => {},
        onChatData: () => {},
        budgetStatus: null,
      })
    )
    expect(host.querySelector('[data-testid="chat-context-budget-indicator"]')).toBeNull()
  })

  it('renders nothing for a healthy budget (not warning, not critical, not trimmed)', () => {
    mount(
      React.createElement(ChatMessages, {
        chatHistory: baseChatHistory,
        isLoading: false,
        currentChat: null,
        onStreamingComplete: () => {},
        onChatData: () => {},
        budgetStatus: {
          usagePercentage: 12,
          isWarning: false,
          isCritical: false,
          remaining: 100000,
          total: 128000,
        },
      })
    )
    expect(host.querySelector('[data-testid="chat-context-budget-indicator"]')).toBeNull()
  })

  it('shows the real usage percentage once the real session is in warning state', () => {
    mount(
      React.createElement(ChatMessages, {
        chatHistory: baseChatHistory,
        isLoading: false,
        currentChat: null,
        onStreamingComplete: () => {},
        onChatData: () => {},
        budgetStatus: {
          usagePercentage: 84,
          isWarning: true,
          isCritical: false,
          remaining: 12000,
          total: 128000,
        },
      })
    )
    const indicator = host.querySelector('[data-testid="chat-context-budget-indicator"]')
    expect(indicator).not.toBeNull()
    expect(indicator?.textContent).toContain('84%')
  })

  it('shows critical styling and the real trimmed-count message when history was actually trimmed', () => {
    mount(
      React.createElement(ChatMessages, {
        chatHistory: baseChatHistory,
        isLoading: false,
        currentChat: null,
        onStreamingComplete: () => {},
        onChatData: () => {},
        budgetStatus: {
          usagePercentage: 98,
          isWarning: true,
          isCritical: true,
          remaining: 200,
          total: 128000,
          trimmed: true,
          droppedCount: 3,
        },
      })
    )
    const indicator = host.querySelector('[data-testid="chat-context-budget-indicator"]')
    expect(indicator).not.toBeNull()
    expect(indicator?.textContent).toContain('98%')
    expect(indicator?.textContent).toContain('trimmed 3 earlier messages')
  })
})
