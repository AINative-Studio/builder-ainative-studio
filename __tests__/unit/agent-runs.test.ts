/**
 * Tests for lib/services/agent-runs.service.ts
 *
 * Strategy:
 * - Mock global fetch to avoid real HTTP calls.
 * - Exercise all branches: missing API key, successful log, non-ok response,
 *   fetch timeout (abort), fetch throwing synchronously/asynchronously.
 * - Verify the correct ZeroDB endpoint and payload shape are used.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logAgentRun, type AgentRunData } from '../../lib/services/agent-runs.service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_DATA: AgentRunData = {
  chatId: 'chat-abc123',
  userId: 'user-xyz',
  model: 'claude-sonnet-4-5',
  turns: 3,
  toolsUsed: ['Read', 'Write', 'Bash'],
  buildPassed: true,
  durationMs: 4200,
  tokenUsage: {
    inputTokens: 1000,
    outputTokens: 500,
    totalCostUsd: 0.015,
  },
  fallback: false,
}

/** Creates a resolved fetch mock that returns the given status. */
function mockFetchOk(status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
  } as Response)
}

/** Creates a fetch mock that rejects with a DOMException-like abort error. */
function mockFetchAborted(): ReturnType<typeof vi.fn> {
  const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
  return vi.fn().mockRejectedValue(err)
}

