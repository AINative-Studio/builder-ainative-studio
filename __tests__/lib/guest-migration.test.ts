import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { collectGuestCompanySlugs, migrateGuestWork } from '@/lib/build/guest-migration'

/**
 * #49 — client-side guest→real migration helper. collectGuestCompanySlugs reads
 * every `ainative_build_<slug>` localStorage key plus the active company slug;
 * migrateGuestWork POSTs those slugs to /api/build/migrate (best-effort, never
 * throws). The vitest env is 'node', so we install a minimal in-memory
 * localStorage on globalThis.window for these tests.
 */
function installLocalStorage(entries: Record<string, string>) {
  const store = new Map(Object.entries(entries))
  const ls = {
    get length() {
      return store.size
    },
    key(i: number): string | null {
      return Array.from(store.keys())[i] ?? null
    },
    getItem(k: string): string | null {
      return store.has(k) ? (store.get(k) as string) : null
    },
    setItem(k: string, v: string) {
      store.set(k, v)
    },
    removeItem(k: string) {
      store.delete(k)
    },
    clear() {
      store.clear()
    },
  }
  ;(globalThis as any).window = { localStorage: ls }
}

describe('collectGuestCompanySlugs (#49)', () => {
  afterEach(() => {
    delete (globalThis as any).window
  })

  it('returns just the current slug when localStorage is empty', () => {
    installLocalStorage({})
    expect(collectGuestCompanySlugs('acme')).toEqual(['acme'])
  })

  it('collects slugs from ainative_build_* keys and merges the current slug', () => {
    installLocalStorage({
      'ainative_build_acme': '{}',
      'ainative_build_beta': '{}',
      'unrelated_key': 'x',
    })
    const slugs = collectGuestCompanySlugs('gamma')
    expect(slugs.sort()).toEqual(['acme', 'beta', 'gamma'])
  })

  it('de-duplicates when the current slug is also in localStorage', () => {
    installLocalStorage({ 'ainative_build_acme': '{}' })
    expect(collectGuestCompanySlugs('acme')).toEqual(['acme'])
  })

  it('returns [] when there is no current slug and no storage', () => {
    installLocalStorage({})
    expect(collectGuestCompanySlugs()).toEqual([])
  })

  it('survives a missing window (SSR) and returns the current slug only', () => {
    delete (globalThis as any).window
    expect(collectGuestCompanySlugs('acme')).toEqual(['acme'])
  })
})

describe('migrateGuestWork (#49)', () => {
  beforeEach(() => {
    installLocalStorage({ 'ainative_build_acme': '{}' })
  })
  afterEach(() => {
    delete (globalThis as any).window
    vi.restoreAllMocks()
  })

  it('POSTs collected slugs to /api/build/migrate and returns the summary', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, migrated: ['acme'], skipped: [] }),
    } as unknown as Response)

    const res = await migrateGuestWork('acme', fetchImpl as unknown as typeof fetch)
    expect(res).toEqual({ migrated: ['acme'], skipped: [] })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/build/migrate')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.slugs).toContain('acme')
  })

  it('short-circuits (no fetch) when there are no slugs to migrate', async () => {
    delete (globalThis as any).window
    const fetchImpl = vi.fn()
    const res = await migrateGuestWork(undefined, fetchImpl as unknown as typeof fetch)
    expect(res).toEqual({ migrated: [], skipped: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns null on a non-ok response (never throws)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response)
    const res = await migrateGuestWork('acme', fetchImpl as unknown as typeof fetch)
    expect(res).toBeNull()
  })

  it('returns null when the server reports ok:false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'not_signed_in' }),
    } as unknown as Response)
    const res = await migrateGuestWork('acme', fetchImpl as unknown as typeof fetch)
    expect(res).toBeNull()
  })

  it('returns null on a network throw (never throws)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const res = await migrateGuestWork('acme', fetchImpl as unknown as typeof fetch)
    expect(res).toBeNull()
  })
})
