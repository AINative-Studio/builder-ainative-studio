import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/services/agent-runs.service.ts (builder#53) had zero test coverage.
 * It's a fire-and-forget telemetry logger to ZeroDB — every failure path
 * must swallow its error (never throw) since callers are expected to just
 * `.catch()` defensively. We mock fetch and getAinativeApiKey at the
 * boundary; no real network calls.
 */

vi.mock('@/lib/build/env-keys', () => ({
  getAinativeApiKey: vi.fn(),
}))

import { getAinativeApiKey } from '@/lib/build/env-keys'
import {
  logAgentRun,
  __resetTableEnsuredForTests,
  type AgentRunData,
} from '@/lib/services/agent-runs.service'

const ORIGINAL_ENV = { ...process.env }

function runData(overrides: Partial<AgentRunData> = {}): AgentRunData {
  return {
    chatId: 'chat-1',
    userId: 'user-1',
    model: 'claude-sonnet',
    turns: 5,
    toolsUsed: ['bash', 'read'],
    buildPassed: true,
    durationMs: 1234,
    tokenUsage: { inputTokens: 100, outputTokens: 200 },
    fallback: false,
    ...overrides,
  }
}

describe('#1201 lib/services/agent-runs.service', () => {
  beforeEach(() => {
    __resetTableEnsuredForTests()
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('skips logging entirely (no fetch call) when no API key is configured', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('')

    await logAgentRun(runData())

    expect(fetch).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('[AgentRuns] No API key — skipping log')
  })

  it('ensures the table exists before writing the row, then POSTs the row', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true } as Response) // table ensure
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response) // row insert

    await logAgentRun(runData())

    expect(fetch).toHaveBeenCalledTimes(2)
    const [tableUrl] = vi.mocked(fetch).mock.calls[0]
    const [rowUrl, rowInit] = vi.mocked(fetch).mock.calls[1]
    expect(String(tableUrl)).toContain('/database/tables')
    expect(String(rowUrl)).toContain('/database/tables/agent_runs/rows')

    const body = JSON.parse((rowInit as RequestInit).body as string)
    expect(body.row_data).toMatchObject({
      chat_id: 'chat-1',
      user_id: 'user-1',
      model: 'claude-sonnet',
      turns: 5,
      build_passed: true,
      duration_ms: 1234,
      input_tokens: 100,
      output_tokens: 200,
      total_cost_usd: 0,
      fallback: false,
    })
    expect(JSON.parse(body.row_data.tools_used)).toEqual(['bash', 'read'])
  })

  it('only ensures the table once across multiple calls in the same process', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)

    await logAgentRun(runData())
    await logAgentRun(runData())

    // 1 table-ensure call + 2 row-insert calls = 3 total (not 4)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('still attempts the row write even if the table-ensure call throws', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('ensure failed'))
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)

    await expect(logAgentRun(runData())).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('logs a warning (not a throw) when the row insert responds with a non-ok status', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)

    await logAgentRun(runData())

    expect(console.warn).toHaveBeenCalledWith('[AgentRuns] ZeroDB responded 500')
  })

  it('catches a network failure on the row write and never throws', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockRejectedValueOnce(new Error('ECONNRESET'))

    await expect(logAgentRun(runData())).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[AgentRuns] ZeroDB write failed')
    )
  })

  it('truncates an overly long error message to 2000 characters and defaults to null when absent', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)

    const longError = 'x'.repeat(3000)
    await logAgentRun(runData({ error: longError }))
    const [, initWithError] = vi.mocked(fetch).mock.calls[1]
    const bodyWithError = JSON.parse((initWithError as RequestInit).body as string)
    expect(bodyWithError.row_data.error).toHaveLength(2000)

    __resetTableEnsuredForTests()
    vi.clearAllMocks()
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)

    await logAgentRun(runData())
    const [, initNoError] = vi.mocked(fetch).mock.calls[1]
    const bodyNoError = JSON.parse((initNoError as RequestInit).body as string)
    expect(bodyNoError.row_data.error).toBeNull()
  })

  it('defaults totalCostUsd to 0 when omitted, and passes it through when provided', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)

    await logAgentRun(
      runData({ tokenUsage: { inputTokens: 1, outputTokens: 2, totalCostUsd: 0.05 } })
    )
    const [, init] = vi.mocked(fetch).mock.calls[1]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.row_data.total_cost_usd).toBe(0.05)
  })

  it('uses the ZERODB_PROJECT_ID/AINATIVE_API_URL env overrides when set', async () => {
    process.env.ZERODB_PROJECT_ID = 'custom-project'
    process.env.AINATIVE_API_URL = 'https://custom.example.com'
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)

    await logAgentRun(runData())

    const [tableUrl] = vi.mocked(fetch).mock.calls[0]
    expect(String(tableUrl)).toContain('https://custom.example.com/api/v1/projects/custom-project/')
  })

  it('logs a success message distinguishing fallback vs primary runs', async () => {
    vi.mocked(getAinativeApiKey).mockReturnValue('api-key-1')
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)

    await logAgentRun(runData({ fallback: true }))

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('fallback'))
  })
})
