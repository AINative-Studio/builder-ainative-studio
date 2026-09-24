import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * builder-ainative-studio#870 — company-app's runLandingPageGeneration() is
 * the Company track's real slug-linking point (it extracts chatId from
 * chat-ws's own SSE stream, already has slug in scope), so its real stages
 * (generate, register) are reported to core's deployment-health API under
 * entity_type "builder_app_generation". Part of the same fix as
 * register-app-deployment-health.test.ts (the App track's equivalent).
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(async (): Promise<{ chatId: string } | null> => null),
  registerApp: vi.fn(async () => true),
  logBuildOutcome: vi.fn(async () => {}),
  recordPendingProductGeneration: vi.fn(async () => {}),
  markProductGenerationRegistered: vi.fn(async () => {}),
  resolvePendingProductGeneration: vi.fn(async (): Promise<{ productSlug: string; chatId: string; status: 'pending' | 'registered'; createdAt: string } | null> => null),
  loadGeneration: vi.fn(async (): Promise<{ generatedCode: string; prompt: string } | null> => null),
  reportDeploymentHealthStage: vi.fn(async () => {}),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  registerApp: h.registerApp,
}))
vi.mock('@/lib/build/learning', () => ({ logBuildOutcome: h.logBuildOutcome }))
vi.mock('@/lib/build/product-generation-state', () => ({
  recordPendingProductGeneration: h.recordPendingProductGeneration,
  markProductGenerationRegistered: h.markProductGenerationRegistered,
  resolvePendingProductGeneration: h.resolvePendingProductGeneration,
}))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: h.loadGeneration }))
vi.mock('@/lib/build/deployment-health', () => ({ reportDeploymentHealthStage: h.reportDeploymentHealthStage }))

import { POST } from '@/app/api/build/company-app/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/company-app' } as any
}

function sseBody(chatId: string, opts: { complete?: boolean } = { complete: true }) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'init', chatId })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
      if (opts.complete !== false) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', chatId })}\n\n`))
      }
      controller.close()
    },
  })
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('POST /api/build/company-app — deployment-health stage reporting (#870)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.resolveApp.mockResolvedValue(null)
    h.registerApp.mockResolvedValue(true)
    h.logBuildOutcome.mockResolvedValue(undefined)
    h.recordPendingProductGeneration.mockResolvedValue(undefined)
    h.markProductGenerationRegistered.mockResolvedValue(undefined)
    h.resolvePendingProductGeneration.mockResolvedValue(null)
    h.loadGeneration.mockResolvedValue(null)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reports generate ok + register ok on a real successful generation, keyed on the real slug', async () => {
    const fetchMock = vi.fn(async () => new Response(sseBody('chat-1'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a landing page for my startup', slug: 'meridian-1', name: 'Meridian' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'meridian-1', 'generate', 'ok', undefined)
    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'meridian-1', 'register', 'ok')
  })

  it('reports generate failed (and never reaches register) when the stream ends without a complete event', async () => {
    const fetchMock = vi.fn(async () => new Response(sseBody('chat-1', { complete: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a landing page for my startup', slug: 'meridian-2', name: 'Meridian' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'meridian-2', 'generate', 'failed', 'Stream ended without a complete event.',
    )
    expect(h.reportDeploymentHealthStage).not.toHaveBeenCalledWith(
      'builder_app_generation', 'meridian-2', 'register', expect.anything(), expect.anything(),
    )
  })

  it('reports generate failed when chat-ws never produces a chatId at all', async () => {
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.close() } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a landing page for my startup', slug: 'meridian-3', name: 'Meridian' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'meridian-3', 'generate', 'failed', 'no chatId',
    )
  })

  it('reports register failed when registerApp itself returns false', async () => {
    h.registerApp.mockResolvedValue(false)
    const fetchMock = vi.fn(async () => new Response(sseBody('chat-1'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ idea: 'a landing page for my startup', slug: 'meridian-4', name: 'Meridian' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'meridian-4', 'register', 'failed')
  })

  it('never reports anything when the request is served from cache (no generation ran)', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'already-built' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ idea: 'x', slug: 'meridian-5', name: 'Meridian' }))
    const data = await res.json()

    expect(data.cached).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.reportDeploymentHealthStage).not.toHaveBeenCalled()
  })
})
