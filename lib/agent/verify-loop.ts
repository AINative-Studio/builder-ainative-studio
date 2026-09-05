/**
 * Authoritative build→error→retry verification (builder#80, Phase 1).
 *
 * The fast path generates code and validates it with a parser; that can't catch
 * runtime/scope errors (undefined components, bad imports) that only surface when
 * the code actually runs. When the agent runtime is available (cody-cli) it can
 * run tools — so we give a repair agent `Read` + `Bash` so it can genuinely
 * verify (typecheck/build) and self-correct, per the closed-loop pattern from
 * Cursor/Aider/OpenHands.
 *
 * This module holds the pure, testable pieces: the tool set, the budget, and the
 * verify instruction. The chat-ws route wires them into runHeadlessAgent.
 */

import { extractErrorWindow } from '@/lib/generation-retry'

/** Tools the verify agent needs to genuinely check its work (not just write). */
export const VERIFY_AGENT_TOOLS = ['Read', 'Write', 'Edit', 'Bash']

/** A slightly higher budget than a blind write, since verification runs tools. */
export const VERIFY_AGENT_MAX_BUDGET_USD = 0.75

/** Max verify iterations before falling back to graceful degradation. Kept
 * above the read→patch→re-verify minimum so the agent doesn't hit --max-turns
 * mid-tool-call and return an empty result (cody-cli#251). */
export const VERIFY_MAX_TURNS = 6

/**
 * Build the system prompt for the verify agent. It must fix the code AND confirm
 * it actually builds/renders, not just looks right.
 */
export function buildVerifySystemPrompt(): string {
  return (
    'You are a React build-and-verify agent working in an isolated workspace. ' +
    'Fix the provided component so it BUILDS and RENDERS cleanly. ' +
    'After editing, verify your work (typecheck / run the build if available) and ' +
    'fix any remaining errors — including runtime errors like "Element type is invalid" ' +
    '(a component used but not defined or imported). ' +
    'Every component used in JSX MUST be defined in the file, imported, or a known primitive. ' +
    'The result MUST have `export default function App()`. ' +
    'Output ONLY the corrected code wrapped in ```jsx markers — no explanations.'
  )
}

/**
 * Build the user prompt for the verify agent given the broken code and the
 * validation error that triggered repair.
 *
 * builder#531: the raw code is sliced through `extractErrorWindow`, which
 * centers the window on the error's own "at line N" location instead of a flat
 * prefix cutoff. A flat `slice(0, 12000)` silently drops the actual defect for
 * any large or multi-file generation whose error lands past that offset (a
 * real "community platform" build hit an unterminated template at line 734 —
 * well outside a 12000-char prefix of a 700+ line multi-file payload), so the
 * agent was asked to fix code that, from its view, had no error in it.
 */
export function buildVerifyPrompt(prompt: string, error: string, brokenCode: string): string {
  return (
    `Fix this React component. It failed validation with:\n\nERROR: ${error}\n\n` +
    `BROKEN CODE:\n\`\`\`jsx\n${extractErrorWindow(brokenCode || '', error, 12000)}\n\`\`\`\n\n` +
    `Produce a corrected, complete version of: ${prompt}\n` +
    'Make sure every component resolves and the build passes. Return ONLY the fixed code in ```jsx markers.'
  )
}

/**
 * Options for a verify-agent run — passed straight to runHeadlessAgent so the
 * agent can Read/Bash to verify. Model is chosen by the caller (defaults left to
 * the runtime).
 */
export function buildVerifyAgentOptions(model?: string): {
  model?: string
  maxBudgetUsd: number
  maxTurns: number
  allowedTools: string[]
  systemPrompt: string
  runGeneratedTests: boolean
  planReview: boolean
} {
  return {
    model,
    maxBudgetUsd: VERIFY_AGENT_MAX_BUDGET_USD,
    maxTurns: VERIFY_MAX_TURNS,
    allowedTools: VERIFY_AGENT_TOOLS,
    systemPrompt: buildVerifySystemPrompt(),
    // A repair pass must never re-enter the worktree test gate (#341) — the
    // gate belongs to the primary generation run only. And a repair run is
    // short and targeted (#342) — a plan file + review turn would waste its
    // 6-turn budget. The build path keeps both disciplines on.
    runGeneratedTests: false,
    planReview: false,
  }
}
