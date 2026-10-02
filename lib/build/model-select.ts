/**
 * Complexity-driven model auto-selection for Cody codegen (builder#306, builder#895).
 *
 * Objective: QUALITY-FIRST for anything that needs it, cost as tiebreak for what
 * doesn't (product decision 2026-08-26, revised 2026-10-02). Cody picks the model
 * by how complex the PRD/backlog scores: simple apps get a cheap open-source
 * model, medium apps get Sonnet, and complex apps get the strongest model the
 * benchmark shows wins on complex builds.
 *
 * builder#895: the `simple` tier moved off Claude entirely onto an open-source
 * model from this same Bedrock account's catalog (Kimi/MiniMax/GLM — all verified
 * live 2026-10-02, same bearer-token auth as Claude, see lib/bedrock-client.ts's
 * isOpenAIShapedModel() for the response-shape normalization this required). A
 * simple counter app doesn't need a frontier model's quality OR its API cost.
 * medium/complex are untouched — they still need Claude's quality.
 *
 * The tier→model map is data-driven from the benchmark (scripts/model-benchmark.mjs).
 * Until the benchmark is re-run against the open-source options (and the newly-
 * available Claude generations), DEFAULTS below encode the current hypothesis.
 * Override at runtime via env so we can retune without a deploy:
 *   CODY_MODEL_SIMPLE / CODY_MODEL_MEDIUM / CODY_MODEL_COMPLEX
 *
 * These are Bedrock inference-profile / model IDs (see lib/bedrock-client.ts — the
 * builder calls Bedrock directly). A tier's model must be one the caller's tier is
 * entitled to — enforce billing gating at the call site, not here.
 */

export type Complexity = 'simple' | 'medium' | 'complex'

/**
 * Quality-first defaults as Bedrock model/inference-profile IDs (the builder calls
 * AWS Bedrock directly via lib/bedrock-client.ts, so the gen call needs the
 * profile ID, not an API alias). Medium/complex verified entitled (HTTP 200) on
 * the builder bearer 2026-08-26; simple's open-source model verified live
 * 2026-10-02 (builder#895 — see lib/bedrock-client.ts's isOpenAIShapedModel()
 * for why that required response-shape normalization: Kimi/MiniMax/GLM reply in
 * OpenAI chat-completions shape, not Claude's, even over this same endpoint).
 * Cost-saving is the point: a simple counter app shouldn't pay for a frontier
 * model's quality OR its API cost — only complex multi-file apps get Opus.
 * Retune from the benchmark; env overrides win (set
 * CODY_MODEL_SIMPLE/MEDIUM/COMPLEX to a profile ID).
 */
const DEFAULTS: Record<Complexity, string> = {
  simple: 'moonshotai.kimi-k2.5',                         // open-source; simple apps don't need a frontier model
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