/** Creates a fetch mock that rejects with a generic network error. */
function mockFetchNetworkError(message = 'fetch failed'): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(new Error(message))
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('logAgentRun', () => {
  const originalEnv = process.env
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ZERODB_API_KEY: 'test-api-key',
      ZERODB_PROJECT_ID: 'test-project-id',
      AINATIVE_API_URL: 'https://test.ainative.studio',
    }
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    originalFetch = global.fetch
  })

  afterEach(() => {
    process.env = originalEnv
    consoleWarnSpy.mockRestore()
    consoleLogSpy.mockRestore()
    global.fetch = originalFetch
    vi.clearAllTimers()
  })

  // -------------------------------------------------------------------------
  // Missing API key
  // -------------------------------------------------------------------------

  describe('when no API key is configured', () => {
    it('returns early and warns when ZERODB_API_KEY and AINATIVE_API_KEY are both missing', async () => {
      delete process.env.ZERODB_API_KEY
      delete process.env.AINATIVE_API_KEY
      global.fetch = vi.fn()

      await logAgentRun(BASE_DATA)

      expect(global.fetch).not.toHaveBeenCalled()
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('No API key'))
    })

    it('uses AINATIVE_API_KEY as fallback when ZERODB_API_KEY is absent', async () => {
      delete process.env.ZERODB_API_KEY
      process.env.AINATIVE_API_KEY = 'ainative-key-fallback'
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      expect(global.fetch).toHaveBeenCalledOnce()
      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(options.headers['x-api-key']).toBe('ainative-key-fallback')
    })

    it('prefers ZERODB_API_KEY over AINATIVE_API_KEY', async () => {
      process.env.ZERODB_API_KEY = 'zerodb-key'
      process.env.AINATIVE_API_KEY = 'ainative-key'
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(options.headers['x-api-key']).toBe('zerodb-key')
    })
  })

  // -------------------------------------------------------------------------
  // Successful log
  // -------------------------------------------------------------------------

  describe('successful log', () => {
    it('calls the correct ZeroDB endpoint', async () => {
      process.env.AINATIVE_API_URL = 'https://custom.ainative.studio'
      process.env.ZERODB_PROJECT_ID = 'proj-999'
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toContain('proj-999')
      expect(url).toContain('agent_runs')
      expect(url).toContain('custom.ainative.studio')
    })

    it('sends POST with JSON content-type and correct row_data shape', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(options.body)
      expect(body.row_data).toMatchObject({
        chat_id: BASE_DATA.chatId,
        user_id: BASE_DATA.userId,
        model: BASE_DATA.model,
        turns: BASE_DATA.turns,
        build_passed: BASE_DATA.buildPassed,
        duration_ms: BASE_DATA.durationMs,
        input_tokens: BASE_DATA.tokenUsage.inputTokens,
        output_tokens: BASE_DATA.tokenUsage.outputTokens,
        total_cost_usd: BASE_DATA.tokenUsage.totalCostUsd,
        fallback: BASE_DATA.fallback,
      })
    })

    it('serialises toolsUsed as a JSON string', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun({ ...BASE_DATA, toolsUsed: ['Read', 'Write'] })

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.row_data.tools_used).toBe('["Read","Write"]')
    })

    it('sets error to null when no error field is provided', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun({ ...BASE_DATA, error: undefined })

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.row_data.error).toBeNull()
    })

    it('truncates error strings longer than 2000 characters', async () => {
      global.fetch = mockFetchOk(200)
      const longError = 'x'.repeat(3000)

      await logAgentRun({ ...BASE_DATA, error: longError })

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.row_data.error.length).toBe(2000)
    })

    it('preserves short error strings exactly', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun({ ...BASE_DATA, error: 'short error' })

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.row_data.error).toBe('short error')
    })

    it('defaults total_cost_usd to 0 when tokenUsage.totalCostUsd is undefined', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun({
        ...BASE_DATA,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      })

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.row_data.total_cost_usd).toBe(0)
    })

    it('logs success message to console.log on 200', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(BASE_DATA.chatId),
      )
    })

    it('logs "primary" in success message when fallback=false', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun({ ...BASE_DATA, fallback: false })

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('primary'),
      )
    })

    it('logs "fallback" in success message when fallback=true', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun({ ...BASE_DATA, fallback: true })

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('fallback'),
      )
    })

    it('includes an AbortController signal in the fetch call', async () => {
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(options.signal).toBeDefined()
    })

    it('uses default project ID when ZERODB_PROJECT_ID is not set', async () => {
      delete process.env.ZERODB_PROJECT_ID
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      // The default project ID from source
      expect(url).toContain('5dfbc60c-7463-4e21-ac68-9bbe536f9adf')
    })

    it('uses default base URL when AINATIVE_API_URL and ZERODB_BASE_URL are absent', async () => {
      delete process.env.AINATIVE_API_URL
      delete process.env.ZERODB_BASE_URL
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toContain('api.ainative.studio')
    })

    it('uses ZERODB_BASE_URL when AINATIVE_API_URL is absent', async () => {
      delete process.env.AINATIVE_API_URL
      process.env.ZERODB_BASE_URL = 'https://zerodb.ainative.studio'
      global.fetch = mockFetchOk(200)

      await logAgentRun(BASE_DATA)

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toContain('zerodb.ainative.studio')
    })

    it('includes a created_at ISO timestamp in the row data', async () => {
      global.fetch = mockFetchOk(200)

      const before = new Date().toISOString()
      await logAgentRun(BASE_DATA)
      const after = new Date().toISOString()

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.row_data.created_at >= before).toBe(true)
      expect(body.row_data.created_at <= after).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Non-ok HTTP response
  // -------------------------------------------------------------------------

  describe('non-ok HTTP response', () => {
    it('warns with the HTTP status code when ZeroDB returns 500', async () => {
      global.fetch = mockFetchOk(500)

      await logAgentRun(BASE_DATA)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('500'),
      )
    })

    it('warns when ZeroDB returns 401', async () => {
      global.fetch = mockFetchOk(401)

      await logAgentRun(BASE_DATA)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('401'),
      )
    })

    it('does not log success when response is not ok', async () => {
      global.fetch = mockFetchOk(503)

      await logAgentRun(BASE_DATA)

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Fetch failures / network errors
  // -------------------------------------------------------------------------

  describe('fetch failures', () => {
    it('catches AbortError from timeout and warns', async () => {
      global.fetch = mockFetchAborted()

      await logAgentRun(BASE_DATA)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ZeroDB write failed'),
      )
    })

    it('catches generic network error and warns with message', async () => {
      global.fetch = mockFetchNetworkError('ECONNREFUSED')

      await logAgentRun(BASE_DATA)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ZeroDB write failed'),
      )
    })

    it('catches error with only a name property (no message)', async () => {
      const weirdError = { name: 'WeirdNetworkThing' }
      global.fetch = vi.fn().mockRejectedValue(weirdError)

      await logAgentRun(BASE_DATA)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WeirdNetworkThing'),
      )
    })

    it('handles error with neither name nor message gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue({})

      await logAgentRun(BASE_DATA)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ZeroDB write failed'),
      )
    })

    it('does not throw — the promise always resolves', async () => {
      global.fetch = mockFetchNetworkError('permanent failure')

      await expect(logAgentRun(BASE_DATA)).resolves.toBeUndefined()
    })
  })
})
