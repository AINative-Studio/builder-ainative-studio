import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  readComplianceTrace: vi.fn(async () => [] as any[]),
}))
vi.mock('@/lib/build/primitive-compliance-trace', () => ({ readComplianceTrace: h.readComplianceTrace }))

import { GET } from '@/app/api/build/primitive-compliance-trace/route'

function req(url: string) {
  return { url } as any
}

describe('GET /api/build/primitive-compliance-trace', () => {
  beforeEach(() => { h.readComplianceTrace.mockReset().mockResolvedValue([]) })
  afterEach(() => { vi.restoreAllMocks() })

  it('requires a chatId', async () => {
    const res = await GET(req('https://builder.ainative.studio/api/build/primitive-compliance-trace'))
    expect(res.status).toBe(400)
  })

  it('returns the traces for the given chatId', async () => {
    h.readComplianceTrace.mockResolvedValue([
      { chatId: 'chat-1', branch: 'non-combined', isMultiFile: false, attemptsRun: 1, gapsBefore: ['ZeroPipeline'], gapsAfter: [], closed: true, createdAt: '2026-09-10T10:00:00.000Z' },
    ])
    const res = await GET(req('https://builder.ainative.studio/api/build/primitive-compliance-trace?chatId=chat-1'))
    const data = await res.json()
    expect(data.chatId).toBe('chat-1')
    expect(data.traces).toHaveLength(1)
    expect(data.traces[0].closed).toBe(true)
    expect(h.readComplianceTrace).toHaveBeenCalledWith('chat-1')
  })
})
