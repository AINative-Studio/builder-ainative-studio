import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(storedRows: Array<Record<string, unknown>>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' && u.includes('/rows')) {
      const body = JSON.parse(String(init.body))
      storedRows.push(body.row_data)
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
    }
    if (u.includes('/rows')) {
      return {
        ok: true, status: 200,
        json: async () => storedRows.map((row_data) => ({ row_data })),
        text: async () => JSON.stringify(storedRows.map((row_data) => ({ row_data }))),
      } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('artifact-versions (#BLD-06.4)', () => {
  it('saves a version and lists it back, newest first', async () => {
    mockFetch([])
    const { saveArtifactVersion, listArtifactVersions } = await import('@/lib/build/artifact-versions')
    await saveArtifactVersion('acme', 'thesis', { headline: 'v1' })
    await new Promise((r) => setTimeout(r, 2))
    await saveArtifactVersion('acme', 'thesis', { headline: 'v2' })
    const versions = await listArtifactVersions('acme', 'thesis')
    expect(versions.length).toBe(2)
    expect((versions[0].content as any).headline).toBe('v2')
  })

  it('restores a specific version by id', async () => {
    const rows: Array<Record<string, unknown>> = []
    mockFetch(rows)
    const { saveArtifactVersion, listArtifactVersions, restoreArtifactVersion } = await import('@/lib/build/artifact-versions')
    await saveArtifactVersion('acme', 'thesis', { headline: 'v1' })
    const versions = await listArtifactVersions('acme', 'thesis')
    const result = await restoreArtifactVersion('acme', 'thesis', versions[0].id)
    expect(result.ok).toBe(true)
    expect((result.content as any).headline).toBe('v1')
  })

  it('never throws when the store write fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '{}' }) as unknown as Response))
    const { saveArtifactVersion } = await import('@/lib/build/artifact-versions')
    const result = await saveArtifactVersion('acme', 'thesis', { headline: 'x' })
    expect(result.ok).toBe(false)
  })
})
