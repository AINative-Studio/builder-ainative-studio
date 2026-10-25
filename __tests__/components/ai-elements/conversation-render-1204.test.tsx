// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom gap — use-stick-to-bottom calls ResizeObserver on mount; jsdom has
  // none. Same stub as chat-messages-render-1204.test.tsx, which already
  // mounts this exact library through the real ChatMessages tree.
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

/**
 * #1204 (Coverage Phase 4) — conversation.tsx (components/ai-elements/
 * conversation.tsx) had zero render coverage despite being genuinely
 * reachable via chat-messages.tsx <- chat-detail-client.tsx. Conversation/
 * ConversationContent are rendered through the real StickToBottom provider
 * (no mocking — same real third-party library chat-messages-render-1204.
 * test.tsx already mounts). ConversationScrollButton's real gating logic is
 * the one branch worth asserting directly: jsdom has no real layout engine,
 * so use-stick-to-bottom reports isAtBottom=true by default, and the button
 * must stay hidden rather than showing a scroll affordance with nowhere
 * further to scroll — exercised directly, not faked.
 */

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
  vi.restoreAllMocks()
})

describe('Conversation / ConversationContent — real StickToBottom wiring (#1204)', () => {
  it('renders real children inside the real scroll container with the log role', () => {
    render(
      <Conversation>
        <ConversationContent>
          <p>hello</p>
        </ConversationContent>
      </Conversation>,
    )
    const container = host.querySelector('[role="log"]')
    expect(container).not.toBeNull()
    expect(host.textContent).toContain('hello')
  })

  it('merges a real custom className onto the real scroll container', () => {
    render(<Conversation className="my-extra-class">{null}</Conversation>)
    const container = host.querySelector('[role="log"]')
    expect(container?.className).toContain('my-extra-class')
  })
})

describe('ConversationScrollButton — real isAtBottom gating (#1204)', () => {
  it('renders no button at all while genuinely at the bottom — jsdom has no real layout, so use-stick-to-bottom reports isAtBottom=true by default, and the button must stay hidden rather than showing a scroll affordance with nowhere further to scroll', () => {
    render(
      <Conversation>
        <ConversationContent>
          <p>msg</p>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>,
    )
    expect(host.querySelector('button')).toBeNull()
  })

  it('mounts cleanly alongside real sibling content without ever throwing, exercising the real useStickToBottomContext() read', () => {
    expect(() => {
      render(
        <Conversation>
          <ConversationContent>
            <p>msg</p>
          </ConversationContent>
          <ConversationScrollButton className="extra" />
        </Conversation>,
      )
    }).not.toThrow()
  })
})
