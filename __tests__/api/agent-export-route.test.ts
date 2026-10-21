import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/agent/export (builder#57, wired via #1213) — exports agent_runs
 * as JSONL for offline analysis/fine-tuning. Same admin-gate upgrade as
 * agent/metrics (#1213): this exports every founder's run data, not the
 * caller's own.
 */

const h = vi.hoisted(() => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: () => 'real-key' }))

function getReq(url: string) {
  return new NextRequest(url)
}

describe('GET /api/agent/export', () => {
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

    const { GET } = await import('@/app/api/agent/export/route')
    const res = await GET(getReq('http://localhost/api/agent/export'))

    expect(res.status).toBe(403)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('exports rows as newline-delimited JSON by default, with a Content-Disposition attachment header', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          { chat_id: 'c1', model: 'claude-sonnet-4', turns: 2, build_passed: true, duration_ms: 500, fallback: false, tools_used: '["Write","Bash"]', input_tokens: 100, output_tokens: 200, total_cost_usd: 0.05, created_at: '2026-01-01T00:00:00Z' },
        ],
      }),
    })

    const { GET } = await import('@/app/api/agent/export/route')
    const res = await GET(getReq('http://localhost/api/agent/export?days=30'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    const text = await res.text()
    const line = JSON.parse(text.trim())
    expect(line.chatId).toBe('c1')
    expect(line.toolsUsed).toEqual(['Write', 'Bash'])
  })

  it('exports as plain JSON when format=json', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) })

    const { GET } = await import('@/app/api/agent/export/route')
    const res = await GET(getReq('http://localhost/api/agent/export?format=json'))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.count).toBe(0)
    expect(Array.isArray(data.data)).toBe(true)
  })

  it('applies the optional model filter to the ZeroDB query', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) })

    const { GET } = await import('@/app/api/agent/export/route')
    await GET(getReq('http://localhost/api/agent/export?model=claude-sonnet-4'))

    const [, opts] = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.filters.model).toBe('claude-sonnet-4')
  })
})
