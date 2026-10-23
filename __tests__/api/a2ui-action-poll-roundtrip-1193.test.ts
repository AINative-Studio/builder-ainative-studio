import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * A2UI action → poll round trip (#1193)
 *
 * The reason "forward action to agent" was a no-op was not only the missing
 * implementation in /api/a2ui/action — /api/a2ui/poll also owned a *private*
 * module-level `messageQueues` Map that no other route could write to. Even a
 * hand-written forward into the action route could never have reached the
 * polling agent.
 *
 * These tests exercise both real route handlers against the now-shared
 * lib/a2ui/action-queue, so they fail if the two sides are ever decoupled
 * again.
 */

function actionReq(body: unknown) {
  return new NextRequest('http://localhost/api/a2ui/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function pollReq(chatId: string, timeout = 0) {
  return new NextRequest(
    `http://localhost/api/a2ui/poll?chatId=${chatId}&timeout=${timeout}`
  )
}

describe('A2UI action → poll round trip', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetA2UIQueuesForTest } = await import('@/lib/a2ui/action-queue')
    __resetA2UIQueuesForTest()
  })

  it('an action posted to /api/a2ui/action is delivered to the agent polling /api/a2ui/poll', async () => {
    const { POST: postAction } = await import('@/app/api/a2ui/action/route')
    const { GET: poll } = await import('@/app/api/a2ui/poll/route')

    // 1. The agent attaches. A zero-timeout poll registers the consumer and
    //    returns immediately with nothing queued yet.
    const firstPoll = await poll(pollReq('roundtrip-1'))
    expect(firstPoll.status).toBe(200)
    expect((await firstPoll.json()).messages).toEqual([])

    // 2. The browser fires a button in the A2UI preview.
    const actionRes = await postAction(
      actionReq({
        chatId: 'roundtrip-1',
        action: 'handleSubmit',
        context: { field: 'email', value: 'founder@example.com' },
      })
    )
    expect(actionRes.status).toBe(202)
    const { actionId, delivered } = await actionRes.json()
    expect(delivered).toBe(true)

    // 3. The agent's next poll receives the real action — this is the
    //    forwarded outcome the stub never produced.
    const secondPoll = await poll(pollReq('roundtrip-1'))
    const payload = await secondPoll.json()

    expect(payload.messages).toHaveLength(1)
    expect(payload.messages[0]).toMatchObject({
      type: 'action',
      messageId: actionId,
      payload: {
        action: 'handleSubmit',
        context: { field: 'email', value: 'founder@example.com' },
      },
    })

    // 4. Delivery is once-only; a third poll is empty again.
    const thirdPoll = await poll(pollReq('roundtrip-1'))
    expect((await thirdPoll.json()).messages).toEqual([])
  })

  it('an action for a chat whose agent never polled is refused, not swallowed', async () => {
    const { POST: postAction } = await import('@/app/api/a2ui/action/route')
    const { GET: poll } = await import('@/app/api/a2ui/poll/route')

    const res = await postAction(
      actionReq({ chatId: 'never-polled', action: 'handleSubmit' })
    )
    expect(res.status).toBe(503)
    expect((await res.json()).delivered).toBe(false)

    // Nothing was queued behind the refusal.
    const pollRes = await poll(pollReq('never-polled'))
    expect((await pollRes.json()).messages).toEqual([])
  })

  it('delivers multiple queued actions in one poll, in order', async () => {
    const { POST: postAction } = await import('@/app/api/a2ui/action/route')
    const { GET: poll } = await import('@/app/api/a2ui/poll/route')

    await poll(pollReq('batched'))
    await postAction(actionReq({ chatId: 'batched', action: 'one' }))
    await postAction(actionReq({ chatId: 'batched', action: 'two' }))

    const res = await poll(pollReq('batched'))
    const { messages } = await res.json()
    expect(messages.map((m: any) => m.payload.action)).toEqual(['one', 'two'])
  })

  it('an agent-originated render message posted to /api/a2ui/poll reaches the browser poll', async () => {
    const { GET: poll, POST: postMessage } = await import(
      '@/app/api/a2ui/poll/route'
    )

    const pushed = await postMessage(
      new NextRequest('http://localhost/api/a2ui/poll?chatId=render-1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'render',
          payload: { component: { type: 'button', id: 'b1', children: 'Go' } },
        }),
      })
    )
    expect(pushed.status).toBe(200)
    expect((await pushed.json()).success).toBe(true)

    const res = await poll(pollReq('render-1'))
    const { messages } = await res.json()
    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('render')
    expect(messages[0].payload.component.id).toBe('b1')
  })

  it('rejects a poll with no chatId', async () => {
    const { GET: poll } = await import('@/app/api/a2ui/poll/route')
    const res = await poll(new NextRequest('http://localhost/api/a2ui/poll'))
    expect(res.status).toBe(400)
  })

  it('clamps an absurd client-supplied long-poll timeout instead of hanging the request', async () => {
    const { GET: poll } = await import('@/app/api/a2ui/poll/route')

    // A 10-minute poll would pin a server worker; it must be capped at 60s.
    // Proven here by the request completing promptly with a queued message
    // rather than honouring the requested window.
    const { enqueueAgentMessage } = await import('@/lib/a2ui/action-queue')
    enqueueAgentMessage('clamped', { type: 'state', payload: { ok: true } })

    const started = Date.now()
    const res = await poll(pollReq('clamped', 600_000))
    expect(res.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(60_000)
    expect((await res.json()).messages).toHaveLength(1)
  })
})
