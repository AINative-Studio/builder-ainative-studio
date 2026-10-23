import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/a2ui/action (#1193)
 *
 * Before this change the handler carried a literal `// TODO: Forward action
 * to agent` and returned `{ success: true, message: 'Action received' }` after
 * nothing but a console.log — the textbook "looks functional, silently does
 * nothing" stub. A browser clicking a button in an A2UI preview got a 200 and
 * the action evaporated.
 *
 * The real A2UI transport in this repo is the per-chat queue behind
 * /api/a2ui/poll (there is no WebSocket server: `npm start` is plain
 * `next start`, there is no server.js, and GET /api/a2ui answers a websocket
 * upgrade with 426). So "forward to agent" here means: enqueue the action onto
 * that same real queue so a polling agent consumer receives it, and when no
 * consumer is attached, say so honestly instead of claiming success.
 */

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/a2ui/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/a2ui/action — real forward to the agent queue', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetA2UIQueuesForTest } = await import('@/lib/a2ui/action-queue')
    __resetA2UIQueuesForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a request with no chatId', async () => {
    const { POST } = await import('@/app/api/a2ui/action/route')
    const res = await POST(postReq({ action: 'submit' }))
    expect(res.status).toBe(400)
  })

  it('rejects a request with no action', async () => {
    const { POST } = await import('@/app/api/a2ui/action/route')
    const res = await POST(postReq({ chatId: 'chat-1' }))
    expect(res.status).toBe(400)
  })

  it('enqueues the action so a polling agent consumer actually receives it', async () => {
    const { POST } = await import('@/app/api/a2ui/action/route')
    const { subscribeAgentConsumer, takePendingActions } = await import(
      '@/lib/a2ui/action-queue'
    )

    // A real agent consumer attaches to this chat (what /api/a2ui/poll does).
    subscribeAgentConsumer('chat-42')

    const res = await POST(
      postReq({
        chatId: 'chat-42',
        action: 'handleSubmit',
        context: { componentId: 'submit-btn', value: 'hello' },
      })
    )
    const json = await res.json()

    expect(res.status).toBe(202)
    expect(json.delivered).toBe(true)
    expect(json.transport).toBe('poll-queue')
    expect(typeof json.actionId).toBe('string')
    expect(json.actionId.length).toBeGreaterThan(0)

    // The real forwarded outcome: the action is on the queue the agent drains,
    // with the action name and the user's context intact.
    const pending = takePendingActions('chat-42')
    expect(pending).toHaveLength(1)
    expect(pending[0].type).toBe('action')
    expect(pending[0].payload.action).toBe('handleSubmit')
    expect(pending[0].payload.context).toEqual({
      componentId: 'submit-btn',
      value: 'hello',
    })
    expect(pending[0].messageId).toBe(json.actionId)
    expect(typeof pending[0].timestamp).toBe('number')

    // Draining is destructive — the agent does not get the same action twice.
    expect(takePendingActions('chat-42')).toHaveLength(0)
  })

  it('preserves ordering across multiple actions on the same chat', async () => {
    const { POST } = await import('@/app/api/a2ui/action/route')
    const { subscribeAgentConsumer, takePendingActions } = await import(
      '@/lib/a2ui/action-queue'
    )
    subscribeAgentConsumer('chat-order')

    await POST(postReq({ chatId: 'chat-order', action: 'first' }))
    await POST(postReq({ chatId: 'chat-order', action: 'second' }))
    await POST(postReq({ chatId: 'chat-order', action: 'third' }))

    const pending = takePendingActions('chat-order')
    expect(pending.map((m) => m.payload.action)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('keeps per-chat queues isolated — one chat never sees another chat actions', async () => {
    const { POST } = await import('@/app/api/a2ui/action/route')
    const { subscribeAgentConsumer, takePendingActions } = await import(
      '@/lib/a2ui/action-queue'
    )
    subscribeAgentConsumer('chat-a')
    subscribeAgentConsumer('chat-b')

    await POST(postReq({ chatId: 'chat-a', action: 'only-a' }))

    expect(takePendingActions('chat-b')).toHaveLength(0)
    expect(takePendingActions('chat-a').map((m) => m.payload.action)).toEqual([
      'only-a',
    ])
  })

  it('reports delivered:false with an honest reason when no agent consumer is attached', async () => {
    const { POST } = await import('@/app/api/a2ui/action/route')

    // No subscribeAgentConsumer() call — nothing is listening for this chat.
    const res = await POST(
      postReq({ chatId: 'orphan-chat', action: 'handleSubmit' })
    )
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.delivered).toBe(false)
    expect(json.reason).toBe('no_agent_consumer')
    // Must not lie about success — this was the silent-no-op bug.
    expect(json.success).not.toBe(true)
    expect(String(json.message)).toMatch(/no .*agent/i)
  })

  it('returns 400 on a malformed JSON body rather than a 500', async () => {
    const { POST } = await import('@/app/api/a2ui/action/route')
    const res = await POST(
      new NextRequest('http://localhost/api/a2ui/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      })
    )
    expect(res.status).toBe(400)
  })

  it('drops the oldest action once a chat queue exceeds its cap, keeping the newest', async () => {
    const { POST } = await import('@/app/api/a2ui/action/route')
    const { subscribeAgentConsumer, takePendingActions, MAX_QUEUED_ACTIONS } =
      await import('@/lib/a2ui/action-queue')
    subscribeAgentConsumer('chat-cap')

    for (let i = 0; i < MAX_QUEUED_ACTIONS + 5; i++) {
      await POST(postReq({ chatId: 'chat-cap', action: `a${i}` }))
    }

    const pending = takePendingActions('chat-cap')
    expect(pending).toHaveLength(MAX_QUEUED_ACTIONS)
    // Oldest five were evicted; newest survived.
    expect(pending[0].payload.action).toBe('a5')
    expect(pending[pending.length - 1].payload.action).toBe(
      `a${MAX_QUEUED_ACTIONS + 4}`
    )
  })
})

describe('A2UI action queue — consumer lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetA2UIQueuesForTest } = await import('@/lib/a2ui/action-queue')
    __resetA2UIQueuesForTest()
  })

  it('treats a consumer as gone once its subscription is expired', async () => {
    const { subscribeAgentConsumer, hasAgentConsumer, unsubscribeAgentConsumer } =
      await import('@/lib/a2ui/action-queue')

    subscribeAgentConsumer('chat-x')
    expect(hasAgentConsumer('chat-x')).toBe(true)

    unsubscribeAgentConsumer('chat-x')
    expect(hasAgentConsumer('chat-x')).toBe(false)
  })

  it('expires a stale consumer subscription after the TTL so actions are not accepted into a dead queue', async () => {
    vi.useFakeTimers()
    const { subscribeAgentConsumer, hasAgentConsumer, CONSUMER_TTL_MS } =
      await import('@/lib/a2ui/action-queue')

    subscribeAgentConsumer('chat-stale')
    expect(hasAgentConsumer('chat-stale')).toBe(true)

    vi.advanceTimersByTime(CONSUMER_TTL_MS + 1000)
    expect(hasAgentConsumer('chat-stale')).toBe(false)

    vi.useRealTimers()
  })

  it('enqueueAgentAction returns the delivery outcome rather than throwing when nothing listens', async () => {
    const { enqueueAgentAction } = await import('@/lib/a2ui/action-queue')

    const result = enqueueAgentAction('nobody-home', 'click', { x: 1 })
    expect(result.delivered).toBe(false)
    expect(result.reason).toBe('no_agent_consumer')
  })
})
