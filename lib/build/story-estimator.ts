/**
 * Fibonacci story-point estimation for backlog tasks (#902 · epic #900).
 *
 * `.ainative/RULES.MD` §2 requires every story AINative's own engineering
 * tracks to carry a Fibonacci estimate (0,1,2,3,5,8) with rationale, and
 * stories sized 3/5/8 to be split smaller first. `lib/build/task-store.ts`'s
 * `BuildTask`/`createTask()` had no sizing field at all — every task (chat-
 * originated, swarm-originated, or nightly-seeded) was an unsized blob of
 * prose (see docs/audits/AINATIVE_PROCESS_PARITY_GAP_2026-10-04.md §3c).
 *
 * This module is the small, fast LLM call `createTask()` uses to size a task,
 * modeled on the one other live "route a quick judgment through the AINative
 * OpenAI-compatible chat-completions proxy" call already in this codebase —
 * `lib/build/committee-runner.ts`'s `runViaAinative` (same base URL env var,
 * same Bearer-token resolution via `getAinativeApiKey()`, same
 * `AbortSignal.timeout` bounding). That call fans out to several models by
 * name for independent review; this one targets a single Haiku-tier model
 * (`AINATIVE_MODEL_BY_TIER.hobbyist` in lib/build/tier-models.ts is the same
 * id) because sizing a task is a quick classification judgment, not a task
 * that benefits from a frontier model's depth.
 *
 * SPLIT (same shape as task-store.ts and committee-gate.ts): the response
 * parsing/validation (`parseEstimateResponse`, `isFibonacciPoint`) is PURE and
 * unit-tested directly; `estimateStoryPoints` is the one I/O seam, calling the
 * real proxy.
 *
 * BEST-EFFORT, NEVER BLOCKS (the issue's hard requirement, matching this
 * codebase's established pattern — see e.g. `lib/build/comms-policy.ts`'s
 * `runNightlyCommsOutreach`, which wraps its entire body in try/catch so a
 * comms hiccup can never break the nightly loop, and `resolveApp`'s callers
 * treating a resolution failure as "not found" rather than a thrown error).
 * `estimateStoryPoints` NEVER throws: a missing API key, a non-OK response, a
 * network error, a timeout, or an unparseable model reply all return `null`
 * rather than rejecting — so `createTask()` can treat a null estimate exactly
 * like an old pre-#902 row (graceful degradation to unestimated).
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

/** The Fibonacci sizes `.ainative/RULES.MD` §2 mandates. Anything 3/5/8 is a signal to split further upstream — this module just reports the size. */
export const FIBONACCI_POINTS = [0, 1, 2, 3, 5, 8] as const

export type FibonacciPoint = (typeof FIBONACCI_POINTS)[number]

/** A validated estimate: one Fibonacci value plus a one-line rationale. */
export interface StoryEstimate {
  storyPoints: FibonacciPoint
  estimateRationale: string
}

/** AINative OpenAI-compatible base URL — same env var committee-runner.ts uses. */
const AINATIVE_BASE = process.env.AINATIVE_BASE_URL || 'https://api.ainative.studio/api/v1'

/** Haiku-tier model id — same id as AINATIVE_MODEL_BY_TIER.hobbyist in tier-models.ts; a quick-judgment call does not need a frontier model. */
const ESTIMATOR_MODEL = process.env.STORY_ESTIMATOR_MODEL || 'claude-haiku-4.5'

/** Hard wall-clock budget for the estimation call — a slow/hung provider must never delay task creation. */
const DEFAULT_TIMEOUT_MS = 8_000

/** Max rationale length persisted (keeps the BuildTask row small, mirrors task-store.ts's own field truncation conventions). */
const MAX_RATIONALE_LEN = 300

/** Is `value` one of the six canonical Fibonacci points? Pure. */
export function isFibonacciPoint(value: unknown): value is FibonacciPoint {
  return typeof value === 'number' && Number.isFinite(value) && (FIBONACCI_POINTS as readonly number[]).includes(value)
}

