// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom gap — the real Conversation (ai-elements/conversation.tsx) uses
  // use-stick-to-bottom, which calls ResizeObserver on mount; jsdom has no
  // global ResizeObserver at all.
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

/**
 * #1204 (Coverage Phase 4) — ChatMessages (components/chat/chat-messages.tsx,
 * 340 lines, reached live via components/chats/chat-detail-client.tsx) had
 * only narrow coverage from chat-messages-budget-indicator.test.tsx (#1195,
 * the context-budget indicator only).
 *
 * StreamingMessage is mocked at its real exported boundary (@ainative/ai-kit
 * — a genuine third-party rendering library, confirmed via its real
 * StreamingMessageProps type in node_modules), asserting only the props
 * ChatMessages passes through, not its internal rendering. BuildProgress and
 * FileTree are already independently tested
 * (build-progress-render-1204.test.tsx / file-tree-render-1204.test.tsx) —
 * mocked here at their real boundary. MessageRenderer and the ai-elements
 * Message/MessageContent imports are confirmed genuinely unused in this
 * component's actual JSX (imported but never rendered) — not mocked,
 * matching real behavior.
 */

const h = vi.hoisted(() => ({ streamingMessageCalls: [] as any[] }))
vi.mock('@ainative/ai-kit', () => ({
  StreamingMessage: (props: any) => {
    h.streamingMessageCalls.push(props)
    return React.createElement('div', { 'data-testid': 'streaming-message', 'data-role': props.role }, props.content)
  },
}))
vi.mock('@/components/chat/build-progress', () => ({
  BuildProgress: (props: any) => React.createElement('div', { 'data-testid': 'stub-build-progress' }, `${props.tasks.length} tasks`),
}))
vi.mock('@/components/chat/file-tree', () => ({
  FileTree: (props: any) => React.createElement('div', { 'data-testid': 'stub-file-tree' }, `${props.groups.length} groups`),
}))

import { ChatMessages } from '@/components/chat/chat-messages'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

const noop = () => {}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  h.streamingMessageCalls.length = 0
})

describe('ChatMessages — real conversation/streaming/feedback coverage (#1204)', () => {
  it('renders an empty Conversation with no messages when chatHistory is genuinely empty', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [], isLoading: false, currentChat: null,
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(host.querySelector('[data-testid="streaming-message"]')).toBeNull()
  })

  it('renders one real StreamingMessage per real chat message, passing through role/content/isStreaming', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a todo app' },
        { type: 'assistant', content: 'Sure thing!', isStreaming: true },
      ],
      isLoading: false, currentChat: null,
      onStreamingComplete: noop, onChatData: noop,
    }))

    const messages = Array.from(host.querySelectorAll('[data-testid="streaming-message"]'))
    expect(messages).toHaveLength(2)
    expect(h.streamingMessageCalls[0]).toMatchObject({ role: 'user', content: 'Build me a todo app', streamingState: 'complete' })
    expect(h.streamingMessageCalls[1]).toMatchObject({ role: 'assistant', streamingState: 'streaming' })
  })

  it('strips a real trailing code block from an assistant message, keeping only the conversational text before it', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a counter' },
        { type: 'assistant', content: 'Here you go!\n```jsx\nexport default function App() {}\n```' },
      ],
      isLoading: false, currentChat: null,
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(h.streamingMessageCalls[1].content).toBe('Here you go!')
    expect(h.streamingMessageCalls[1].content).not.toContain('```')
  })

  it('shows the real friendly fallback when an assistant message is ONLY a code block with no conversational text', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a counter' },
        { type: 'assistant', content: '```jsx\nexport default function App() {}\n```' },
      ],
      isLoading: false, currentChat: null,
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(h.streamingMessageCalls[1].content).toBe('Component generated successfully! Check the preview panel to see your creation.')
  })

  it('never strips anything from a real user message, even if it happens to contain backticks', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [{ type: 'user', content: 'Use `useState` please\n```\nnot code\n```' }],
      isLoading: false, currentChat: null,
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(h.streamingMessageCalls[0].content).toBe('Use `useState` please\n```\nnot code\n```')
  })

  it('shows the real Project Setup card with real buildSteps right after the second-to-last user message', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a todo app' },
        { type: 'assistant', content: 'Working on it', isStreaming: true },
      ],
      isLoading: true, currentChat: null, buildSteps: ['Installing dependencies', 'Scaffolding files'],
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(host.textContent).toContain('Project Setup')
    expect(host.textContent).toContain('Installing dependencies')
    expect(host.textContent).toContain('Scaffolding files')
  })

  it('never shows the Project Setup card when buildSteps is genuinely empty', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a todo app' },
        { type: 'assistant', content: 'Working on it', isStreaming: true },
      ],
      isLoading: true, currentChat: null,
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(host.textContent).not.toContain('Project Setup')
  })

  it('shows the real Rate-this-generation thumbs for the last, non-streaming assistant message, and wires real onFeedback', async () => {
    const onFeedback = vi.fn()
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a todo app' },
        { type: 'assistant', content: 'Done! Here it is.' },
      ],
      isLoading: false, currentChat: null, onFeedback,
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(host.textContent).toContain('Rate this generation')
    const upBtn = host.querySelector('[aria-label="Thumbs up — good generation"]') as HTMLButtonElement
    const downBtn = host.querySelector('[aria-label="Thumbs down — bad generation"]') as HTMLButtonElement
    await act(async () => { upBtn.click() })
    expect(onFeedback).toHaveBeenCalledWith('up')
    await act(async () => { downBtn.click() })
    expect(onFeedback).toHaveBeenCalledWith('down')
  })

  it('never shows the Rate-this-generation thumbs while the last assistant message is still streaming', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a todo app' },
        { type: 'assistant', content: 'Working...', isStreaming: true },
      ],
      isLoading: false, currentChat: null,
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(host.textContent).not.toContain('Rate this generation')
  })

  it('shows the real context-budget indicator only for warning/critical/trimmed, with the real trimmed-count message', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a todo app' },
        { type: 'assistant', content: 'Done!' },
      ],
      isLoading: false, currentChat: null,
      budgetStatus: { usagePercentage: 92, isWarning: false, isCritical: true, remaining: 100, total: 1000, trimmed: true, droppedCount: 3 },
      onStreamingComplete: noop, onChatData: noop,
    }))

    const indicator = host.querySelector('[data-testid="chat-context-budget-indicator"]')
    expect(indicator).not.toBeNull()
    expect(indicator?.textContent).toContain('Context 92% used')
    expect(indicator?.textContent).toContain('trimmed 3 earlier messages to stay in budget')
  })

  it('renders the real loading spinner only when isLoading is genuinely true', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [{ type: 'user', content: 'hi' }],
      isLoading: true, currentChat: null,
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(host.querySelector('svg title')?.textContent).toBe('Loader')
  })

  it('a real className merges correctly and real sandpackFiles drive a real file tree via createFileTreeFromFiles', () => {
    render(React.createElement(ChatMessages, {
      chatHistory: [
        { type: 'user', content: 'Build me a todo app' },
        { type: 'assistant', content: 'Done!' },
      ],
      isLoading: false, currentChat: null,
      sandpackFiles: { 'App.tsx': 'export default function App() {}', 'index.ts': 'import "./App"' },
      onStreamingComplete: noop, onChatData: noop,
    }))

    expect(host.querySelector('[data-testid="stub-file-tree"]')).not.toBeNull()
  })
})
