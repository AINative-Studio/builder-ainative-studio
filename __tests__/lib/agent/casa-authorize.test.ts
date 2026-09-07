/**
 * Tests for lib/agent/casa-authorize.ts
 *
 * Strategy:
 * - Mock global fetch to avoid real HTTP calls.
 * - Verify: inert when AINATIVE_INTERNAL_API_KEY is unset, correct endpoint
 *   + payload shape + header when set, never throws on a non-ok response or
 *   a rejected fetch (fire-and-forget contract).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authorizeToolCall } from '@/lib/agent/casa-authorize'

describe('authorizeToolCall', () => {
  const originalEnv = process.env
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    process.env = { ...originalEnv }
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    originalFetch = global.fetch
  })

  afterEach(() => {
    process.env = originalEnv
    consoleWarnSpy.mockRestore()
    global.fetch = originalFetch
  })

  it('stays inert and never calls fetch when AINATIVE_INTERNAL_API_KEY is not configured', () => {
    delete process.env.AINATIVE_INTERNAL_API_KEY
    global.fetch = vi.fn()

    authorizeToolCall({ toolName: 'Edit' })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POSTs to the internal casa authorize endpoint with the correct shape when configured', () => {
    process.env.AINATIVE_INTERNAL_API_KEY = 'test-internal-key'
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    global.fetch = mockFetch as unknown as typeof fetch

    authorizeToolCall({
      toolName: 'Edit',
      task: 'Add a counter component',
      toolParams: { file_path: '/app/counter.jsx' },
      agentId: 'chat-abc123',
      conversationId: 'chat-abc123',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    // AINATIVE_API_BASE_URL is a module-level const (lib/constants.ts),
    // evaluated once at import time -- not re-readable from process.env here.
    expect(url).toBe('https://api.ainative.studio/api/v1/internal/casa/authorize')
    expect(options.method).toBe('POST')
    expect(options.headers['X-Internal-API-Key']).toBe('test-internal-key')
    const body = JSON.parse(options.body)
    expect(body).toEqual({
      tool_name: 'Edit',
      task: 'Add a counter component',
      tool_params: { file_path: '/app/counter.jsx' },
      agent_id: 'chat-abc123',
      conversation_id: 'chat-abc123',
      source_service: 'builder-ainative-studio',
    })
  })

  it('never throws when the endpoint returns a non-ok response', async () => {
    process.env.AINATIVE_INTERNAL_API_KEY = 'test-internal-key'
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch

    expect(() => authorizeToolCall({ toolName: 'Bash' })).not.toThrow()
    // Let the fire-and-forget promise chain settle before asserting the warn.
    await new Promise((r) => setTimeout(r, 0))
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'))
  })

  it('never throws when fetch itself rejects', async () => {
    process.env.AINATIVE_INTERNAL_API_KEY = 'test-internal-key'
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

    expect(() => authorizeToolCall({ toolName: 'Bash' })).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('authorize call error'),
      'network down',
    )
  })

  it('omits optional fields cleanly when only toolName is given', () => {
    process.env.AINATIVE_INTERNAL_API_KEY = 'test-internal-key'
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    global.fetch = mockFetch as unknown as typeof fetch

    authorizeToolCall({ toolName: 'Read' })

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.tool_name).toBe('Read')
    expect(body.task).toBeUndefined()
    expect(body.source_service).toBe('builder-ainative-studio')
  })
})
