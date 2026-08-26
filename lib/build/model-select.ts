/**
 * Complexity-driven model auto-selection for Cody codegen (builder#306).
 *
 * Objective: QUALITY-FIRST, cost as tiebreak (product decision 2026-08-26). Cody
 * picks the model by how complex the PRD/backlog scores, so simple apps get a fast/
 * cheap model and complex apps get the strongest model the benchmark shows wins on
 * complex builds.
 *
 * The tier→model map is data-driven from the benchmark (scripts/model-benchmark.mjs).
 * Until the benchmark is run against the newly-available models, DEFAULTS below encode
 * the quality-first hypothesis (Opus for complex, Sonnet 4.6 for medium, Sonnet 4.5
 * for simple). Override at runtime via env so we can retune without a deploy:
 *   CODY_MODEL_SIMPLE / CODY_MODEL_MEDIUM / CODY_MODEL_COMPLEX
 *
 * These are AINative-API model aliases (Bedrock channel). A tier's model must be one
 * the caller's tier is entitled to — enforce billing gating at the call site, not here.
 */

export type Complexity = 'simple' | 'medium' | 'complex'

/**
 * Quality-first defaults as Bedrock INFERENCE-PROFILE IDs (the builder calls AWS
 * Bedrock directly via lib/bedrock-client.ts, so the gen call needs the profile ID,
 * not an API alias). All three verified entitled (HTTP 200) on the builder bearer
 * 2026-08-26. Cost-saving is the point: a simple counter app must NOT pay Opus
 * prices — only complex multi-file apps get Opus. Retune from the benchmark; env
 * overrides win (set CODY_MODEL_SIMPLE/MEDIUM/COMPLEX to a profile ID).
 */
const DEFAULTS: Record<Complexity, string> = {
  simple: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', // cheapest; simple apps don't need more
  medium: 'us.anthropic.claude-sonnet-4-6',               // newer Sonnet, same Sonnet cost tier
  complex: 'us.anthropic.claude-opus-4-6-v1',             // Opus ONLY for complex multi-file apps
}

/** Which env var overrides each tier. */
const ENV_KEY: Record<Complexity, string> = {
  simple: 'CODY_MODEL_SIMPLE',
  medium: 'CODY_MODEL_MEDIUM',
  complex: 'CODY_MODEL_COMPLEX',
}

/**
 * Pick the model alias for a complexity tier. `wantsMultiFile` bumps a "medium"
 * idea to the complex model — a multi-surface app benefits from the stronger model
 * even when the raw complexity score reads medium (the score under-counts terse
 * complex ideas, same reason the multi-file directive is bumped elsewhere).
 */
export function selectModelForComplexity(
  complexity: Complexity,
  opts: { wantsMultiFile?: boolean; env?: Record<string, string | undefined> } = {},
): string {
  const env = opts.env || process.env
  // A multi-file idea → the COMPLEX (strong) model, from ANY tier. analyzeComplexity
  // badly under-scores terse-but-complex ideas: "a CRM with a sidebar, contacts table,
  // deal pipeline, activity feed, reports" scores "simple", yet it's exactly a
  // multi-surface app that needs Opus. wantsMultiFile (the surface/archetype signal)
  // is the reliable "this is complex" tell, so it overrides the tier entirely.
  const tier: Complexity = opts.wantsMultiFile ? 'complex' : complexity
  const override = (env[ENV_KEY[tier]] || '').trim()
  return override || DEFAULTS[tier]
}

/** Human-readable one-liner for logs. */
export function modelSelectionReport(complexity: Complexity, wantsMultiFile: boolean, model: string): string {
  const bumped = complexity === 'medium' && wantsMultiFile ? ' (bumped medium→complex: multi-surface)' : ''
  return `🎚️ Model auto-select: ${complexity}${bumped} → ${model}`
}
