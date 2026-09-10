import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real gap (customer-reported, Meridian, 2026-09-10): the Company track's one
 * real generated app (a landing page for {slug}.ainative.studio, built via
 * this route -> chat-ws) never forwarded a chosen design system at all — the
 * Company track had no Design step to pick one from in the first place (see
 * lib/build/state.ts's PICK_TRACK), so there was nothing to forward. Meridian
 * was generated AFTER the full 40-system catalog shipped, yet its served
 * preview showed plain Inter/Poppins/#5867EF defaults — confirmed via a real
 * production request, not a stale pre-catalog record. Company track now
 * visits Design too; this route must actually forward that choice to
 * chat-ws, same as the App track already does.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(async (): Promise<{ chatId: string } | null> => null),
  registerApp: vi.fn(async () => true),
  logBuildOutcome: vi.fn(async () => {}),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  registerApp: h.registerApp,
}))
vi.mock('@/lib/build/learning', () => ({ logBuildOutcome: h.logBuildOutcome }))

import { POST } from '@/app/api/build/company-app/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/company-app' } as any
}

function sseBody(chatId: string) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'init', chatId })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
      controller.close()
    },
  })
}

describe('POST /api/build/company-app — forwards designSystemId to chat-ws', () => {
  beforeEach(() => {
    h.resolveApp.mockReset().mockResolvedValue(null)
    h.registerApp.mockReset().mockResolvedValue(true)
    h.logBuildOutcome.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('passes a real designSystemId straight through to the chat-ws request body', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({
      idea: 'a personalized business advisor', slug: 'meridian', name: 'Meridian',
      tagline: 'Your business, clearly charted.', color: '#2D6BE4', designSystemId: 'ledger',
    }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.designSystemId).toBe('ledger')
  })

  it('forwards undefined (not a fabricated default) when no designSystemId was given', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({
      idea: 'a personalized business advisor', slug: 'meridian2', name: 'Meridian',
      tagline: '', color: '#2D6BE4',
    }))

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.designSystemId).toBeUndefined()
  })

  it('ignores a non-string designSystemId rather than forwarding garbage', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ body: sseBody('abc123') }) as any)
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({
      idea: 'a personalized business advisor', slug: 'meridian3', name: 'Meridian',
      color: '#2D6BE4', designSystemId: 12345,
    }))

    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(String(init.body))
    expect(sentBody.designSystemId).toBeUndefined()
  })

  it('returns the cached chatId without calling chat-ws again when the slug already resolves', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'already-built' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian', designSystemId: 'ledger' }))
    const data = await res.json()

    expect(data.chatId).toBe('already-built')
    expect(data.cached).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
