/**
 * Backlog task decomposition (#904, epic #900, depends on #902/#903).
 *
 * `.ainative/RULES.MD` §2 requires a story sized 3/5/8 to be split into
 * smaller stories before it is ever worked. #903 built the DETECTION half
 * (`lib/build/task-store.ts`'s `needsSplit()`, pure derivation from
 * `storyPoints`) and wired `task-resolution-loop.ts` to filter oversized
 * `todo` tasks OUT of `resolveTask()`'s due list — but nothing decomposed
 * them, so an oversized task just sat in the backlog forever. This module
 * is the other half: a real LLM call that decomposes an oversized task's
 * title/detail into 2-4 smaller sub-tasks, each independently estimated
 * (reusing #902's `estimateStoryPoints()` — never duplicating that logic),
 * persisted as new `todo` rows linked to the parent via `BuildTask.parentTaskId`.
 *
 * NEVER IMPLEMENTS DIRECTLY: the oversized parent task is marked `completed`
 * only once every child has been durably persisted, with an honest `output`
 * note listing the REAL child ids — never a fabricated reference. A splitter
 * failure at any step (the LLM call itself, an unparseable reply, a
 * persistence failure on any child) leaves the parent completely untouched
 * (still `todo`, still oversized) for a future nightly retry — matching this
 * codebase's established best-effort convention (see story-estimator.ts,
 * comms-policy.ts): a hiccup here must never silently lose a task, and must
 * never mark it done on anything less than a complete, real decomposition.
 *
 * BOUNDED RECURSION: a child that itself still estimates >3 points is
 * re-split, up to `MAX_SPLIT_DEPTH` additional levels. At the depth ceiling,
 * an oversized child is accepted as-is (persisted, not re-split) rather than
 * recursing forever — a small fixed bound, not a retry loop.
 *
 * SPLIT (same shape as story-estimator.ts / task-store.ts): prompt-building
 * and response-parsing are PURE and unit-tested directly; `splitTaskViaLLM`
 * is the one network seam (modeled on story-estimator.ts's own call to the
 * AINative OpenAI-compatible chat-completions proxy); `splitTask` is the I/O
 * orchestration (LLM call → per-child estimate+create → mark parent done).
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'
import { createTask, updateTask, needsSplit, type BuildTask } from '@/lib/build/task-store'
import { estimateStoryPoints } from '@/lib/build/story-estimator'

/** AINative OpenAI-compatible base URL — same env var + resolution as story-estimator.ts. */
const AINATIVE_BASE = process.env.AINATIVE_BASE_URL || 'https://api.ainative.studio/api/v1'

/** Same Haiku-tier model id story-estimator.ts uses — decomposition is a quick structural judgment, not a task needing a frontier model. */
const SPLITTER_MODEL = process.env.TASK_SPLITTER_MODEL || process.env.STORY_ESTIMATOR_MODEL || 'claude-haiku-4.5'

/** Hard wall-clock budget for the split call — a slow/hung provider must never hang the nightly loop. */
const DEFAULT_TIMEOUT_MS = 12_000

/** Hard cap on child tasks from a single split, even if the model emits more. Matches the issue's "2-4 sub-tasks" requirement. */
const MAX_SUBTASKS = 4
const MIN_SUBTASKS = 2

/**
 * Max ADDITIONAL re-split levels allowed for a child that still estimates
 * >3 points after its own sizing call (#904 acceptance criteria: "bounded to
 * avoid infinite recursion"). Kept small and fixed — not configurable per-call
 * — so a pathological task can never spin the nightly loop. At the ceiling,
 * an oversized child is accepted as-is rather than re-split again.
 */
export const MAX_SPLIT_DEPTH = 2

export interface SubTaskDraft {
  title: string
  detail?: string
}

export interface SplitTaskResult {
  ok: boolean
  /** Real, persisted child task ids — present only when ok. */
  childIds: string[]
  /** Honest failure reason when ok is false — never blank. */
  reason?: string
}

