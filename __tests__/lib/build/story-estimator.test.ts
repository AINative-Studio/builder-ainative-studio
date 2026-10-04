import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FIBONACCI_POINTS,
  isFibonacciPoint,
  parseEstimateResponse,
  estimateStoryPoints,
  type StoryEstimate,
} from '@/lib/build/story-estimator'

/**
 * #902 — Fibonacci story-point estimation for backlog tasks.
 *
 * `.ainative/RULES.MD` §2 requires every story to carry a Fibonacci estimate
 * (0,1,2,3,5,8) with rationale. This module provides the small, fast LLM call
 * `createTask()` uses to size a task, plus the pure parsing/validation logic
 * that call's response goes through. Mirrors task-store.test.ts's split: pure
 * core tested directly, I/O tested by mocking global.fetch (same strategy as
 * createTask/listTasks/updateTask there, and committee-runner's runViaAinative
 * adapter this module's live call is modeled on).
 */

// ---------- FIBONACCI_POINTS / isFibonacciPoint ----------
describe('FIBONACCI_POINTS + isFibonacciPoint (#902)', () => {
  it('is exactly the six RULES.MD §2 values', () => {
    expect([...FIBONACCI_POINTS]).toEqual([0, 1, 2, 3, 5, 8])
  })
  it('accepts each canonical value', () => {
    for (const p of FIBONACCI_POINTS) expect(isFibonacciPoint(p)).toBe(true)
  })
  it('rejects non-Fibonacci numbers, strings, and non-numbers', () => {
    expect(isFibonacciPoint(4)).toBe(false)
    expect(isFibonacciPoint(13)).toBe(false)
    expect(isFibonacciPoint(-1)).toBe(false)
    expect(isFibonacciPoint('3')).toBe(false)
    expect(isFibonacciPoint(null)).toBe(false)
    expect(isFibonacciPoint(undefined)).toBe(false)
    expect(isFibonacciPoint(NaN)).toBe(false)
  })
})

// ---------- parseEstimateResponse (pure) ----------
describe('parseEstimateResponse (#902)', () => {
  it('parses a well-formed POINTS/RATIONALE response', () => {
    const r = parseEstimateResponse('POINTS: 3\nRATIONALE: Touches two files and a new API route.')
    expect(r).toEqual({ storyPoints: 3, estimateRationale: 'Touches two files and a new API route.' })
  })
  it('parses points embedded in prose with a labeled rationale', () => {
    const r = parseEstimateResponse('Points: 1\nRationale: Trivial one-line copy fix.')
    expect(r).toEqual({ storyPoints: 1, estimateRationale: 'Trivial one-line copy fix.' })
  })
  it('snaps a non-Fibonacci number the model emitted to the nearest Fibonacci value (ties round up)', () => {
    // 4 is equidistant from 3 and 5 — ties round up, matching the "when in
    // doubt, don't underestimate" spirit of story-point sizing.
    expect(parseEstimateResponse('POINTS: 4\nRATIONALE: Medium-ish.')?.storyPoints).toBe(5)
    expect(parseEstimateResponse('POINTS: 13\nRATIONALE: Huge.')?.storyPoints).toBe(8)
    expect(parseEstimateResponse('POINTS: 6\nRATIONALE: Between 5 and 8.')?.storyPoints).toBe(5)
    expect(parseEstimateResponse('POINTS: 7\nRATIONALE: Rounds up to 8.')?.storyPoints).toBe(8)
  })
  it('clamps a negative or absurd number into range', () => {
    expect(parseEstimateResponse('POINTS: -5\nRATIONALE: n/a')?.storyPoints).toBe(0)
    expect(parseEstimateResponse('POINTS: 999\nRATIONALE: n/a')?.storyPoints).toBe(8)
  })
  it('returns null for unparseable text (no number found)', () => {
    expect(parseEstimateResponse('I cannot estimate this task.')).toBeNull()
    expect(parseEstimateResponse('')).toBeNull()
    expect(parseEstimateResponse(null as any)).toBeNull()
  })
  it('defaults rationale to a generic string when missing but points are present', () => {
    const r = parseEstimateResponse('POINTS: 2')
    expect(r?.storyPoints).toBe(2)
    expect(typeof r?.estimateRationale).toBe('string')
    expect(r?.estimateRationale.length).toBeGreaterThan(0)
  })
  it('truncates an excessively long rationale', () => {
    const long = 'x'.repeat(1000)
    const r = parseEstimateResponse(`POINTS: 5\nRATIONALE: ${long}`)
    expect(r?.estimateRationale.length).toBeLessThanOrEqual(300)
  })
})

