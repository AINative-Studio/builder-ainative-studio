import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1188 — real tool_use wiring on the Live-dashboard "Ask Cody" chat
 * (app/api/build/ask/route.ts's askCody). Verifies that when the model
 * returns a tool_use response, askCody:
 *   1. actually calls the real tool handler (runAskTool) — mocked HERE at
 *      the boundary, not the whole route, per this session's test
 *      convention — with the model's own tool name/input,
 *   2. feeds the tool's result back to the model as a tool_result content
 *      block in a follow-up messages.create call,
 *   3. returns the model's final text answer once it stops calling tools.
 *
 * Every other I/O boundary askCody touches (chat history/persistence, plan
 * resolution, the primitive catalog, Gitea) is mocked to a safe default so
 * this test exercises ONLY the tool_use loop, not the whole feature surface
 * those other modules already have their own tests for.
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
  getClaudeCompletion: vi.fn(),
  runAskTool: vi.fn(),
  resolveApp: vi.fn(),
  resolveActivePlan: vi.fn(),
  loadChatWithFallback: vi.fn(),
  saveExchange: vi.fn(),
  listIssues: vi.fn(),
  createIssue: vi.fn(),
}))

vi.mock('@/lib/build/claude-completion', () => ({
  getClaudeCompletion: h.getClaudeCompletion,
  completeText: vi.fn(async () => ({ text: 'NO', provider: 'anthropic', model: 'x' })),
}))
vi.mock('@/lib/build/ask-tools', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/ask-tools')>('@/lib/build/ask-tools')
  return { ...actual, runAskTool: h.runAskTool }
})
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/ainative/active-plan', () => ({ resolveActivePlan: h.resolveActivePlan }))
vi.mock('@/lib/build/chat-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/chat-store')>('@/lib/build/chat-store')
  return { ...actual, loadChatWithFallback: h.loadChatWithFallback, saveExchange: h.saveExchange }
})
vi.mock('@/lib/git/gitea-client', () => ({ listIssues: h.listIssues, createIssue: h.createIssue }))
vi.mock('@/lib/agent/zeromemory', () => ({ processConversation: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: vi.fn(async () => null) }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: vi.fn(async () => ({ tier: 'hobbyist' })) }))

beforeEach(() => {
  h.create.mockReset()
  h.runAskTool.mockReset()
  h.resolveApp.mockReset().mockResolvedValue(null)
  h.resolveActivePlan.mockReset().mockResolvedValue({ plan: '', verified: true })
  h.loadChatWithFallback.mockReset().mockResolvedValue([])
  h.saveExchange.mockReset().mockResolvedValue(true)
  h.listIssues.mockReset().mockResolvedValue({ ok: true, issues: [] })
  h.getClaudeCompletion.mockReset().mockReturnValue({
    client: { messages: { create: h.create } },
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    label: 'Anthropic',
  })
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => null }) as any
})

