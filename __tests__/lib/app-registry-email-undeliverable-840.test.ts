import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { setAppEmailUndeliverable, markEmailUndeliverableForAddress } from '@/lib/build/app-registry'

/**
 * #840 — real, durable "this recipient is undeliverable" flag, set ONLY from
 * a verified Resend webhook event (never speculatively). Two entry points:
 *  - setAppEmailUndeliverable(slug, reason): flags ONE company, idempotent
 *    on the same reason (same shape as setAppCommsOptOut).
 *  - markEmailUndeliverableForAddress(email, reason): flags EVERY company
 *    owned by a recipient ADDRESS — the real shape of the reported bug,
 *    since Resend's bounce/complaint events carry the address, not a slug,
 *    and one address can own many companies (confirmed live: ~30 for
 *    admin@ainative.studio). Reuses the same real listAllAppsWithStatus()
 *    read + client-side collapse as resolveAppByZeroVoiceNumber (see
 *    app-registry-resolve-by-zerovoice-744.test.ts for that same pattern).
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
function failResponse(status = 500): Response {
  return { ok: false, status, text: async () => '{"detail":"error"}' } as unknown as Response
}
function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}
function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('setAppEmailUndeliverable (#840)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('no-op (false) when the slug is not registered', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppEmailUndeliverable('ghost', 'bounced')
    expect(ok).toBe(false)
  })

  it('writes a row with emailUndeliverableAt + the given reason', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([row('acme')]))
    vi.mocked(fetch).mockResolvedValueOnce(okResponse())

    const ok = await setAppEmailUndeliverable('acme', 'bounced:Suppressed')
    expect(ok).toBe(true)
    const postCall = vi.mocked(fetch).mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.emailUndeliverableReason).toBe('bounced:Suppressed')
    expect(body.row_data.emailUndeliverableAt).toBeTruthy()
  })

  it('is idempotent — re-flagging with the SAME reason writes no new row', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([row('acme', { emailUndeliverableAt: '2026-09-20T00:00:00Z', emailUndeliverableReason: 'bounced' })]),
    )
    const ok = await setAppEmailUndeliverable('acme', 'bounced')
    expect(ok).toBe(true)
    const postCall = vi.mocked(fetch).mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('writes a new row when the reason changes (e.g. bounced → complained)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([row('acme', { emailUndeliverableAt: '2026-09-20T00:00:00Z', emailUndeliverableReason: 'bounced' })]),
    )
    vi.mocked(fetch).mockResolvedValueOnce(okResponse())
    const ok = await setAppEmailUndeliverable('acme', 'complained')
    expect(ok).toBe(true)
    const postCall = vi.mocked(fetch).mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeDefined()
  })
})

describe('markEmailUndeliverableForAddress (#840)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('flags every company owned by the given address', async () => {
    // First call: the listAllAppsWithStatus read inside markEmailUndeliverableForAddress.
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([
        row('acme', { ownerEmail: 'admin@ainative.studio' }),
        row('beta', { ownerEmail: 'admin@ainative.studio' }),
        row('other', { ownerEmail: 'someone-else@x.com' }),
      ]),
    )
    // Each setAppEmailUndeliverable call does its OWN resolveApp read + POST —
    // one resolveApp read + one POST per owned company (acme, then beta).
    vi.mocked(fetch)
      .mockResolvedValueOnce(rowsResponse([row('acme', { ownerEmail: 'admin@ainative.studio' })]))
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(rowsResponse([row('beta', { ownerEmail: 'admin@ainative.studio' })]))
      .mockResolvedValueOnce(okResponse())

    const flagged = await markEmailUndeliverableForAddress('ADMIN@ainative.studio', 'bounced')
    expect(flagged.sort()).toEqual(['acme', 'beta'])
  })

  it('excludes a soft-deleted company even if it matches the address', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([row('acme', { ownerEmail: 'admin@ainative.studio', lifecycleStatus: 'deleted' })]),
    )
    const flagged = await markEmailUndeliverableForAddress('admin@ainative.studio', 'bounced')
    expect(flagged).toEqual([])
  })

  it('returns empty for an empty address without calling fetch', async () => {
    const flagged = await markEmailUndeliverableForAddress('', 'bounced')
    expect(flagged).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns empty when the underlying read fails (never fabricates a match)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(500))
    const flagged = await markEmailUndeliverableForAddress('admin@ainative.studio', 'bounced')
    expect(flagged).toEqual([])
  })

  it('returns empty when no company is owned by the address', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([row('acme', { ownerEmail: 'someone-else@x.com' })]),
    )
    const flagged = await markEmailUndeliverableForAddress('admin@ainative.studio', 'bounced')
    expect(flagged).toEqual([])
  })
})
