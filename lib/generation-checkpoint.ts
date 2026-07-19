/**
 * Generation checkpointing + degradation ladder (builder#81, Phase 2).
 *
 * The generation pipeline has several stages that can each improve OR regress the
 * output: initial generation, the retry loop (#77), and the verify agent (#80).
 * To guarantee "never render broken," we checkpoint the last code that PASSED
 * validation. At the end, the pipeline serves, in order:
 *   1. the current code if it is valid, else
 *   2. the last checkpointed valid code (a slightly-less-complete but WORKING
 *      version), else
 *   3. a clean fallback state (handled by lib/validation-fallback).
 *
 * This converts "1 in 4 users see a broken preview" into "worst case is a working
 * earlier version or a clean state" — the graceful-degradation pattern.
 */

export interface Checkpoint {
  code: string
  stage: string
}

export class GenerationCheckpoint {
  private best: Checkpoint | null = null

  /** Record a stage's output. Only valid outputs become the checkpoint. */
  record(stage: string, code: string, valid: boolean): void {
    if (valid && typeof code === 'string' && code.trim().length > 0) {
      this.best = { code, stage }
    }
  }

  /** Whether any valid version has been captured. */
  hasValid(): boolean {
    return this.best !== null
  }

  /** The last valid code, or null if none. */
  get(): Checkpoint | null {
    return this.best
  }
}

export type DegradationOutcome =
  | { kind: 'current'; code: string }
  | { kind: 'checkpoint'; code: string; stage: string }
  | { kind: 'fallback' }

/**
 * Decide what to render given the final validation state and the checkpoint.
 * Pure so it can be unit-tested exhaustively.
 */
export function resolveDegradation(
  currentCode: string,
  currentValid: boolean,
  checkpoint: GenerationCheckpoint,
): DegradationOutcome {
  if (currentValid && currentCode.trim().length > 0) {
    return { kind: 'current', code: currentCode }
  }
  const cp = checkpoint.get()
  if (cp) {
    return { kind: 'checkpoint', code: cp.code, stage: cp.stage }
  }
  return { kind: 'fallback' }
}
