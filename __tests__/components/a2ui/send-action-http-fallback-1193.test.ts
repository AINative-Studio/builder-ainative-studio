import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * A2UI sendAction HTTP fallback (#1193) — source-level contract.
 *
 * Fixing POST /api/a2ui/action server-side is only half the stub: the browser
 * never called it. useAgentConnection().sendAction sent over a WebSocket and,
 * when that socket was not open, logged `Cannot send action: WebSocket not
 * connected` and discarded the action. That branch is the *normal* case in
 * this deployment — there is no A2UI WebSocket server (`npm start` is plain
 * `next start`, no server.js), and GET /api/a2ui answers an upgrade request
 * with 426 while pointing at the polling transport. So every user action in
 * an A2UI preview was dropped before it could reach any endpoint.
 *
 * These assertions pin the fallback in place. They are source-level because
 * useAgentConnection opens a real WebSocket on mount, which a jsdom render
 * cannot usefully stand in for; the behavioural coverage of the forwarding
 * itself lives in the route tests (a2ui-action-forward-1193,
 * a2ui-action-poll-roundtrip-1193).
 */

const SRC = readFileSync(
  path.join(process.cwd(), 'components/a2ui/AgentConnection.tsx'),
  'utf-8'
)

describe('useAgentConnection sendAction', () => {
  it('posts to /api/a2ui/action when the WebSocket is not open', () => {
    expect(SRC).toContain("fetch('/api/a2ui/action'")
    expect(SRC).toMatch(/method:\s*'POST'/)
  })

  it('sends the chatId, action and context the route requires', () => {
    expect(SRC).toContain('JSON.stringify({ chatId, action, context })')
  })

  it('still prefers the WebSocket when one is actually open', () => {
    const wsSendIndex = SRC.indexOf('wsRef.current.send(JSON.stringify(message))')
    const fetchIndex = SRC.indexOf("fetch('/api/a2ui/action'")
    expect(wsSendIndex).toBeGreaterThan(-1)
    expect(fetchIndex).toBeGreaterThan(wsSendIndex)
  })

  it('surfaces a non-delivery through onError instead of swallowing it', () => {
    // The old code's only failure handling was a console.warn.
    expect(SRC).not.toContain(
      "console.warn('[A2UI] Cannot send action: WebSocket not connected')"
    )
    expect(SRC).toContain('was not delivered')
    expect(SRC).toMatch(/onError\?\.\(/)
  })

  it('reads the route machine-readable reason rather than guessing', () => {
    expect(SRC).toContain('body?.reason')
  })
})