describe('askCody tool_use loop (#1188)', () => {
  it('calls the real tool handler on a tool_use response and feeds the result back as tool_result', async () => {
    // Round 1: the model asks to read the "products" table.
    h.create.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'toolu_1', name: 'query_zerodb_table', input: { table: 'products' } },
      ],
    })
    // Round 2: the model answers using the real tool result it was given.
    h.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'You have 2 products: Widget and Gadget.' }],
    })
    h.runAskTool.mockResolvedValue({
      result: { table: 'products', rowCount: 2, rows: [{ id: '1', name: 'Widget' }, { id: '2', name: 'Gadget' }] },
      isError: false,
    })

    const { askCody } = await import('@/app/api/build/ask/route')
    const result = await askCody({
      question: "what's in my products table",
      idea: 'an online store',
      companyName: 'Acme',
      track: 'company',
      companyId: 'acme',
      scopeKey: 'owner:acme',
      tier: 'hobbyist',
      baseUrl: 'https://builder.ainative.studio',
    })

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.answer).toBe('You have 2 products: Widget and Gadget.')
    }

    // The real handler was actually invoked with the model's own tool call —
    // never a fabricated/hardcoded result substituted in its place.
    expect(h.runAskTool).toHaveBeenCalledWith('query_zerodb_table', { table: 'products' }, { companyId: 'acme' })

    // Exactly two rounds: the tool_use round, then the follow-up with the
    // real tool_result fed back.
    expect(h.create).toHaveBeenCalledTimes(2)
    const secondCallArgs = h.create.mock.calls[1][0]
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1]
    expect(lastMessage.role).toBe('user')
    const toolResultBlock = lastMessage.content.find((b: any) => b.type === 'tool_result')
    expect(toolResultBlock.tool_use_id).toBe('toolu_1')
    expect(JSON.parse(toolResultBlock.content)).toEqual({
      table: 'products',
      rowCount: 2,
      rows: [{ id: '1', name: 'Widget' }, { id: '2', name: 'Gadget' }],
    })
    expect(toolResultBlock.is_error).toBeUndefined()

    // Both calls advertised the real tool definitions to the model.
    expect(secondCallArgs.tools).toBeDefined()
    expect(secondCallArgs.tools.some((t: any) => t.name === 'query_zerodb_table')).toBe(true)
  }, 15000)

  it('marks the tool_result as an error when the real tool call fails, without inventing data', async () => {
    h.create.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_2', name: 'query_zerodb_table', input: { table: 'ghost' } }],
    })
    h.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: "That table doesn't exist yet." }],
    })
    h.runAskTool.mockResolvedValue({
      result: { table: 'ghost', rowCount: 0, rows: [], error: 'Table "ghost" does not exist yet — nothing has been written to it.' },
      isError: true,
    })

    const { askCody } = await import('@/app/api/build/ask/route')
    await askCody({
      question: "what's in my ghost table",
      idea: 'an app',
      companyName: 'Acme',
      track: 'app',
      companyId: 'acme',
      scopeKey: 'owner:acme',
      tier: 'hobbyist',
      baseUrl: 'https://builder.ainative.studio',
    })

    const secondCallArgs = h.create.mock.calls[1][0]
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1]
    const toolResultBlock = lastMessage.content.find((b: any) => b.type === 'tool_result')
    expect(toolResultBlock.is_error).toBe(true)
  })

  it('answers directly without any tool call when the model does not need one', async () => {
    h.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Your app is live at the preview URL.' }],
    })

    const { askCody } = await import('@/app/api/build/ask/route')
    const result = await askCody({
      question: 'is my app live?',
      idea: 'an app',
      companyName: 'Acme',
      track: 'app',
      companyId: 'acme',
      scopeKey: 'owner:acme',
      tier: 'hobbyist',
      baseUrl: 'https://builder.ainative.studio',
    })

    expect(h.runAskTool).not.toHaveBeenCalled()
    expect(h.create).toHaveBeenCalledTimes(1)
    if (!('error' in result)) {
      expect(result.answer).toBe('Your app is live at the preview URL.')
    }
  })

  it('bounds the loop so a model that keeps calling tools can never hang the request', async () => {
    h.create.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_x', name: 'query_zerodb_table', input: { table: 'products' } }],
    })
    h.runAskTool.mockResolvedValue({ result: { table: 'products', rowCount: 0, rows: [] }, isError: false })

    const { askCody } = await import('@/app/api/build/ask/route')
    const result = await askCody({
      question: 'what is in products',
      idea: 'a store',
      companyName: 'Acme',
      track: 'company',
      companyId: 'acme',
      scopeKey: 'owner:acme',
      tier: 'hobbyist',
      baseUrl: 'https://builder.ainative.studio',
    })

    // Bounded at 4 rounds (MAX_TOOL_ROUNDS) — never infinite.
    expect(h.create).toHaveBeenCalledTimes(4)
    // No final text block was ever produced, so this degrades to the
    // ainative fallback / unavailable — never a crash.
    expect(result).toBeTruthy()
  })

  // #1268: MAX_TOOL_ROUNDS only bounds the number of rounds, not any single
  // round's own latency — a stalled round used to hang the whole request
  // forever regardless of the round cap. Each call must carry its own
  // AbortSignal so a stalled round fails fast instead.
  it('passes an AbortSignal to every messages.create call in the loop (#1268)', async () => {
    h.create.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_3', name: 'query_zerodb_table', input: { table: 'products' } }],
    })
    h.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Done.' }],
    })
    h.runAskTool.mockResolvedValue({ result: { table: 'products', rowCount: 0, rows: [] }, isError: false })

    const { askCody } = await import('@/app/api/build/ask/route')
    await askCody({
      question: 'what is in products',
      idea: 'a store',
      companyName: 'Acme',
      track: 'company',
      companyId: 'acme',
      scopeKey: 'owner:acme',
      tier: 'hobbyist',
      baseUrl: 'https://builder.ainative.studio',
    })

    expect(h.create).toHaveBeenCalledTimes(2)
    for (const call of h.create.mock.calls) {
      const [, options] = call
      expect(options?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('a stalled round is caught by its own AbortSignal — never hangs despite the round cap (#1268)', async () => {
    h.create.mockImplementation((_params: unknown, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')))
    }))

    const { askCody } = await import('@/app/api/build/ask/route')
    const pending = askCody({
      question: 'what is in products',
      idea: 'a store',
      companyName: 'Acme',
      track: 'company',
      companyId: 'acme',
      scopeKey: 'owner:acme',
      tier: 'hobbyist',
      baseUrl: 'https://builder.ainative.studio',
    })
    await vi.waitFor(() => expect(h.create).toHaveBeenCalled())
    const [, options] = h.create.mock.calls[0]
    options.signal.dispatchEvent(new Event('abort'))
    const result = await pending
    expect(result).toBeTruthy()
  })
})
