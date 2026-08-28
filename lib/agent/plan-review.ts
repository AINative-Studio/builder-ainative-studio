/**
 * Plan + bounded self-review turns for the headless agent (#342).
 *
 * Polsia's agent maintains .polsia-plan.md and runs explicit review-changes
 * turns — their builds have multi-screen depth. Our primary path was
 * single-shot + static-gate retries with zero dedicated plan or review model
 * turns. This module gives the headless agent (LIVE on prod via
 * AGENT_RUNTIME=cody + CODY_AGENT_PRIMARY=1) the same discipline:
 *
 *   1. PLAN — first action is writing `.cody-plan.md` in the worktree
 *      (features, files, build order as a checklist), updated as it goes.
 *      The file survives across turns because it lives on the worktree
 *      filesystem, not in conversation state.
 *   2. REVIEW — exactly ONE review-changes pass before finishing: re-read
 *      the written files, diff them against the plan, fix what it finds.
 *      Bounded to a single pass (not Polsia's 70x loop) via prompt + a small
 *      maxTurns headroom.
 *
 * The plan file is agent scratch — it must NEVER ship as an app file, so
 * `getWorktreeFiles` (worktree-manager.ts) excludes it via
 * `isAgentScratchFile`.
 */

/** The agent's working plan file, maintained at the worktree root. */
export const PLAN_FILE = '.cody-plan.md'

/**
 * Agent scratch files that must be excluded from the output files collection
 * (they are working memory, not app code). Matched by basename so a scratch
 * file accidentally written in a subdirectory is still excluded.
 */
export const AGENT_SCRATCH_FILES: ReadonlySet<string> = new Set([
  PLAN_FILE,
  '.cody-analysis.md',
])

/**
 * True when a path (relative or absolute) is an agent scratch file that must
 * not be collected into the generated app's file map.
 */
export function isAgentScratchFile(path: string): boolean {
  if (!path) return false
  const base = path.replace(/\\/g, '/').split('/').pop() || ''
  return AGENT_SCRATCH_FILES.has(base)
}

/**
 * Extra turns granted on top of the caller's maxTurns so the plan turn and the
 * single review turn never eat the budget meant for building.
 *
 * Calibrated from a live cody+Bedrock smoke run: the review pass is one PASS
 * but ~3 tool turns (read files → fix → update plan), and the plan write is
 * one more — with +2 the run hit --max-turns mid-review and returned an error
 * result (the same failure mode as cody-cli#251). 4 covers plan + a full
 * review pass; the agent still stops early on its own when done.
 */
export const PLAN_REVIEW_TURN_HEADROOM = 4

/**
 * System-prompt block appended to the agent's base prompt. Instructs the plan
 * file discipline and the single bounded review pass.
 *
 * NOTE: the base AGENT_SYSTEM_PROMPT forbids creating new files and exploring
 * the filesystem (fast-path guardrails). The carve-outs below are deliberate
 * and minimal: the plan file is the one extra file allowed, and re-reading
 * files the agent itself wrote is the one allowed "exploration" (it IS the
 * review).
 */
export function planReviewPromptBlock(): string {
  return [
    `PLAN FILE (${PLAN_FILE}):`,
    `- Your FIRST action: use the Write tool to create ${PLAN_FILE} at the workspace root. List (a) the features/sections you will build, (b) the files you will create or edit, (c) the build order — as a markdown checklist.`,
    `- Create it with the Write tool ONLY. Shell commands (Bash/cat/heredoc/printf) are NOT available and every attempt is rejected, wasting a turn.`,
    `- Update it as you go: mark items done ([x]) when you complete them. It is your working plan across turns.`,
    `- ${PLAN_FILE} is agent working memory, NOT app code — it is never shipped. It is the ONE exception to the "do not create new files" rule above.`,
    '',
    'SELF-REVIEW (exactly ONE pass, right before you finish):',
    '- After the app code is complete, do ONE review-changes pass:',
    `  1. Re-read the files you wrote (Read is allowed for this — reviewing your own changes is not "exploring").`,
    `  2. Check them against ${PLAN_FILE} and the original request: every planned feature present and interactive; imports between files resolve; all JSX tags balanced; no placeholder/TODO/stub content left.`,
    '  3. Fix every problem you find with Edit.',
    `  4. Update ${PLAN_FILE} with a short "## Review" section: what you checked, what you fixed.`,
    '- Keep the whole review to at most 3 tool calls. Then STOP. Do NOT start a second review pass — one pass, fix, finish.',
  ].join('\n')
}
