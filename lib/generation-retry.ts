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

/** Build the repair instruction fed to the model on each retry. */
export function buildRepairPrompt(prompt: string, error: string): string {
  return (
    `The generated code failed validation.\n\nERROR: ${error}\n\n` +
    `Fix the error and return a corrected, complete version of: ${prompt}\n` +
    'Requirements: every JSX tag closed, every string terminated, every bracket matched, ' +
    'and every component used in JSX must be defined here, imported, or a known primitive ' +
    '(never reference an undefined component). Return ONLY the code in ```jsx markers.'
  )
}