// ---------------------------------------------------------------------------
// PURE LOGIC (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a fast, terse backlog-decomposition assistant. Given an oversized software task's title and optional detail, break it into 2 to 4 smaller, independently-shippable sub-tasks. Each sub-task must be small enough to be implemented and tested on its own.
Respond with ONLY a list of blocks in EXACTLY this format, separated by a line containing just "---":
SUBTASK: <short title>
DETAIL: <one or two sentences of what this sub-task covers>
Emit between 2 and 4 such blocks. Nothing else — no preamble, no numbering, no closing remarks.`

/** Build the user-turn prompt from the oversized task's title/detail. Pure. */
export function buildSplitPrompt(title: string, detail?: string): string {
  const d = (detail || '').trim()
  return d ? `Title: ${title}\nDetail: ${d}` : `Title: ${title}`
}

/**
 * Parse a model's raw decomposition reply into SubTaskDrafts. Blocks are
 * separated by a line of only "---"; each block has a required "SUBTASK:"
 * title line and an optional "DETAIL:" line (case-insensitive labels, same
 * convention as story-estimator.ts's parseEstimateResponse). A block with a
 * blank title is dropped. Returns [] when nothing usable is found at all.
 * Caps at MAX_SUBTASKS even if the model emits more. Pure, never throws.
 *
 * Deliberately does NOT enforce the MIN_SUBTASKS "is this a real split"
 * business rule — that is a caller concern (splitTaskViaLLM), kept separate
 * so this function stays a straightforward, honest description of "what
 * blocks did the text contain," independently testable at any count.
 */
export function parseSplitResponse(raw: string): SubTaskDraft[] {
  const text = String(raw || '').trim()
  if (!text) return []

  const blocks = text.split(/^\s*-{3,}\s*$/m)
  const drafts: SubTaskDraft[] = []

  for (const block of blocks) {
    const titleMatch = block.match(/subtask:\s*([^\n]+)/i)
    if (!titleMatch) continue
    const title = titleMatch[1].trim()
    if (!title) continue
    const detailMatch = block.match(/detail:\s*([^\n]+)/i)
    const detail = detailMatch?.[1]?.trim()
    drafts.push({ title, detail: detail || undefined })
    if (drafts.length >= MAX_SUBTASKS) break
  }

  return drafts
}

// ---------------------------------------------------------------------------
// I/O — the real network + persistence seams
// ---------------------------------------------------------------------------

/**
 * Call the AINative chat-completions proxy to decompose one oversized task.
 * Returns the parsed sub-task drafts, or null on ANY failure (missing key,
 * non-OK response, network error, timeout, or an unparseable reply) — never
 * throws. Modeled directly on story-estimator.ts's estimateStoryPoints().
 */
export async function splitTaskViaLLM(
  title: string,
  detail: string | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<SubTaskDraft[] | null> {
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
        model: SPLITTER_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildSplitPrompt(t, detail) },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const content = String(data?.choices?.[0]?.message?.content || '')
    const drafts = parseSplitResponse(content)
    // A 1-item "decomposition" is not a real split (the issue requires 2-4
    // sub-tasks) — treat it the same as an unparseable reply so the caller
    // leaves the parent untouched for retry rather than accepting a no-op.
    return drafts.length >= MIN_SUBTASKS ? drafts : null
  } catch (e) {
    console.warn('[task-splitter] splitTaskViaLLM failed (best-effort, parent left untouched):', (e as Error)?.name || e)
    return null
  }
}

/**
 * Decompose one oversized `todo` task into 2-4 smaller, independently-sized
 * child tasks, persist them, and mark the parent `completed` with an honest
 * reference to the real child ids. NEVER marks the parent done without a
 * complete, real set of persisted children — any failure along the way
 * (LLM call, parsing, or a child's createTask returning null) leaves the
 * parent completely untouched for a future retry.
 *
 * A child that itself still estimates >3 points (needsSplit) is recursively
 * re-split, up to `MAX_SPLIT_DEPTH` additional levels (tracked via
 * `opts.depth`, starting at 0 for the original oversized task). At the depth
 * ceiling, an oversized child is accepted and persisted as-is rather than
 * re-split again — bounding recursion to a small, fixed depth.
 *
 * Never throws: every failure path returns `{ ok: false, reason }` and the
 * parent's row is left exactly as it was found.
 */
export async function splitTask(
  scopeKey: string,
  parent: BuildTask,
  opts: { depth?: number } = {},
): Promise<SplitTaskResult> {
  const depth = opts.depth ?? 0

  let drafts: SubTaskDraft[] | null
  try {
    drafts = await splitTaskViaLLM(parent.title, parent.detail)
  } catch {
    // splitTaskViaLLM already catches internally and never throws, but guard
    // defensively anyway — a splitter failure must never propagate or lose
    // the parent task.
    drafts = null
  }

  if (!drafts || drafts.length < MIN_SUBTASKS) {
    return { ok: false, childIds: [], reason: 'Decomposition did not produce a usable set of sub-tasks — parent left untouched for retry.' }
  }

  const atDepthCeiling = depth >= MAX_SPLIT_DEPTH
  const childIds: string[] = []

  for (const draft of drafts) {
    const created = await createTask(scopeKey, {
      title: draft.title,
      detail: draft.detail,
      stage: 'todo',
      source: 'cody',
      parentTaskId: parent.id,
    })
    if (!created) {
      // A persistence hiccup on ANY child means we do not have a complete,
      // honest set to reference — fail closed rather than mark the parent
      // completed pointing at a partial/fabricated child list. Already-
      // created children (if any) remain as real, independent todo tasks —
      // they are not rolled back, since rolling back would itself need a
      // delete path this store doesn't expose, and leaving a few extra real
      // todo tasks around is harmless, unlike losing the parent would be.
      return {
        ok: false,
        childIds,
        reason: 'Persisting a decomposed sub-task failed — parent left untouched for retry.',
      }
    }

    // If this child itself still estimates oversized and we have re-split
    // budget left, recurse; otherwise accept it as-is at the depth ceiling.
    if (!atDepthCeiling && needsSplit(created.storyPoints)) {
      const sub = await splitTask(scopeKey, created, { depth: depth + 1 })
      if (sub.ok) {
        childIds.push(...sub.childIds)
        continue
      }
      // The re-split attempt failed (best-effort) — the child itself is
      // already a real, independently-estimated persisted task; accept it
      // as-is rather than losing it or blocking the parent's own completion.
    }

    childIds.push(created.id)
  }

  const output = `Split into ${childIds.length} smaller sub-task(s): ${childIds.join(', ')}.`
  const updated = await updateTask(scopeKey, parent.id, { stage: 'completed', output })
  if (!updated) {
    return {
      ok: false,
      childIds,
      reason: 'Children were created but marking the parent completed failed — parent left in its prior stage for retry.',
    }
  }

  return { ok: true, childIds }
}
