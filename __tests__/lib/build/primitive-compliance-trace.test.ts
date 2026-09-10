import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Durable tracing for the primitive-compliance retry loop (issue #624
 * follow-up, 2026-09-10) — chat-ws's closePrimitiveComplianceGap() needed
 * verifiable proof of whether it ran, and what it did, for a real
 * generation. Live verification repeatedly hit a wall trying to confirm
 * this via `railway logs`: the CLI exposes only a small, apparently-stale
 * rolling buffer that never showed the retry's own log line for a real
 * Meridian generation, even after the retry was confirmed correct by source
 * inspection and passing unit tests. This module appends a durable,
 * queryable ZeroDB row instead — mirrors lib/build/learning.ts's exact
 * row-append pattern.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
  const fn = vi.fn(async (url, init) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.body ?? {}),
      text: async () => JSON.stringify(r.body ?? {}),
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function freshConfigured() {
  vi.resetModules()
  process.env.ZERODB_API_KEY = 'k'
  process.env.ZERODB_PROJECT_ID = 'p'
  return import('@/lib/build/primitive-compliance-trace')
}

describe('traceComplianceRetry — unconfigured no-ops', () => {
  afterEach(() => { vi.resetModules() })

  it('resolves false without calling fetch when unconfigured', async () => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.AINATIVE_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fn = mockFetch(() => ({ ok: true }))
    const { traceComplianceRetry } = await import('@/lib/build/primitive-compliance-trace')
    const ok = await traceComplianceRetry({
      chatId: 'chat-1', branch: 'non-combined', isMultiFile: false,
      attemptsRun: 1, gapsBefore: ['ZeroPipeline'], gapsAfter: [], closed: true,
    })
    expect(ok).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('resolves false without a chatId even when configured', async () => {
    const { traceComplianceRetry } = await freshConfigured()
    const fn = mockFetch(() => ({ ok: true }))
    const ok = await traceComplianceRetry({
      chatId: '', branch: 'non-combined', isMultiFile: false,
      attemptsRun: 1, gapsBefore: [], gapsAfter: [], closed: true,
    })
    expect(ok).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('traceComplianceRetry — writes a real row', () => {
  afterEach(() => { vi.resetModules() })

  it('POSTs a row carrying the chatId, branch, gaps, and closed status', async () => {
    const { traceComplianceRetry } = await freshConfigured()
    const fn = mockFetch(() => ({ ok: true }))
    const ok = await traceComplianceRetry({
      chatId: 'chat-meridian', branch: 'combined-multi-file', isMultiFile: true,
      attemptsRun: 2, gapsBefore: ['ZeroPipeline', 'ZeroVoice'], gapsAfter: ['ZeroPipeline'], closed: false,
    })
    expect(ok).toBe(true)
    expect(fn).toHaveBeenCalledOnce()
    const [, init] = fn.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.row_data).toMatchObject({
      chatId: 'chat-meridian',
      branch: 'combined-multi-file',
      isMultiFile: true,
      attemptsRun: 2,
      gapsBefore: ['ZeroPipeline', 'ZeroVoice'],
      gapsAfter: ['ZeroPipeline'],
      closed: false,
    })
    expect(body.row_data.createdAt).toBeTruthy()
  })

  it('resolves false (never throws) when the ZeroDB write fails', async () => {
    const { traceComplianceRetry } = await freshConfigured()
    mockFetch(() => ({ ok: false, status: 500 }))
    const ok = await traceComplianceRetry({
      chatId: 'chat-1', branch: 'non-combined', isMultiFile: false,
      attemptsRun: 1, gapsBefore: [], gapsAfter: [], closed: true,
    })
    expect(ok).toBe(false)
  })

  it('resolves false (never throws) when fetch itself rejects', async () => {
    const { traceComplianceRetry } = await freshConfigured()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const ok = await traceComplianceRetry({
      chatId: 'chat-1', branch: 'non-combined', isMultiFile: false,
      attemptsRun: 1, gapsBefore: [], gapsAfter: [], closed: true,
    })
    expect(ok).toBe(false)
  })
})

describe('readComplianceTrace', () => {
  afterEach(() => { vi.resetModules() })

  it('returns [] when unconfigured', async () => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.AINATIVE_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const { readComplianceTrace } = await import('@/lib/build/primitive-compliance-trace')
    const rows = await readComplianceTrace('chat-1')
    expect(rows).toEqual([])
  })

  it('returns [] without a chatId', async () => {
    const { readComplianceTrace } = await freshConfigured()
    const rows = await readComplianceTrace('')
    expect(rows).toEqual([])
  })

  it('returns the matching rows, newest first', async () => {
    const { readComplianceTrace } = await freshConfigured()
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          { row_data: { chatId: 'chat-1', branch: 'non-combined', isMultiFile: false, attemptsRun: 1, gapsBefore: ['ZeroPipeline'], gapsAfter: [], closed: true, createdAt: '2026-09-10T10:00:00.000Z' } },
          { row_data: { chatId: 'chat-1', branch: 'combined-multi-file', isMultiFile: true, attemptsRun: 2, gapsBefore: ['ZeroPipeline'], gapsAfter: ['ZeroPipeline'], closed: false, createdAt: '2026-09-10T09:00:00.000Z' } },
        ],
      },
    }))
    const rows = await readComplianceTrace('chat-1')
    expect(rows).toHaveLength(2)
    expect(rows[0].createdAt).toBe('2026-09-10T10:00:00.000Z')
    expect(rows[0].closed).toBe(true)
    expect(rows[1].closed).toBe(false)
  })

  it('returns [] (never throws) on a failed read', async () => {
    const { readComplianceTrace } = await freshConfigured()
    mockFetch(() => ({ ok: false, status: 500 }))
    const rows = await readComplianceTrace('chat-1')
    expect(rows).toEqual([])
  })
})
