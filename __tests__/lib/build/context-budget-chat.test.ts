/**
 * Context Budget Manager <-> real chat flow wiring tests (#1195).
 *
 * The Context Budget Manager (service/API/UI) previously existed only as a
 * standalone demo with hardcoded session/user IDs
 * (app/context-budget-demo/page.tsx), never touching the real chat flow
 * (app/api/chat-ws/route.ts). This covers lib/build/context-budget-chat.ts,
 * the module that does the real wiring:
 *  - it calls the REAL budget service with the REAL session/user, not demo
 *    IDs
 *  - it trims the real conversation history once the real budget is
 *    critical/exhausted
 *  - above all: a failure anywhere in the budget check (DB down, service
 *    throws, call hangs) must NEVER throw and must NEVER change what the
 *    caller gets back beyond the original, untrimmed messages — chat
 *    generation is the most important path in this app and must never be
 *    blocked or broken by this integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTrackItem = vi.fn()
const mockGetBudget = vi.fn()

vi.mock('@/lib/services/context-budget.service', () => ({
  contextBudgetService: {
    trackItem: (...args: any[]) => mockTrackItem(...args),
    getBudget: (...args: any[]) => mockGetBudget(...args),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { applyChatBudget, type ChatMessage } from '@/lib/build/context-budget-chat'

function healthyBudget(overrides: Partial<Record<string, any>> = {}) {
  return {
    total: 128000,
    used: 1000,
    remaining: 127000,
    allocations: [],
    usagePercentage: 1,
    isWarning: false,
    isCritical: false,
    sessionId: 'session-1',
    userId: 'user-1',
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('applyChatBudget (#1195 real chat flow wiring)', () => {
  beforeEach(() => {
    mockTrackItem.mockReset()
    mockGetBudget.mockReset()
  })

  it('uses the REAL sessionId/userId passed in, not hardcoded demo IDs', async () => {
    mockTrackItem.mockResolvedValue({ item: {}, budget: healthyBudget(), warnings: [] })
    mockGetBudget.mockResolvedValue(healthyBudget())

    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]
    await applyChatBudget('real-chat-id-abc123', 'founder@example.com', messages)

    expect(mockTrackItem).toHaveBeenCalledWith(
      'real-chat-id-abc123',
      'founder@example.com',
      expect.objectContaining({ type: 'history' }),
      'load'
    )
    expect(mockGetBudget).toHaveBeenCalledWith('real-chat-id-abc123', 'founder@example.com')

    // Never the demo page's hardcoded values.
    expect(mockTrackItem).not.toHaveBeenCalledWith(
      expect.stringContaining('demo-session'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
    expect(mockTrackItem.mock.calls[0][1]).not.toBe('demo-user')
  })

  it('returns messages untouched and budget=null for a brand-new chat (no history yet)', async () => {
    const result = await applyChatBudget('new-chat-id', 'user-1', [])
    expect(result).toEqual({ messages: [], budget: null, trimmed: false, droppedCount: 0 })
    // Should skip the DB round-trip entirely for an empty history.
    expect(mockTrackItem).not.toHaveBeenCalled()
    expect(mockGetBudget).not.toHaveBeenCalled()
  })

  it('does not trim when the real budget has plenty of remaining room', async () => {
    mockTrackItem.mockResolvedValue({ item: {}, budget: healthyBudget(), warnings: [] })
    mockGetBudget.mockResolvedValue(healthyBudget({ usagePercentage: 10 }))

    const messages: ChatMessage[] = [
      { role: 'user', content: 'first message' },
      { role: 'assistant', content: 'first reply' },
      { role: 'user', content: 'second message' },
    ]
    const result = await applyChatBudget('session-1', 'user-1', messages)

    expect(result.trimmed).toBe(false)
    expect(result.droppedCount).toBe(0)
    expect(result.messages).toEqual(messages)
    expect(result.budget).toMatchObject({ usagePercentage: 10, isCritical: false })
  })

  it('trims the OLDEST messages first when the real budget is critical/over', async () => {
    mockTrackItem.mockResolvedValue({ item: {}, budget: healthyBudget(), warnings: [] })

    const messages: ChatMessage[] = [
      { role: 'user', content: 'oldest message, should be dropped first '.repeat(10) },
      { role: 'assistant', content: 'older reply '.repeat(10) },
      { role: 'user', content: 'newest message' },
      { role: 'assistant', content: 'newest reply' },
    ]
    const historyTokenCost = Math.ceil(
      (messages.map((m) => m.content).join('\n').length / 4) * 1.1
    )
    // Critical budget where everything else in the session (used - this
    // history item's own tracked cost) already consumes almost all of the
    // total budget, leaving far less room than the full history needs —
    // forcing real trimming.
    const total = 200
    const otherUsage = 180
    mockGetBudget.mockResolvedValue(
      healthyBudget({
        total,
        used: otherUsage + historyTokenCost,
        remaining: total - (otherUsage + historyTokenCost),
        usagePercentage: 98,
        isCritical: true,
        isWarning: true,
      })
    )
    const result = await applyChatBudget('session-1', 'user-1', messages)

    expect(result.trimmed).toBe(true)
    expect(result.droppedCount).toBeGreaterThan(0)
    // The two most recent messages must always survive.
    expect(result.messages[result.messages.length - 1]).toEqual(messages[messages.length - 1])
    expect(result.messages[result.messages.length - 2]).toEqual(messages[messages.length - 2])
    // The oldest message must be the one dropped, not a middle/newer one.
    expect(result.messages).not.toContainEqual(messages[0])
    expect(result.budget).toMatchObject({ isCritical: true })
  })

  it('never trims below the minimum of 2 kept messages, even if still over budget', async () => {
    mockTrackItem.mockResolvedValue({ item: {}, budget: healthyBudget(), warnings: [] })
    mockGetBudget.mockResolvedValue(
      healthyBudget({ total: 10, used: 10, remaining: 0, usagePercentage: 100, isCritical: true })
    )

    const messages: ChatMessage[] = [
      { role: 'user', content: 'a very long message '.repeat(200) },
      { role: 'assistant', content: 'another very long message '.repeat(200) },
    ]
    const result = await applyChatBudget('session-1', 'user-1', messages)

    expect(result.messages).toHaveLength(2)
    expect(result.droppedCount).toBe(0)
  })

  it('fails open (returns original messages, budget=null) when trackItem throws', async () => {
    mockTrackItem.mockRejectedValue(new Error('DB connection refused'))

    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const result = await applyChatBudget('session-1', 'user-1', messages)

    expect(result).toEqual({ messages, budget: null, trimmed: false, droppedCount: 0 })
  })

  it('fails open when getBudget throws', async () => {
    mockTrackItem.mockResolvedValue({ item: {}, budget: healthyBudget(), warnings: [] })
    mockGetBudget.mockRejectedValue(new Error('relation "budget_tracking" does not exist'))

    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const result = await applyChatBudget('session-1', 'user-1', messages)

    expect(result).toEqual({ messages, budget: null, trimmed: false, droppedCount: 0 })
  })

  it('fails open when the budget service hangs past the timeout (never blocks chat)', async () => {
    mockTrackItem.mockImplementation(() => new Promise(() => {})) // never resolves
    mockGetBudget.mockImplementation(() => new Promise(() => {}))

    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const result = await applyChatBudget('session-1', 'user-1', messages)

    expect(result).toEqual({ messages, budget: null, trimmed: false, droppedCount: 0 })
  }, 2000)

  it('fails open when sessionId or userId is missing/empty', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }]

    const resultNoSession = await applyChatBudget('', 'user-1', messages)
    expect(resultNoSession.messages).toEqual(messages)
    expect(resultNoSession.budget).toBeNull()

    const resultNoUser = await applyChatBudget('session-1', '', messages)
    expect(resultNoUser.messages).toEqual(messages)
    expect(resultNoUser.budget).toBeNull()

    expect(mockTrackItem).not.toHaveBeenCalled()
  })
})
