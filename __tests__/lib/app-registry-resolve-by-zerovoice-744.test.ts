import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { resolveAppByZeroVoiceNumber } from '@/lib/build/app-registry'

/**
 * #744 — resolveAppByZeroVoiceNumber(): reverse-lookup a company by its own
 * ZeroVoice inbound number (the SMS-to-issue webhook's `To` field). Reuses
 * the same real rows-read + client-side collapse listAllAppsWithStatus()
 * already uses (see app-registry-load-status.test.ts) — these tests mock
 * that same fetch shape directly.
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}

function failResponse(status = 500): Response {
  return { ok: false, status, text: async () => '{"detail":"error"}' } as unknown as Response
}

function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('resolveAppByZeroVoiceNumber (#744)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the matching company when its zerovoiceE164 matches', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([
        row('acme', { zerovoiceE164: '+15551234567' }),
        row('other-co', { zerovoiceE164: '+15559999999' }),
      ]),
    )
    const result = await resolveAppByZeroVoiceNumber('+15551234567')
    expect(result?.slug).toBe('acme')
  })

  it('returns null when no company has a matching number (no fallback/default company)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([row('acme', { zerovoiceE164: '+15551234567' })]),
    )
    const result = await resolveAppByZeroVoiceNumber('+19998887777')
    expect(result).toBeNull()
  })

  it('returns null for an empty e164 without calling fetch', async () => {
    const result = await resolveAppByZeroVoiceNumber('')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns null when the underlying read fails (never fabricates a match)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(500))
    const result = await resolveAppByZeroVoiceNumber('+15551234567')
    expect(result).toBeNull()
  })

  it('excludes a soft-deleted company even if its number matches', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([
        row('acme', { zerovoiceE164: '+15551234567', lifecycleStatus: 'deleted' }),
      ]),
    )
    const result = await resolveAppByZeroVoiceNumber('+15551234567')
    expect(result).toBeNull()
  })

  it('collapses to the latest row per slug before matching (latest-wins)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([
        row('acme', { zerovoiceE164: '+15551234567', createdAt: '2026-08-01T00:00:00Z' }),
        row('acme', { zerovoiceE164: '+15559990000', createdAt: '2026-08-02T00:00:00Z' }),
      ]),
    )
    // The older row's number should no longer match — the newer row replaced it.
    const stale = await resolveAppByZeroVoiceNumber('+15551234567')
    expect(stale).toBeNull()
  })
})