// ---------- estimateStoryPoints (I/O, best-effort) ----------
function mockFetch(impl: (url: string, init?: any) => { ok: boolean; status?: number; json?: () => any }) {
  const fn = vi.fn(async (url: string, init?: any) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ? r.json() : {}),
      text: async () => '',
    } as any
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('estimateStoryPoints (#902)', () => {
  beforeEach(() => {
    process.env.ZERODB_API_KEY = 'k'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a trivial task (typo-level) estimates to 0 or 1', async () => {
    mockFetch(() => ({
      ok: true,
      json: () => ({
        choices: [{ message: { content: 'POINTS: 0\nRATIONALE: Single-character typo fix in copy.' } }],
      }),
    }))
    const r = await estimateStoryPoints('Fix typo in footer', '')
    expect(r).not.toBeNull()
    expect([0, 1]).toContain(r?.storyPoints)
    expect(r?.estimateRationale).toContain('typo')
  })

  it('a complex multi-part task estimates to 5 or 8', async () => {
    mockFetch(() => ({
      ok: true,
      json: () => ({
        choices: [
          {
            message: {
              content:
                'POINTS: 8\nRATIONALE: Rewrites auth, migrates the schema, and touches six files across front and back end.',
            },
          },
        ],
      }),
    }))
    const r = await estimateStoryPoints(
      'Rewrite the entire authentication system, migrate the database schema, and add SSO across six services',
      'Multi-part: new auth provider, data migration, SSO, admin UI, audit log, and rollback plan.',
    )
    expect(r).not.toBeNull()
    expect([5, 8]).toContain(r?.storyPoints)
  })

  it('never throws and returns null when the estimation call fails (graceful degrade)', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const r = await estimateStoryPoints('Anything', '')
    expect(r).toBeNull()
  })

  it('never throws and returns null when fetch itself rejects (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const r = await estimateStoryPoints('Anything', '')
    expect(r).toBeNull()
  })

  it('returns null when the model response is unparseable', async () => {
    mockFetch(() => ({
      ok: true,
      json: () => ({ choices: [{ message: { content: 'I refuse to estimate.' } }] }),
    }))
    const r = await estimateStoryPoints('Anything', '')
    expect(r).toBeNull()
  })

  it('returns null (never hangs) when the call exceeds its timeout budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: any) => {
        // Simulate a hung request: never resolve, but respect AbortSignal so the
        // real implementation's timeout can actually reject it.
        return new Promise((_resolve, reject) => {
          const signal: AbortSignal | undefined = init?.signal
          if (signal) {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          }
        })
      }),
    )
    const r = await estimateStoryPoints('Anything', '', { timeoutMs: 20 })
    expect(r).toBeNull()
  })

  it('returns null without calling fetch when no API key is configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.AINATIVE_API_KEY
    delete process.env.API_Key
    const fn = mockFetch(() => ({ ok: true, json: () => ({}) }))
    const r = await estimateStoryPoints('Anything', '')
    expect(r).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('sends a Haiku-tier (fast/cheap) model, not a frontier model', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      json: () => ({ choices: [{ message: { content: 'POINTS: 1\nRATIONALE: Small.' } }] }),
    }))
    await estimateStoryPoints('Anything', '')
    const body = JSON.parse(fn.mock.calls[0][1].body)
    expect(body.model).toMatch(/haiku/i)
  })

  it('returns null for a blank title without calling fetch', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({}) }))
    const r = await estimateStoryPoints('   ', '')
    expect(r).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
})