/** Snap an arbitrary finite number to the nearest Fibonacci point (ties round up). Pure. */
function snapToFibonacci(n: number): FibonacciPoint {
  let best: FibonacciPoint = FIBONACCI_POINTS[0]
  let bestDist = Infinity
  for (const p of FIBONACCI_POINTS) {
    const dist = Math.abs(p - n)
    if (dist < bestDist || (dist === bestDist && p > best)) {
      best = p
      bestDist = dist
    }
  }
  return best
}

const SYSTEM_PROMPT = `You are a fast, terse estimation assistant for a software backlog. Given a task's title and optional detail, estimate its size using the Fibonacci scale: 0, 1, 2, 3, 5, 8.
 - 0: trivial (typo, copy tweak, config flip)
 - 1: tiny, single-file, well-understood
 - 2: small, a couple of files, low risk
 - 3: moderate, one clear feature slice
 - 5: large, multiple files/systems, real design decisions
 - 8: very large, touches many systems — should usually be split smaller
Respond in EXACTLY this format, nothing else:
POINTS: <one of 0, 1, 2, 3, 5, 8>
RATIONALE: <one short sentence explaining the size>`

/** Build the user-turn prompt from a task's title/detail. Pure. */
export function buildEstimatePrompt(title: string, detail?: string): string {
  const d = (detail || '').trim()
  return d ? `Title: ${title}\nDetail: ${d}` : `Title: ${title}`
}

/**
 * Parse a model's raw reply into a validated StoryEstimate. Accepts
 * "POINTS: n" / "Points: n" (case-insensitive) followed optionally by a
 * "RATIONALE:"/"Rationale:" line. A non-Fibonacci number is snapped to the
 * nearest valid value (clamped into [0, 8] first) rather than rejected — the
 * model's judgment about MAGNITUDE is still useful even when it emits a
 * number off the exact sequence. Returns null only when no usable number is
 * found at all. Pure, never throws.
 */
export function parseEstimateResponse(raw: string): StoryEstimate | null {
  const text = String(raw || '').trim()
  if (!text) return null

  const pointsMatch = text.match(/points?:\s*(-?\d+(?:\.\d+)?)/i)
  if (!pointsMatch) return null

  const n = parseFloat(pointsMatch[1])
  if (!Number.isFinite(n)) return null

  const clamped = Math.min(8, Math.max(0, n))
  const storyPoints = isFibonacciPoint(clamped) ? (clamped as FibonacciPoint) : snapToFibonacci(clamped)

  const rationaleMatch = text.match(/rationale:\s*([^\n]+)/i)
  const rationale = (rationaleMatch?.[1] || '').trim()
  const estimateRationale = (rationale || `Estimated ${storyPoints} story points.`).slice(0, MAX_RATIONALE_LEN)

  return { storyPoints, estimateRationale }
}

export interface EstimateOptions {
  /** Override the per-call timeout (ms). Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number
}

/**
 * Estimate a task's Fibonacci size via a small, fast LLM call. BEST-EFFORT:
 * never throws. Returns null (not an error) when:
 *  - the title is blank
 *  - no AINative API key is configured
 *  - the HTTP call fails, times out, or the response isn't OK
 *  - the model's reply can't be parsed into a usable estimate
 * Callers (createTask) treat null exactly like an unestimated pre-#902 row.
 */
export async function estimateStoryPoints(
  title: string,
  detail?: string,
  opts: EstimateOptions = {},
): Promise<StoryEstimate | null> {
  const t = String(title || '').trim()
  if (!t) return null

  const token = getAinativeApiKey()
  if (!token) return null

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const res = await fetch(`${AINATIVE_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ESTIMATOR_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildEstimatePrompt(t, detail) },
        ],
        temperature: 0.2,
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const content = String(data?.choices?.[0]?.message?.content || '')
    return parseEstimateResponse(content)
  } catch (e) {
    console.warn('[story-estimator] estimateStoryPoints failed (best-effort, degrading to unestimated):', (e as Error)?.name || e)
    return null
  }
}
