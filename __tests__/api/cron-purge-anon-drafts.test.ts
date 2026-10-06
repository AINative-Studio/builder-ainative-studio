/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
  delete process.env.CRON_SECRET
})

function mockFetch(rows: Array<{ row_id: string; row_data: Record<string, unknown> }>) {
  const deleted: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'DELETE') { deleted.push(u); return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response }
    if (u.includes('/rows')) return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) } as unknown as Response
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
  }))
  return deleted
}

function req(url: string) {
  return { url, headers: { get: () => null } } as any
}

import { GET } from '@/app/api/cron/purge-anon-drafts/route'

describe('GET /api/cron/purge-anon-drafts (#E3.4)', () => {
  it('deletes drafts older than 30 days, keeps recent ones', async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    const recent = new Date().toISOString()
    const deleted = mockFetch([
      { row_id: 'row-old', row_data: { token: 'old-1', updatedAt: old } },
      { row_id: 'row-recent', row_data: { token: 'recent-1', updatedAt: recent } },
    ])
    const res = await GET(req('https://builder.ainative.studio/api/cron/purge-anon-drafts'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.purged).toBe(1)
    expect(deleted.some((u) => u.includes('row-old'))).toBe(true)
    expect(deleted.some((u) => u.includes('row-recent'))).toBe(false)
  })
})
