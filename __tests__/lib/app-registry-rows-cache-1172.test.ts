import { describe, it, expect, vi, beforeEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { resolveApp, createRegistryRowsCache } from '@/lib/build/app-registry'

/**
 * #1172 — the nightly loop calls resolveApp() many times per batch (twice per
 * company in runForCompany, plus once per due task in resolveTask), and each
 * unshared call used to re-page the WHOLE append-only registry table. With
 * NIGHTLY_COMPANY_CONCURRENCY companies running at once, that fired dozens of
 * concurrent full-table-scan request chains at the same ZeroDB endpoint and
 * got itself rate-limited (429s observed live — every resolveApp() call in
 * the window then returned null, tasksCompleted=0 of 31 in one real run).
 * createRegistryRowsCache() gives a caller a shared in-flight-promise holder
 * (same pattern as nightly-loop/route.ts's own `planCache`, #1055) so N
 * concurrent resolveApp() calls that pass the SAME cache collapse into one
 * real fetch chain, while every other call site (which never passes one)
 * keeps today's always-fresh-per-call behavior.
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}

function failResponse(status = 429): Response {
  return { ok: false, status, text: async () => '{"error":"rate_limit_exceeded"}' } as unknown as Response
}

function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('resolveApp rows cache (#1172)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

  it('with no cache passed, every call re-fetches (today\'s unchanged default behavior)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(rowsResponse([row('acme')]))

    await resolveApp('acme')
    await resolveApp('acme')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('several concurrent calls sharing one cache collapse into a single fetch chain', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    let resolveFetch: (r: Response) => void
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve }),
    )

    const cache = createRegistryRowsCache()
    const calls = [resolveApp('acme', cache), resolveApp('acme', cache), resolveApp('acme', cache)]

    // Only the FIRST call should have actually hit fetch — the other two
    // concurrent callers must be awaiting the same in-flight promise.
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch!(rowsResponse([row('acme')]))
    const results = await Promise.all(calls)
    expect(results.every((r) => r?.slug === 'acme')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a sequential call after the shared fetch resolves reuses the cached rows (no extra fetch)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(rowsResponse([row('acme')]))

    const cache = createRegistryRowsCache()
    await resolveApp('acme', cache)
    await resolveApp('acme', cache)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed fetch is never cached — the next call using the same cache gets a fresh retry', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(failResponse())
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))

    const cache = createRegistryRowsCache()
    const first = await resolveApp('acme', cache)
    expect(first).toBeNull()

    const second = await resolveApp('acme', cache)
    expect(second?.slug).toBe('acme')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('different cache instances never share state with each other', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(rowsResponse([row('acme')]))

    await resolveApp('acme', createRegistryRowsCache())
    await resolveApp('acme', createRegistryRowsCache())

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
