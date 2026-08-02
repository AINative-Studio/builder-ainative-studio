/**
 * Generation Mode Selection (Issue #11)
 *
 * Single source of truth for the custom-prompt generation workflow's mode
 * decision. The chat-ws route and the integration test suite both use this so
 * behaviour stays in lockstep and is independently testable without a live
 * Anthropic key.
 *
 * The production workflow (app/api/chat-ws/route.ts) branches on
 * `process.env.USE_SUBAGENTS === 'true'`:
 *   - subagents  → hierarchical orchestrator (runOrchestratorAgent)
 *   - standard   → single-pass provider generation with COMPONENT_GENERATION_TOOL
 */

export type GenerationMode = 'subagents' | 'standard'

/**
 * Resolve the active generation mode from an environment-like object.
 * Defaults to `standard` unless USE_SUBAGENTS is explicitly the string 'true'.
 */
export function selectGenerationMode(
  env: Record<string, string | undefined> = process.env
): GenerationMode {
  return env.USE_SUBAGENTS === 'true' ? 'subagents' : 'standard'
}

/** Convenience predicate matching the route's inline check. */
export function useSubagents(
  env: Record<string, string | undefined> = process.env
): boolean {
  return selectGenerationMode(env) === 'subagents'
}

/**
 * Success criteria for a generated component (from Issue #11):
 *   - generates a valid component (passes code validation)
 *   - preview would render (non-empty component code)
 *   - no forbidden constructs (gradients / emoji handled by validators)
 *   - generation time < 30s
 */
export const GENERATION_MAX_TIME_MS = 30_000

export interface GenerationQualityInput {
  componentCode: string
  validationPassed: boolean
  generationTimeMs: number
}

export interface GenerationQualityResult {
  passed: boolean
  failures: string[]
}

/**
 * Evaluate a single generation result against Issue #11 success criteria.
 * Pure function — deterministic and used by both live and mocked tests.
 */
export function evaluateGenerationQuality(
  input: GenerationQualityInput
): GenerationQualityResult {
  const failures: string[] = []

  if (!input.componentCode || input.componentCode.trim().length === 0) {
    failures.push('empty component code (preview would not render)')
  }
  if (!input.validationPassed) {
    failures.push('code validation failed')
  }
  if (input.generationTimeMs >= GENERATION_MAX_TIME_MS) {
    failures.push(
      `generation time ${input.generationTimeMs}ms exceeded ${GENERATION_MAX_TIME_MS}ms budget`
    )
  }

  return { passed: failures.length === 0, failures }
}

/** The canonical Issue #11 test prompts. Exported for reuse across suites. */
export const ISSUE_11_TEST_PROMPTS = [
  'Create a landing page for a SaaS product',
  'Build a dashboard with revenue charts',
  'Design a contact form with email validation',
  'Make a product showcase grid with filters',
  'Generate a blog post layout with sidebar',
] as const
