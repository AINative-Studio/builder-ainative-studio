/**
 * Closed retry loop for the generation pipeline (builder#77).
 *
 * When generated code fails validation, re-generate with the SPECIFIC error fed
 * back, re-validate, and stop as soon as it passes. Research (Cursor/Aider/
 * LLMloop) shows most fixes land in 1-2 iterations, so we cap at a small number
 * and never spiral. Extracted as a pure, testable unit so the chat-ws route can
 * stay a thin caller.
 */

export interface RetryValidation {
  valid: boolean
  error?: string
  code: string
}

export interface RetryOptions {
  /** Max repair attempts. Default 3. */
  maxRetries?: number
  /** Model names to rotate through, one per attempt. */
  models: string[]
  /** The original user prompt (for the repair instruction). */
  prompt: string
  /**
   * Generate repaired code. Receives the model, the current error, and the
   * current (invalid) code; returns raw model output (may be markdown-wrapped).
   * Should throw or return '' on failure.
   */
  generate: (model: string, error: string, brokenCode: string) => Promise<string>
  /** Validate raw model output → RetryValidation (extracts markdown, auto-fixes). */
  validate: (raw: string) => RetryValidation
  /** Optional progress callback per attempt (1-based). */
  onAttempt?: (attempt: number, total: number, model: string) => void
  /** Minimum content length to consider an attempt worth validating. Default 500. */
  minLength?: number
}

export interface RetryResult {
  /** True if a retry produced valid code. */
  recovered: boolean
  /** The valid code if recovered, else the last (still-invalid) code. */
  code: string
  /** The last validation state. */
  validation: RetryValidation
  /** Number of attempts actually made. */
  attempts: number
}

/**
 * Run the repair loop. Returns as soon as validation passes, or after
 * maxRetries. Pure w.r.t. its injected generate/validate callbacks.
 */
export async function runValidationRetryLoop(
  initial: RetryValidation,
  opts: RetryOptions,
): Promise<RetryResult> {
  const maxRetries = opts.maxRetries ?? 3
  const minLength = opts.minLength ?? 500
  let validation = initial
  let code = initial.code
  let attempts = 0

  for (let i = 0; i < maxRetries && !validation.valid; i++) {
    const model = opts.models[i % opts.models.length]
    attempts++
    opts.onAttempt?.(i + 1, maxRetries, model)

    let raw = ''
    try {
      raw = await opts.generate(model, validation.error || 'unknown error', validation.code)
    } catch {
      continue // API error on this attempt — try the next model
    }
    if (!raw || raw.length <= minLength) continue

    const next = opts.validate(raw)
    if (next.valid) {
      return { recovered: true, code: next.code, validation: next, attempts }
    }
    // Feed the NEW error into the next iteration.
    validation = next
    code = next.code
  }

  return { recovered: validation.valid, code, validation, attempts }
}

/**
 * builder#531: an unterminated template literal (an opening backtick with no
 * matching closing backtick) is a distinct, common, MECHANICALLY-fixable error
 * class — usually one missing backtick, not a design problem — but "every
 * string terminated" alone doesn't make the model think of backtick-delimited
 * template strings specifically (easy to lose track of when a template spans
 * embedded `${...}` expressions or multi-line JSX text). Named explicitly so
 * the repair pass has a precise, targeted instruction instead of a generic one.
 */
function isUnterminatedTemplateError(error: string): boolean {
  return /unterminated template/i.test(error || '')
}

/** Build the repair instruction fed to the model on each retry. */
export function buildRepairPrompt(prompt: string, error: string): string {
  const templateHint = isUnterminatedTemplateError(error)
    ? '\nThe error is an UNTERMINATED TEMPLATE LITERAL: a `\\`` (backtick) was opened but never ' +
      'closed. Find the exact backtick named in the error location, and add the missing closing ' +
      '`\\`` right after the string content ends — do not add a matching backtick anywhere else, ' +
      'and do not rewrite unrelated code.\n'
    : ''
  return (
    `The generated code failed validation.\n\nERROR: ${error}\n${templateHint}\n` +
    `Fix the error and return a corrected, complete version of: ${prompt}\n` +
    'Requirements: every JSX tag closed, every string terminated, every bracket matched, ' +
    'and every component used in JSX must be defined here, imported, or a known primitive ' +
    '(never reference an undefined component). Return ONLY the code in ```jsx markers.'
  )
}

/**
 * Extract the line number from a code-validator error string (builder#531).
 *
 * `validateJavaScriptCode`'s catastrophic-error messages (lib/code-validator.ts)
 * are formatted as `"${message} at line ${line}, column ${column}\n..."`. This
 * mirrors that exact shape so the two stay in lockstep — if that format ever
 * changes, this returns null and callers fall back to their previous behavior.
 */
export function parseErrorLine(error: string): number | null {
  const m = /\bat line (\d+)/.exec(error || '')
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Slice a window of `code` centered on the line the validator's error points at,
 * instead of blindly truncating from the start (builder#531).
 *
 * Every repair prompt in this pipeline previously did `brokenCode.slice(0, N)` —
 * a flat prefix cutoff. For a large or multi-file generation (a real "community
 * platform" build hit an "Unterminated template" at line 734 of a ~700+ line,
 * multi-file payload), that prefix ends hundreds of lines before the actual
 * error: the repair model was handed code that LOOKS fine (because the broken
 * part was never in its context) and had no way to find, let alone fix, the
 * real defect. Every retry attempt then failed for the same reason.
 *
 * Centering the slice on the error line (when one is present in the error
 * string) guarantees the offending line is always in view, with generous
 * context on both sides for the model to understand the surrounding
 * component/function. Falls back to the original prefix-slice behavior when no
 * line number is present (e.g. a non-parse validation error like "Element type
 * is invalid" or "has already been declared", which don't name a specific line).
 *
 * @param code - The broken code to slice.
 * @param error - The validation error string (may contain "at line N").
 * @param maxChars - Max characters in the returned window. Default 8000 (matches
 *   the retry loop's prior flat-slice budget, so model cost/latency is unchanged
 *   — only WHICH 8000 chars get sent).
 * @param contextLines - Lines of context to keep before/after the error line.
 *   Default 120 — generous enough to cover a full component/function body.
 */
export function extractErrorWindow(
  code: string,
  error: string,
  maxChars = 8000,
  contextLines = 120,
): string {
  const safeCode = code || ''
  const line = parseErrorLine(error)

  // No line number in the error (or code too short to matter) — keep the
  // original flat prefix-slice behavior other validation errors already relied on.
  if (line === null || safeCode.length <= maxChars) {
    return safeCode.slice(0, maxChars)
  }

  const lines = safeCode.split('\n')
  const errIdx = Math.min(Math.max(line - 1, 0), lines.length - 1)
  const start = Math.max(0, errIdx - contextLines)
  const end = Math.min(lines.length, errIdx + contextLines + 1)

  let windowed = lines.slice(start, end).join('\n')
  // Still respect the char budget — a single very long line (or wide context)
  // could exceed it; re-center within the windowed text as a final guard.
  if (windowed.length > maxChars) {
    const relativeErrOffset = lines.slice(start, errIdx).join('\n').length
    const halfBudget = Math.floor(maxChars / 2)
    const from = Math.max(0, relativeErrOffset - halfBudget)
    windowed = windowed.slice(from, from + maxChars)
  }

  const prefix = start > 0 ? `/* … ${start} line(s) omitted above … */\n` : ''
  const suffix = end < lines.length ? `\n/* … ${lines.length - end} line(s) omitted below … */` : ''
  return `${prefix}${windowed}${suffix}`
}
