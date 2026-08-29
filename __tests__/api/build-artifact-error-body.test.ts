/**
 * POST /api/build/artifact — AINative error-body capture (Ref #360).
 *
 * The OpenAI SDK only surfaces `error.error` (the OpenAI-shaped `{error:
 * {message}}` envelope) on a thrown APIError, and DISCARDS the raw response
 * body once it has read it. Core's actual error contract is
 * `{detail, error_code, next_action}` — no top-level `error` key — so every
 * core failure surfaced through the SDK as a useless "{status} status code
 * (no body)" message, even though core sent a real, informative body every
 * time. This made #360 ("why does the AINative fallback fail with no body")
 * undiagnosable from application logs alone.
 *
 * Unlike build-artifact-route.test.ts (which mocks the whole `openai` module
 * to test retry/repair-pass/Sentry logic), THIS file uses the REAL `openai`
 * package and mocks global `fetch` instead — so it actually exercises
 * `makeCapturingFetch` and proves the raw body is captured and logged.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  captureMessage: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/lib/build/claude-completion', () => ({
  getClaudeCompletion: h.getClaudeCompletion,
}))

vi.mock('@sentry/nextjs', () => ({
  captureMessage: h.captureMessage,
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))

import { POST } from '@/app/api/build/artifact/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

const VALID_BODY = { view: 'landing', idea: 'A knowledge search tool for support teams' }

/** Core's REAL error shape — {detail, error_code, next_action}, no `error` key. */
function coreErrorResponse(status: number, detail: string, errorCode: string) {
  return new Response(JSON.stringify({ detail, error_code: errorCode, next_action: 'retry' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  h.getClaudeCompletion.mockReset().mockReturnValue(null) // force straight to AINative fallback
  h.captureMessage.mockReset()
  h.auth.mockReset().mockResolvedValue(null)
})

describe('POST /api/build/artifact — AINative error body capture', () => {
  it('logs core\'s real detail/error_code to Sentry instead of "status code (no body)"', async () => {
    // A FRESH Response per call — a real server sends a new response body each
    // time; a single Response object's body stream can only ever be read once
    // (even via .clone(), once consumption has started), so reusing one across
    // 4 retry attempts here would be a test artifact, not real behavior.
    const fetchMock = vi.fn().mockImplementation(async () =>
      coreErrorResponse(429, 'Too many requests, please wait before trying again.', 'RATE_LIMITED'),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(503)
    expect(fetchMock).toHaveBeenCalled() // real openai client actually called out

    expect(h.captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = h.captureMessage.mock.calls[0]
    const attempts: string[] = opts.extra.attempts
    // The whole point of the fix: the real body text must appear in the log,
    // not the SDK's generic fallback message.
    expect(attempts.join(' ')).toMatch(/Too many requests, please wait before trying again/)
    expect(attempts.join(' ')).not.toMatch(/no body/i)

    vi.unstubAllGlobals()
  })

  it('still falls back to the SDK message when the body is not readable/JSON (defensive path)', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response('not json at all {{{', { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(503)
    expect(h.captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = h.captureMessage.mock.calls[0]
    // Raw non-JSON text is still captured verbatim (it's just text, no parsing needed) —
    // the capture only needs the response to have a body, not valid JSON.
    expect(opts.extra.attempts.join(' ')).toMatch(/not json at all/)

    vi.unstubAllGlobals()
  })

  it('does not leak one attempt\'s captured error body into the next attempt\'s log', async () => {
    // A hard 5xx does NOT trigger a same-provider repair pass (only an
    // unparseable-but-200 response does) — it breaks straight to the NEXT
    // model. So call 1 = ainativeModel pass 1, call 2 = AINATIVE_FALLBACK
    // (qwen-coder-32b) pass 1. Each must show its OWN distinct body in the log,
    // proving the per-call box isn't shared/stale module state (the exact
    // race a single shared "lastError" variable would risk under concurrent
    // requests).
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(coreErrorResponse(500, 'FIRST_UNIQUE_FAILURE_MARKER', 'E1'))
      .mockResolvedValueOnce(coreErrorResponse(500, 'SECOND_UNIQUE_FAILURE_MARKER', 'E2'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [, opts] = h.captureMessage.mock.calls[0]
    const attempts: string[] = opts.extra.attempts
    expect(attempts).toHaveLength(2)
    const firstLine = attempts.find((a) => a.includes('FIRST_UNIQUE_FAILURE_MARKER'))
    const secondLine = attempts.find((a) => a.includes('SECOND_UNIQUE_FAILURE_MARKER'))
    expect(firstLine).toBeDefined()
    expect(secondLine).toBeDefined()
    // Neither line should contain the OTHER attempt's marker.
    expect(firstLine).not.toMatch(/SECOND_UNIQUE_FAILURE_MARKER/)
    expect(secondLine).not.toMatch(/FIRST_UNIQUE_FAILURE_MARKER/)

    vi.unstubAllGlobals()
  })
})
