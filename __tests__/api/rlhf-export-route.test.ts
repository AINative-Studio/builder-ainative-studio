import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/rlhf/export (#1213) — a complete, ZeroDB-backed implementation
 * exporting fine-tuning-ready training data, with zero frontend callers
 * before this issue. Confirmed `rlhf_training_data` and `rlhf_feedback` are
 * real, actively-used tables (lib/services/zerodb-rlhf.service.ts,
 * lib/zerodb-store.ts — the SAME tables /api/rlhf/insights already reads
 * for the real, live /insights dashboard).
 *
 * Upgraded the gate from "any authenticated user" to requireAdmin() — this
 * exports EVERY founder's prompts/generated code/feedback, not just the
 * caller's own. Same class of gap #919 fixed for /admin/errors.
 */

const h = vi.hoisted(() => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: () => 'real-key' }))

function getReq(url: string) {
  return new NextRequest(url)
}

describe('GET /api/rlhf/export', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('rejects a non-admin caller without querying ZeroDB', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })

    const { GET } = await import('@/app/api/rlhf/export/route')
    const res = await GET(getReq('http://localhost/api/rlhf/export'))

    expect(res.status).toBe(403)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with 401', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: 'Authentication required' })

    const { GET } = await import('@/app/api/rlhf/export/route')
    const res = await GET(getReq('http://localhost/api/rlhf/export'))

    expect(res.status).toBe(401)
  })

  it('exports real training rows as JSONL, reconstructing messages from individual fields', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            row_data: {
              chat_id: 'c1', model: 'kimi-k2', system_prompt: 'sys', prompt: 'build a button',
              generated_code: 'export default function Button() {}', status: 'success',
              validation_valid: true, created_at: new Date().toISOString(),
            },
          },
        ],
      }),
    })

    const { GET } = await import('@/app/api/rlhf/export/route')
    const res = await GET(getReq('http://localhost/api/rlhf/export?days=30'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson')
    const text = await res.text()
    const line = JSON.parse(text.trim())
    expect(line.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'build a button' },
      { role: 'assistant', content: 'export default function Button() {}' },
    ])
    expect(line.metadata.chat_id).toBe('c1')
  })

  it('filters by min_rating via a real join against rlhf_feedback', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { row_data: { chat_id: 'low', prompt: 'a', generated_code: 'x', created_at: new Date().toISOString() } },
            { row_data: { chat_id: 'high', prompt: 'b', generated_code: 'y', created_at: new Date().toISOString() } },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { row_data: { chat_id: 'low', rating: 2 } },
            { row_data: { chat_id: 'high', rating: 5 } },
          ],
        }),
      })

    const { GET } = await import('@/app/api/rlhf/export/route')
    const res = await GET(getReq('http://localhost/api/rlhf/export?min_rating=4&format=json'))

    const data = await res.json()
    expect(data.count).toBe(1)
    expect(data.data[0].metadata.chat_id).toBe('high')
  })

  it('returns an empty export (not an error) when the ZeroDB query fails', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 500 })

    const { GET } = await import('@/app/api/rlhf/export/route')
    const res = await GET(getReq('http://localhost/api/rlhf/export?format=json'))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.count).toBe(0)
  })
})
