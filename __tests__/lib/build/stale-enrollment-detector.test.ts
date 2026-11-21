import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #2156 — findEnrolledCompaniesMissingChatId() cross-references the registry's
 * chatId-less rows (lib/build/app-registry.ts's listRegistryEntriesMissingChatId)
 * against the nightly-loop enrollment store (lib/build/loop-enrollment.ts's
 * listEnrolled) to surface the cohort that is BOTH: a company nightly-loop
 * keeps spending real cycles on, with a registry row that has nothing for any
 * pipeline to act on. Confirmed live: "flo", 24+ consecutive days.
 *
 * Read-only by construction — it calls two existing read functions and does
 * no writes of its own, so there is nothing here to gate behind --apply.
 */

const listRegistryEntriesMissingChatId = vi.fn()
const listEnrolled = vi.fn()

vi.mock('@/lib/build/app-registry', () => ({
  listRegistryEntriesMissingChatId: (...a: unknown[]) => listRegistryEntriesMissingChatId(...a),
}))
vi.mock('@/lib/build/loop-enrollment', () => ({
  listEnrolled: (...a: unknown[]) => listEnrolled(...a),
}))

import { findEnrolledCompaniesMissingChatId } from '@/lib/build/stale-enrollment-detector'

beforeEach(() => {
  vi.clearAllMocks()
  listRegistryEntriesMissingChatId.mockResolvedValue({ ok: true, apps: [] })
  listEnrolled.mockResolvedValue([])
})

describe('findEnrolledCompaniesMissingChatId (#2156)', () => {
  it('returns the intersection: enrolled AND registry chatId missing', async () => {
    listRegistryEntriesMissingChatId.mockResolvedValue({
      ok: true,
      apps: [{ slug: 'flo', name: 'Flo' }, { slug: 'not-enrolled', name: 'NotEnrolled' }],
    })
    listEnrolled.mockResolvedValue([
      { companyId: 'flo', companyName: 'Flo', enabled: true, enrolledAt: '2026-10-25T00:00:00Z', lastRunAt: '2026-11-18T07:30:49Z' },
      { companyId: 'some-other-co', companyName: 'Other', enabled: true, enrolledAt: '2026-10-20T00:00:00Z' },
    ])

    const result = await findEnrolledCompaniesMissingChatId()

    expect(result.ok).toBe(true)
    expect(result.companies).toEqual([
      { slug: 'flo', companyName: 'Flo', enrolledAt: '2026-10-25T00:00:00Z', lastRunAt: '2026-11-18T07:30:49Z' },
    ])
  })

  it('excludes a chatId-missing company that is not nightly-loop-enrolled', async () => {
    listRegistryEntriesMissingChatId.mockResolvedValue({ ok: true, apps: [{ slug: 'ghost', name: 'Ghost' }] })
    listEnrolled.mockResolvedValue([])

    const result = await findEnrolledCompaniesMissingChatId()
    expect(result.companies).toEqual([])
  })

  it('excludes an enrolled company whose registry row DOES have a chatId', async () => {
    listRegistryEntriesMissingChatId.mockResolvedValue({ ok: true, apps: [] })
    listEnrolled.mockResolvedValue([
      { companyId: 'acme', companyName: 'Acme', enabled: true, enrolledAt: '2026-10-25T00:00:00Z' },
    ])

    const result = await findEnrolledCompaniesMissingChatId()
    expect(result.companies).toEqual([])
  })

  it('propagates ok:false from a failed registry read instead of reporting an empty cohort', async () => {
    listRegistryEntriesMissingChatId.mockResolvedValue({ ok: false, apps: [] })
    listEnrolled.mockResolvedValue([
      { companyId: 'flo', companyName: 'Flo', enabled: true, enrolledAt: '2026-10-25T00:00:00Z' },
    ])

    const result = await findEnrolledCompaniesMissingChatId()
    expect(result.ok).toBe(false)
    expect(result.companies).toEqual([])
  })

  it('falls back to the registry name, then the slug, when enrollment has no companyName', async () => {
    listRegistryEntriesMissingChatId.mockResolvedValue({
      ok: true,
      apps: [{ slug: 'flo', name: 'Flo Inc' }],
    })
    listEnrolled.mockResolvedValue([
      { companyId: 'flo', companyName: '', enabled: true, enrolledAt: '2026-10-25T00:00:00Z' },
    ])

    const result = await findEnrolledCompaniesMissingChatId()
    expect(result.companies[0].companyName).toBe('Flo Inc')
  })
})
