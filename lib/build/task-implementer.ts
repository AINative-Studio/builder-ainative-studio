/**
 * LLM-driven task implementation step (#373, epic #371).
 *
 * Given a backlog task (lib/build/task-store.ts's BuildTask) and a company's
 * EXISTING generated-app code, has an LLM actually implement the change:
 * read the relevant files, produce a real code change — not a fabricated
 * "done" status. Confirmed via a full codebase grep (issue #373's scoping
 * comment): no prior "edit existing generated app code" capability exists
 * anywhere — lib/build/artifact-edit.ts only edits PRD/thesis/backlog TEXT
 * artifacts, never app code. This is genuinely new capability, built fresh.
 *
 * v1 scope (deliberately narrow, per the #373 scoping pass):
 *   - Single attempt, no retry loop — an honest failure surfaces immediately
 *     rather than silently retrying or fabricating success.
 *   - Full-file context for every existing file (confirmed via
 *     lib/build/multifile-emphasis.ts: generated apps are bounded/small —
 *     sidebar+table+kanban+charts+settings scale, not a large codebase — so
 *     no retrieval/search step is needed for v1).
 *   - Output is a FileMap of ONLY the changed files — #374 (task-git-sync)
 *     takes it from there for commit/PR, and #372's coverage-runner verifies
 *     the result. This module does not touch git or run tests itself.
 */

import { getClaudeCompletion } from '@/lib/build/claude-completion'
import type { BuildTask } from '@/lib/build/task-store'

export interface ImplementTaskResult {
  ok: boolean
  /** The changed files (path -> full new content), present only when ok. */
  files?: Record<string, string>
  /** Honest failure reason for BuildTask.output — never blank on failure. */
  reason?: string
}

const MAX_TOKENS = 8000
const TIMEOUT_MS = 90_000

// ---------------------------------------------------------------------------
// PURE LOGIC (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the incremental-edit task. Distinct from
 * lib/professional-prompt.ts (single-shot, blank-slate generation) — this is
 * purpose-built for "here is existing code, make ONE targeted change without
 * breaking anything else." Reuses the AX rubric + security-baseline (C5)
 * standard from #365 as the quality bar for anything newly written, but does
 * NOT repeat the full one-shot generation instructions (theme, AX-1..AX-10
 * boilerplate) that only make sense for a from-scratch page. PURE.
 */
export function buildImplementationSystemPrompt(): string {
  return [
    'You are Cody, implementing ONE backlog story against an EXISTING generated app.',
    '',
    'You will be given the full current contents of every existing file, then a',
    'specific story to implement. Your job:',
    '  1. Make the SMALLEST correct change that fully implements the story.',
    '  2. Preserve everything not related to this story — do not rewrite,',
    '     reformat, or "improve" unrelated code.',
    '  3. Keep the same coding conventions already used in the file(s) you touch.',
    '  4. Security baseline (AINative engineering standard): sanitize/validate',
    '     anything derived from user input or fetched data; never log secrets,',
    '     API keys, or tokens; never render raw user-supplied strings via',
    '     dangerouslySetInnerHTML.',
    '  5. If the story genuinely cannot be implemented as described (missing',
    '     context, contradicts existing code, unclear requirement), say so',
    '     plainly — do NOT invent a fake implementation to appear successful.',
    '',
    'Output STRICT JSON only, no prose, no markdown fences:',
    '{ "ok": true, "files": { "path/to/file.tsx": "FULL NEW FILE CONTENT" } }',
    'or, if the story cannot be implemented:',
    '{ "ok": false, "reason": "specific, honest explanation" }',
    '',
    '"files" must include the FULL new content of every file you changed —',
    'never a diff/patch fragment. Only include files you actually changed.',
  ].join('\n')
}

/**
 * Build the user prompt: the story + every existing file's current content.
 * PURE — string assembly only.
 */
export function buildImplementationUserPrompt(task: Pick<BuildTask, 'title' | 'detail'>, existingFiles: Record<string, string>): string {
  const storyBlock = [
    `STORY: ${task.title}`,
    task.detail ? `DETAIL: ${task.detail}` : '',
  ].filter(Boolean).join('\n')

  const filesBlock = Object.entries(existingFiles)
    .map(([path, content]) => `// --- FILE: ${path} ---\n${content}`)
    .join('\n\n')

  return [
    storyBlock,
    '',
    'EXISTING FILES:',
    filesBlock || '(no existing files — this is the first change to this app)',
  ].join('\n')
}

/**
 * Parse the LLM's raw text response into an ImplementTaskResult. PURE.
 * Extracts the first balanced JSON object (mirrors app/api/build/artifact's
 * parseJson — handles ```json fences / stray prose around the object).
 * Returns an honest failure (never a fabricated success) on any parse issue.
 */
export function parseImplementationResponse(raw: string): ImplementTaskResult {
  if (!raw?.trim()) {
    return { ok: false, reason: 'Model returned an empty response.' }
  }
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    return { ok: false, reason: 'Model response did not contain a parseable JSON object.' }
  }
  s = s.slice(start, end + 1)
  let parsed: any
  try {
    parsed = JSON.parse(s)
  } catch (e) {
    return { ok: false, reason: `Model response was not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (parsed?.ok === false) {
    return { ok: false, reason: String(parsed.reason || 'Model reported the story could not be implemented.') }
  }
  if (parsed?.ok !== true || !parsed?.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
    return { ok: false, reason: 'Model response was missing a valid "files" object.' }
  }
  const files: Record<string, string> = {}
  for (const [path, content] of Object.entries(parsed.files)) {
    if (typeof path === 'string' && path.trim() && typeof content === 'string') {
      files[path] = content
    }
  }
  if (Object.keys(files).length === 0) {
    return { ok: false, reason: 'Model reported success but returned no changed files.' }
  }
  return { ok: true, files }
}

// ---------------------------------------------------------------------------
// I/O — isolated from the pure logic above
// ---------------------------------------------------------------------------

/**
 * Implement one backlog task against a company's existing generated-app
 * files. Single attempt, no retry — an honest failure (LLM error, no
 * provider configured, unparseable output, model-reported impossibility)
 * returns ok:false with a real reason for BuildTask.output. Never fabricates
 * a success.
 */
export async function implementTask(
  task: Pick<BuildTask, 'title' | 'detail'>,
  existingFiles: Record<string, string>,
): Promise<ImplementTaskResult> {
  const claude = getClaudeCompletion()
  if (!claude) {
    return { ok: false, reason: 'No completion provider configured (NO_CLAUDE_PROVIDER).' }
  }

  const system = buildImplementationSystemPrompt()
  const user = buildImplementationUserPrompt(task, existingFiles)

  try {
    const res = await claude.client.messages.create(
      {
        model: claude.model,
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        system,
        messages: [{ role: 'user', content: user }],
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
    const text = (res.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    return parseImplementationResponse(text)
  } catch (e) {
    return {
      ok: false,
      reason: `Implementation call failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
