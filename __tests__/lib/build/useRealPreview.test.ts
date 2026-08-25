// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRealPreview } from '@/lib/build/useRealPreview'

/**
 * Tests for lib/build/useRealPreview.ts — SSE-based real preview hook.
 *
 * Environment: jsdom (required for hooks/useEffect).
 * Strategy: mock global fetch to return a simulated ReadableStream with
 * SSE event payloads. The content-verify guard (previewHasContent) is also
 * mocked as the second fetch call.
 *
 * All I/O is mocked — zero API budget.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a Response whose .body is a ReadableStream emitting the given SSE chunks. */
function sseResponse(chunks: string[]): Response {
  let pos = 0
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    pull(controller) {
      if (pos < chunks.length) {
        controller.enqueue(encoder.encode(chunks[pos++]))
      } else {
        controller.close()
      }
    },
  })
  return { ok: true, body: stream } as unknown as Response
}

/** Produce a well-formed SSE line for a given payload object. */
function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

// ── disabled state ───────────────────────────────────────────────────────────

describe('useRealPreview — disabled', () => {
  it('does not fetch and stays idle when enabled=false', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useRealPreview('my idea', false))
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.previewUrl).toBeNull()
    expect(result.current.chatId).toBeNull()
  })

  it('does not fetch when idea is empty', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useRealPreview('', true))
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })
})

// ── happy path ───────────────────────────────────────────────────────────────

describe('useRealPreview — happy path (init + ready)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('transitions idle → generating → ready and exposes previewUrl', async () => {
    const fetchMock = vi.fn()
      // Call 1: chat-ws SSE stream
      .mockResolvedValueOnce(sseResponse([
        sseEvent({ type: 'init', chatId: 'chat-abc' }),
        sseEvent({ type: 'refresh' }),
        sseEvent({ type: 'files' }),
      ]))
      // Call 2: previewHasContent verification
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html>lots of real content'.padEnd(900, 'x') + '</html>',
      } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRealPreview('Build a todo app', true))

    await waitFor(() => expect(result.current.status).toBe('ready'), { timeout: 3000 })
    expect(result.current.chatId).toBe('chat-abc')
    expect(result.current.previewUrl).toContain('/api/preview/chat-abc')
    // Verify both fetch calls happened: POST to chat-ws + GET to /api/preview/chat-abc
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[0][0] as string)).toContain('chat-ws')
    expect((fetchMock.mock.calls[1][0] as string)).toContain('chat-abc')
  })

  it('previewUrl includes a refreshKey query param', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        sseEvent({ type: 'init', chatId: 'chat-xyz' }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'x'.padEnd(900),
      } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRealPreview('Music player', true))
    await waitFor(() => expect(result.current.status).toBe('ready'), { timeout: 3000 })
    expect(result.current.previewUrl).toMatch(/\?r=\d+/)
  })
})

// ── error paths ──────────────────────────────────────────────────────────────

describe('useRealPreview — error paths', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sets status=error on network failure (fetch rejects)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { result } = renderHook(() => useRealPreview('An idea', true))
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3000 })
    expect(result.current.previewUrl).toBeNull()
  })

  it('sets status=error when response body is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: null } as unknown as Response))
    const { result } = renderHook(() => useRealPreview('An idea', true))
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3000 })
  })

  it('sets status=error when SSE stream contains an error event', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(sseResponse([
        sseEvent({ type: 'init', chatId: 'chat-err' }),
        sseEvent({ type: 'error', message: 'codegen failed' }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html>' + 'x'.repeat(200) + '</html>',
      } as unknown as Response),
    )
    const { result } = renderHook(() => useRealPreview('Broken idea', true))
    // The error event sets status but stream continues; at stream end, previewHasContent
    // is checked. Here preview content is too short (< 800), so final state = error.
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3000 })
  })

  it('sets status=error when no chatId is received (no init event)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sseResponse([
      sseEvent({ type: 'refresh' }), // no init
    ])))
    const { result } = renderHook(() => useRealPreview('Idea', true))
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3000 })
    expect(result.current.chatId).toBeNull()
    expect(result.current.previewUrl).toBeNull()
  })

  it('sets status=error when preview content is "No renderable code found"', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(sseResponse([
        sseEvent({ type: 'init', chatId: 'chat-empty' }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html>No renderable code found</html>',
      } as unknown as Response),
    )
    const { result } = renderHook(() => useRealPreview('Idea', true))
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3000 })
  })

  it('sets status=error when preview body is too short (< 800 chars)', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(sseResponse([
        sseEvent({ type: 'init', chatId: 'chat-short' }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html>tiny</html>',
      } as unknown as Response),
    )
    const { result } = renderHook(() => useRealPreview('Idea', true))
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3000 })
  })

  it('sets status=error when preview fetch returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(sseResponse([
        sseEvent({ type: 'init', chatId: 'chat-404' }),
      ]))
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      } as unknown as Response),
    )
    const { result } = renderHook(() => useRealPreview('Idea', true))
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3000 })
  })
})

// ── SSE event parsing ────────────────────────────────────────────────────────

describe('useRealPreview — SSE event parsing', () => {
  afterEach(() => vi.restoreAllMocks())

  it('ignores malformed JSON in data lines without crashing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(sseResponse([
        'data: {bad json}\n\n',
        sseEvent({ type: 'init', chatId: 'chat-recover' }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'x'.padEnd(900),
      } as unknown as Response),
    )
    const { result } = renderHook(() => useRealPreview('Idea', true))
    await waitFor(() => expect(result.current.status).toBe('ready'), { timeout: 3000 })
    expect(result.current.chatId).toBe('chat-recover')
  })

  it('ignores SSE lines without a data: prefix', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(sseResponse([
        'event: ping\n\n', // no data: line
        sseEvent({ type: 'init', chatId: 'chat-noping' }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'x'.padEnd(900),
      } as unknown as Response),
    )
    const { result } = renderHook(() => useRealPreview('Idea', true))
    await waitFor(() => expect(result.current.status).toBe('ready'), { timeout: 3000 })
  })

  it('does not re-trigger on re-render with same idea and enabled=true', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        sseEvent({ type: 'init', chatId: 'chat-once' }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'x'.padEnd(900),
      } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ idea, enabled }: { idea: string; enabled: boolean }) => useRealPreview(idea, enabled),
      { initialProps: { idea: 'An idea', enabled: true } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'), { timeout: 3000 })

    rerender({ idea: 'An idea', enabled: true })
    await act(async () => {})
    // `started` ref prevents a second fetch
    expect(fetchMock).toHaveBeenCalledTimes(2) // still just the original 2
  })
})
