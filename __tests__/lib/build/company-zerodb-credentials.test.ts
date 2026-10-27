import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #806/#844 — per-company ZeroDB data-plane key store.
 *
 * The bug: every /api/db call and every visitor read used ONE shared,
 * service-wide ZERODB_API_KEY against a COMPANY'S OWN ZeroDB project, which
 * ZeroDB rejects (403 API_KEY_PROJECT_MISMATCH). Reads returned 0 forever and
 * writes — real waitlist signups — were silently lost behind the generated
 * app's `.catch(() => {})` success UI. The correctly-scoped key was minted at
 * provision time and thrown away. This store is where it now lives, encrypted.
 *
 * The invariant these tests protect: resolution FAILS CLOSED. It must never
 * hand back the shared key for a project the shared key isn't scoped to.
 */

const ENC_KEY = 'a'.repeat(64) // 32 bytes hex — credentials.service's required shape

beforeEach(() => {
  vi.resetModules()
  process.env.DEPLOYMENT_ENCRYPTION_KEY = ENC_KEY
  process.env.ZERODB_API_KEY = 'shared-service-key'
  process.env.ZERODB_PROJECT_ID = 'builder-registry-project'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function load() {
  return await import('@/lib/build/company-zerodb-credentials')
}

describe('storeCompanyZerodbKey', () => {
  it('persists the key ENCRYPTED — the plaintext key never appears in the written row', async () => {
    const calls: Array<{ url: string; body: any }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { storeCompanyZerodbKey } = await load()
    const ok = await storeCompanyZerodbKey('company-project-1', 'sk_super_secret_value', {
      slug: 'acme',
      keyKind: 'permanent',
    })
    expect(ok).toBe(true)

    const write = calls.find((c) => c.url.includes('/rows'))
    expect(write).toBeTruthy()
    const row = write!.body.row_data
    expect(row.projectId).toBe('company-project-1')
    expect(row.slug).toBe('acme')
    expect(row.keyKind).toBe('permanent')
    // The real security property: ciphertext + iv + authTag, no plaintext anywhere.
    expect(row.encryptedKey).toBeTruthy()
    expect(row.iv).toBeTruthy()
    expect(row.authTag).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain('sk_super_secret_value')
  })

  it('returns false (never throws) when the write fails — caller must fail closed later', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const { storeCompanyZerodbKey } = await load()
    expect(await storeCompanyZerodbKey('p1', 'sk_x')).toBe(false)
  })

  it('returns false on missing inputs without calling out at all', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { storeCompanyZerodbKey } = await load()
    expect(await storeCompanyZerodbKey('', 'sk_x')).toBe(false)
    expect(await storeCompanyZerodbKey('p1', '')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('resolveCompanyZerodbKey', () => {
  it('round-trips: a stored key decrypts back to the exact original secret', async () => {
    let storedRow: any = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        if (init?.method === 'POST' && u.includes('/rows')) {
          storedRow = JSON.parse(init.body).row_data
          return { ok: true, status: 200, json: async () => ({}) }
        }
        if (u.includes('/rows?')) {
          return { ok: true, status: 200, json: async () => ({ data: [{ row_data: storedRow }] }) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { storeCompanyZerodbKey, resolveCompanyZerodbKey } = await load()
    await storeCompanyZerodbKey('proj-A', 'sk_live_abc123', { slug: 'acme' })
    const resolved = await resolveCompanyZerodbKey('proj-A')
    expect(resolved.ok).toBe(true)
    expect(resolved.apiKey).toBe('sk_live_abc123')
  })

  it('FAILS CLOSED with not_stored for a company provisioned before this fix — never the shared key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })))
    const { resolveCompanyZerodbKey } = await load()
    const resolved = await resolveCompanyZerodbKey('legacy-project')
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toBe('not_stored')
    expect(resolved.apiKey).toBeUndefined()
    // The whole point: the shared key is NOT offered as a fallback.
    expect(resolved.apiKey).not.toBe('shared-service-key')
  })

  it('never returns another project\'s key — rows are matched on projectId exactly', async () => {
    let rows: any[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        if (init?.method === 'POST' && u.includes('/rows')) {
          rows.push({ row_data: JSON.parse(init.body).row_data })
          return { ok: true, status: 200, json: async () => ({}) }
        }
        if (u.includes('/rows?')) return { ok: true, status: 200, json: async () => ({ data: rows }) }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { storeCompanyZerodbKey, resolveCompanyZerodbKey } = await load()
    await storeCompanyZerodbKey('proj-A', 'sk_key_for_A')
    await storeCompanyZerodbKey('proj-B', 'sk_key_for_B')
    expect((await resolveCompanyZerodbKey('proj-A')).apiKey).toBe('sk_key_for_A')
    expect((await resolveCompanyZerodbKey('proj-B')).apiKey).toBe('sk_key_for_B')
    expect((await resolveCompanyZerodbKey('proj-C')).ok).toBe(false)
  })

  it('latest row wins when a project was re-provisioned (append-only store)', async () => {
    const mkRows = (rows: any[]) => rows.map((r) => ({ row_data: r }))
    let captured: any[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        if (init?.method === 'POST' && u.includes('/rows')) {
          captured.push(JSON.parse(init.body).row_data)
          return { ok: true, status: 200, json: async () => ({}) }
        }
        if (u.includes('/rows?')) return { ok: true, status: 200, json: async () => ({ data: mkRows(captured) }) }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { storeCompanyZerodbKey, resolveCompanyZerodbKey } = await load()
    await storeCompanyZerodbKey('proj-A', 'sk_old')
    // Force a strictly later createdAt so the sort is deterministic.
    await new Promise((r) => setTimeout(r, 5))
    await storeCompanyZerodbKey('proj-A', 'sk_new')
    expect((await resolveCompanyZerodbKey('proj-A')).apiKey).toBe('sk_new')
  })

  it('FAILS CLOSED with decrypt_failed on a corrupted/tampered row (GCM auth tag)', async () => {
    const bad = {
      projectId: 'proj-A',
      encryptedKey: 'deadbeef',
      iv: '00000000000000000000000000000000',
      authTag: '00000000000000000000000000000000',
      createdAt: new Date().toISOString(),
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ row_data: bad }] }) })))
    const { resolveCompanyZerodbKey } = await load()
    const resolved = await resolveCompanyZerodbKey('proj-A')
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toBe('decrypt_failed')
    expect(resolved.apiKey).toBeUndefined()
  })

  it('FAILS CLOSED (not_stored) on a lookup error — never throws, never falls back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { resolveCompanyZerodbKey } = await load()
    const resolved = await resolveCompanyZerodbKey('proj-A')
    expect(resolved.ok).toBe(false)
    expect(resolved.apiKey).toBeUndefined()
  })

  it('FAILS CLOSED with trial_expired for a tmp_ key past its 72h window — never passes an expired key through to ZeroDB (#1579)', async () => {
    const expired = {
      projectId: 'proj-expired',
      keyKind: 'tmp',
      encryptedKey: 'irrelevant',
      iv: 'irrelevant',
      authTag: 'irrelevant',
      createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(), // 73h ago
    }
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ row_data: expired }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { resolveCompanyZerodbKey } = await load()
    const resolved = await resolveCompanyZerodbKey('proj-expired')
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toBe('trial_expired')
    expect(resolved.apiKey).toBeUndefined()
    // Only one fetch (the row lookup) — the (irrelevant/undecryptable) key is
    // never even attempted, let alone handed to a caller.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a tmp_ key still inside its 72h window resolves normally', async () => {
    let storedRow: any = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        if (init?.method === 'POST' && u.includes('/rows')) {
          storedRow = JSON.parse(init.body).row_data
          return { ok: true, status: 200, json: async () => ({}) }
        }
        if (u.includes('/rows?')) {
          return { ok: true, status: 200, json: async () => ({ data: [{ row_data: storedRow }] }) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { storeCompanyZerodbKey, resolveCompanyZerodbKey } = await load()
    await storeCompanyZerodbKey('proj-fresh', 'tmp_still_good', { keyKind: 'tmp' })
    const resolved = await resolveCompanyZerodbKey('proj-fresh')
    expect(resolved.ok).toBe(true)
    expect(resolved.apiKey).toBe('tmp_still_good')
  })

  it('a permanent (claimed/paid) key is never subject to the trial-expiry check, however old', async () => {
    const old = {
      projectId: 'proj-paid',
      keyKind: 'permanent',
      encryptedKey: 'irrelevant',
      iv: 'irrelevant',
      authTag: 'irrelevant',
      createdAt: new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000).toISOString(), // 1000 days ago
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ row_data: old }] }) })))
    const { resolveCompanyZerodbKey } = await load()
    const resolved = await resolveCompanyZerodbKey('proj-paid')
    // Falls through to the real decrypt attempt (fails here only because the
    // fixture's key isn't real ciphertext) — the point is it's NOT trial_expired.
    expect(resolved.reason).not.toBe('trial_expired')
  })

  it('FAILS CLOSED with trial_expired using the REAL expiresAt even when createdAt is well within the 72h fallback window (#1602) — the exact bug: core mints a tmp_ key that dies in 24h, not 72h', async () => {
    const mintedAt = Date.now() - 25 * 60 * 60 * 1000 // 25h ago — inside 72h, so the OLD code would wrongly say "still fine"
    const realExpiry = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // but the real expiry (24h from mint) already passed
    const died24hAgo = {
      projectId: 'proj-real-expiry',
      keyKind: 'tmp',
      expiresAt: realExpiry,
      encryptedKey: 'irrelevant',
      iv: 'irrelevant',
      authTag: 'irrelevant',
      createdAt: new Date(mintedAt).toISOString(),
    }
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ row_data: died24hAgo }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { resolveCompanyZerodbKey } = await load()
    const resolved = await resolveCompanyZerodbKey('proj-real-expiry')
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toBe('trial_expired')
    expect(resolved.apiKey).toBeUndefined()
    // Never even attempts the (irrelevant/undecryptable) key once expiry is known.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a tmp_ key with a REAL expiresAt still in the future resolves normally, even past the old 72h-from-createdAt mark (#1602)', async () => {
    let storedRow: any = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        if (init?.method === 'POST' && u.includes('/rows')) {
          storedRow = JSON.parse(init.body).row_data
          return { ok: true, status: 200, json: async () => ({}) }
        }
        if (u.includes('/rows?')) {
          return { ok: true, status: 200, json: async () => ({ data: [{ row_data: storedRow }] }) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { storeCompanyZerodbKey, resolveCompanyZerodbKey } = await load()
    const farFutureExpiry = new Date(Date.now() + 1000 * 60 * 60 * 1000).toISOString() // way past 72h out
    await storeCompanyZerodbKey('proj-long-lived', 'tmp_still_good_long', {
      keyKind: 'tmp',
      expiresAt: farFutureExpiry,
    })
    const resolved = await resolveCompanyZerodbKey('proj-long-lived')
    expect(resolved.ok).toBe(true)
    expect(resolved.apiKey).toBe('tmp_still_good_long')
  })

  it('storeCompanyZerodbKey persists expiresAt verbatim on the written row (#1602)', async () => {
    const calls: Array<{ url: string; body: any }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { storeCompanyZerodbKey } = await load()
    const expiresAt = '2026-10-27T04:28:50.113111+00:00'
    await storeCompanyZerodbKey('proj-exp', 'tmp_x', { keyKind: 'tmp', expiresAt })
    const write = calls.find((c) => c.url.includes('/rows'))
    expect(write!.body.row_data.expiresAt).toBe(expiresAt)
  })

  it('a tmp_ row with no expiresAt (stored before #1602) still falls back to the 72h createdAt guess, unchanged', async () => {
    const legacyNoExpiresAt = {
      projectId: 'proj-legacy',
      keyKind: 'tmp',
      // no expiresAt field at all — simulates a row written before this fix
      encryptedKey: 'irrelevant',
      iv: 'irrelevant',
      authTag: 'irrelevant',
      createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(), // 73h ago
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ row_data: legacyNoExpiresAt }] }) })))
    const { resolveCompanyZerodbKey } = await load()
    const resolved = await resolveCompanyZerodbKey('proj-legacy')
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toBe('trial_expired')
  })

  it('FAILS CLOSED with unconfigured when the store itself has no credentials', async () => {
    process.env.ZERODB_API_KEY = ''
    process.env.AINATIVE_API_KEY = ''
    process.env.API_Key = ''
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { resolveCompanyZerodbKey } = await load()
    const resolved = await resolveCompanyZerodbKey('proj-A')
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toBe('unconfigured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
