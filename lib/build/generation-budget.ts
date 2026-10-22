/**
 * Per-generation token/cost budget (#1192).
 *
 * The gap this closes: a single founder request can fan out into MANY real LLM
 * calls, and nothing anywhere accumulates their cost or caps it.
 *
 * The concrete runaway path is lib/agent/multi-pass-generator.ts's
 * executeChunkPlan(): it loops over N planned phases sequentially, each a real
 * chat.completions.create() with `max_tokens: 16000`, AND retries any failed
 * phase once — so up to 2N calls at 16k output each, with zero spend check
 * between iterations. A chunk plan with a lot of phases, or a phase that fails
 * repeatedly, bills every one of those calls. The same applies to the route's
 * Claude-direct → Meta-stream → AINative-fallback chain, where a single
 * request can pay for several full-size generations.
 *
 * What already existed, and why it is NOT this:
 *   - lib/build/build-cost-ledger.ts (#886) persists the real cost AFTER a
 *     build finishes. It is the audit trail; it cannot stop anything.
 *   - lib/build/context-budget-chat.ts (#1195) is a message-count/context-window
 *     budget that TRIMS history before a call. Different concern, not dollars.
 *   - lib/build/build-credits.ts counts flat builds (3 free / 80 starter),
 *     completely decoupled from real cost — a one-line prompt and a 10-phase
 *     16k-per-phase build both cost exactly "1 build".
 *   - lib/build/value-moment.ts holds the REAL per-call token ceilings
 *     (APP_GEN_MAX_TOKENS = 16000, ARTIFACT_MAX_TOKENS = 1600) as an honest
 *     estimate surface. This module reuses APP_GEN_MAX_TOKENS as the worst-case
 *     per-call output rather than inventing a second, drifting ceiling.
 *
 * So: nothing here is a dollar cap, and nothing stops a generation in flight.
 *
 * It also fixes a real pricing bug. route.ts hardcodes Sonnet's rates in four
 * separate places, in two different units:
 *     line ~1263:  input * 0.000003 + output * 0.000015          (per token)
 *     lines ~1084/1317/1341/1392: (in * 0.003 + out * 0.015)/1000 (per 1K)
 * Numerically identical, but both are Sonnet-only — so an Opus generation
 * (BEDROCK_MODEL_ID can select Opus, per project history) is recorded at
 * roughly a fifth of what it actually cost, and Haiku/Starter builds are
 * overstated. MODEL_PRICING below is one real per-model table.
 *
 * Design stance — this is the single most important path in the app, so:
 *   - Pure module. No I/O, no fetch, no DB. Deterministic and unit-covered.
 *   - Immutable: recordCall() returns a new budget, so a caller can never
 *     half-update the meter and lose spend.
 *   - Pre-flight, not post-hoc: canAffordAnotherCall() refuses the NEXT call
 *     using its WORST CASE (max_tokens), so the cap is never crossed rather
 *     than detected after the money is gone.
 *   - The FIRST call is always allowed. A misconfigured tiny cap must never
 *     produce a generation that did literally nothing — the founder would see
 *     an error with no app and no explanation.
 *   - Fail-OPEN on a malformed budget. Breaking generation because the meter
 *     itself is broken is worse than the overspend it prevents — the same
 *     stance build-credits.ts and context-budget-chat.ts already take.
 */

import { APP_GEN_MAX_TOKENS } from '@/lib/build/value-moment'

// ── Real per-model pricing ───────────────────────────────────────────────────

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMillionUsd: number
  /** USD per 1,000,000 output tokens. */
  outputPerMillionUsd: number
}

/**
 * Published list prices, USD per million tokens. Keys are matched as
 * substrings of the model id (see pricingForModel) so that Bedrock's
 * region/provider-prefixed ids — 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
 * — resolve to the same entry as the bare Anthropic id.
 *
 * The 'claude-sonnet-4-5' numbers are exactly what route.ts already charges
 * ($3/$15 per 1M); the rest are the published rates for their families. These
 * are list prices for a cost ESTIMATE used to enforce a safety cap — not an
 * invoice. Update them when prices change.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  'claude-opus': { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  'claude-sonnet': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'claude-haiku': { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
  // Non-Claude models reachable through the AINative proxy / fallback chain.
  'kimi-k2': { inputPerMillionUsd: 0.6, outputPerMillionUsd: 2.5 },
  'ministral': { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.1 },
  'gpt-oss': { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5 },
  'llama': { inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.2 },
}

/**
 * Pricing key used for a model we do not recognise. Deliberately Sonnet — the
 * default generation model and the rate route.ts already assumes. Pricing an
 * unknown model at $0 would silently make the cap unenforceable, which is the
 * exact failure this module exists to prevent.
 */
export const DEFAULT_PRICING_KEY = 'claude-sonnet'

/**
 * Resolve pricing for a model id. Longest key match wins, so 'claude-opus'
 * is never shadowed by a shorter overlapping key. Always returns a real
 * non-zero rate.
 */
export function pricingForModel(modelId: string): ModelPricing {
  const id = String(modelId || '').toLowerCase()
  let best: string | null = null
  for (const key of Object.keys(MODEL_PRICING)) {
    if (id.includes(key) && (best === null || key.length > best.length)) best = key
  }
  return MODEL_PRICING[best ?? DEFAULT_PRICING_KEY]
}

/** Non-negative, finite token count. Garbage never credits the budget back. */
function safeTokens(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v) || v <= 0) return 0
  return v
}

/** Real USD cost of one call's usage at the given model's rates. */
export function costForUsage(inputTokens: number, outputTokens: number, modelId: string): number {
  const p = pricingForModel(modelId)
  const inTok = safeTokens(inputTokens)
  const outTok = safeTokens(outputTokens)
  return (inTok * p.inputPerMillionUsd + outTok * p.outputPerMillionUsd) / 1_000_000
}

// ── Configurable limit ───────────────────────────────────────────────────────

/**
 * Default cap for ONE founder request, in USD.
 *
 * Grounded in the real pipeline rather than picked round: a full multi-phase
 * Sonnet build is ~3 phases × (4k input + 16k output) ≈ 3 × $0.252 ≈ $0.76,
 * and project history records an idea→prototype COGS of ~$1 on Sonnet. $2.00
 * leaves comfortable headroom for a legitimately rich build plus repair passes,
 * while still stopping the pathological case (a 10+ phase plan, or a phase
 * retry loop) an order of magnitude before it matters.
 */
export const DEFAULT_GENERATION_BUDGET_USD = 2.0

/**
 * Per-plan-tier caps, USD per generation. Tier strings are the ones
 * lib/build/build-credits.ts already normalises to ('hobbyist' is the internal
 * name for the no-card Free tier). An unknown tier gets the FREE allowance —
 * never the most generous one.
 */
export const TIER_GENERATION_BUDGET_USD: Record<string, number> = {
  hobbyist: 0.75,
  free: 0.75,
  starter: 1.5,
  pro: DEFAULT_GENERATION_BUDGET_USD,
  business: 5.0,
  enterprise: 10.0,
}

/**
 * The configured cap. GENERATION_BUDGET_USD, when set to a usable positive
 * number, is the operator escape hatch and overrides everything — including
 * the tier table. A missing, non-numeric, zero or negative value falls back to
 * the default: a NaN or 0 cap would stop every generation on its first call,
 * which is a worse outage than no cap at all.
 */
export function resolveBudgetUsd(): number {
  const raw = process.env.GENERATION_BUDGET_USD
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_GENERATION_BUDGET_USD
}

/** The cap for a given plan tier, with the env override taking precedence. */
export function budgetForTier(tier: string | undefined | null): number {
  const raw = process.env.GENERATION_BUDGET_USD
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  const key = String(tier || '').toLowerCase()
  return TIER_GENERATION_BUDGET_USD[key] ?? TIER_GENERATION_BUDGET_USD.hobbyist
}

// ── The accumulating budget ──────────────────────────────────────────────────

export type BudgetStopReason = 'exceeded_budget'

export interface GenerationBudget {
  /** Hard cap in USD for this ONE generation. */
  limitUsd: number
  /** Default model for pricing calls that do not name their own. */
  model: string
  /** Real accumulated cost across every call so far. */
  spentUsd: number
  /** How many LLM calls this generation has made (retries included). */
  calls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  /** True once a call has been refused — latching, never flaps back open. */
  stopped: boolean
  stopReason?: BudgetStopReason
}

export interface CreateBudgetOptions {
  /** Explicit cap. Omitted → resolveBudgetUsd()/budgetForTier(tier). */
  limitUsd?: number
  /** Plan tier, used for the cap when limitUsd is omitted. */
  tier?: string
  /** Default model for pricing. */
  model: string
}

export function createGenerationBudget(opts: CreateBudgetOptions): GenerationBudget {
  const configured = typeof opts.limitUsd === 'number' && Number.isFinite(opts.limitUsd) && opts.limitUsd > 0
    ? opts.limitUsd
    : (opts.tier !== undefined ? budgetForTier(opts.tier) : resolveBudgetUsd())
  return {
    limitUsd: configured,
    model: opts.model,
    spentUsd: 0,
    calls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    stopped: false,
  }
}

export interface CallUsage {
  inputTokens?: number
  outputTokens?: number
  /** Prices this one call differently — the fallback chain switches models. */
  model?: string
}

/**
 * Record one completed call's REAL usage. Returns a NEW budget.
 *
 * `calls` increments even when usage is empty: the call really happened and
 * really cost money, and a provider that omits `usage` (common on a stream
 * error) must not make the call invisible to the meter.
 */
export function recordCall(budget: GenerationBudget, usage: CallUsage): GenerationBudget {
  const inTok = safeTokens(usage?.inputTokens)
  const outTok = safeTokens(usage?.outputTokens)
  const cost = costForUsage(inTok, outTok, usage?.model || budget.model)
  return {
    ...budget,
    spentUsd: budget.spentUsd + cost,
    calls: budget.calls + 1,
    totalInputTokens: budget.totalInputTokens + inTok,
    totalOutputTokens: budget.totalOutputTokens + outTok,
    totalTokens: budget.totalTokens + inTok + outTok,
  }
}

export interface NextCallEstimate {
  /** Worst-case output tokens — pass the call's real max_tokens. */
  maxOutputTokens?: number
  /** Best estimate of the prompt size. */
  estimatedInputTokens?: number
  /** Model this call will use, if not the budget's default. */
  model?: string
}

export interface AffordDecision {
  allowed: boolean
  /** 'ok' | 'first_call' when allowed; 'would_exceed_budget' when not. */
  reason: 'ok' | 'first_call' | 'would_exceed_budget'
  /** spentUsd + the worst-case cost of the proposed call. */
  projectedUsd: number
  spentUsd: number
  limitUsd: number
}

/**
 * Pre-flight check: may this generation make ANOTHER call?
 *
 * Charged at the call's WORST CASE (its full max_tokens), which is what makes
 * this a real cap — a call allowed here can never push spend past limitUsd.
 * Defaults to APP_GEN_MAX_TOKENS, the pipeline's real per-pass ceiling.
 */
export function canAffordAnotherCall(
  budget: GenerationBudget,
  estimate: NextCallEstimate = {},
): AffordDecision {
  // Fail-open on anything malformed: no usable meter must never break generation.
  const spent = typeof budget?.spentUsd === 'number' && Number.isFinite(budget.spentUsd) ? budget.spentUsd : NaN
  const limit = typeof budget?.limitUsd === 'number' && Number.isFinite(budget.limitUsd) && budget.limitUsd > 0
    ? budget.limitUsd
    : NaN
  if (!Number.isFinite(spent) || !Number.isFinite(limit)) {
    return { allowed: true, reason: 'ok', projectedUsd: 0, spentUsd: 0, limitUsd: 0 }
  }

  const calls = typeof budget.calls === 'number' && Number.isFinite(budget.calls) ? budget.calls : 0

  const worstCase = costForUsage(
    safeTokens(estimate.estimatedInputTokens),
    estimate.maxOutputTokens === undefined ? APP_GEN_MAX_TOKENS : safeTokens(estimate.maxOutputTokens),
    estimate.model || budget.model,
  )
  const projectedUsd = spent + worstCase

  // The first call always proceeds — see the module header.
  if (calls === 0 && !budget.stopped) {
    return { allowed: true, reason: 'first_call', projectedUsd, spentUsd: spent, limitUsd: limit }
  }

  // Latched: a stopped budget stays stopped.
  if (budget.stopped) {
    return { allowed: false, reason: 'would_exceed_budget', projectedUsd, spentUsd: spent, limitUsd: limit }
  }

  if (projectedUsd > limit) {
    return { allowed: false, reason: 'would_exceed_budget', projectedUsd, spentUsd: spent, limitUsd: limit }
  }
  return { allowed: true, reason: 'ok', projectedUsd, spentUsd: spent, limitUsd: limit }
}

export interface CheckBudgetResult {
  allowed: boolean
  /** The budget, latched to stopped when the call was refused. */
  budget: GenerationBudget
  decision: AffordDecision
}

/**
 * canAffordAnotherCall(), but latching the stop onto the returned budget. Use
 * this at a loop boundary (e.g. between multi-pass phases) so that one refusal
 * ends the generation instead of being re-evaluated each iteration.
 */
export function checkBudget(
  budget: GenerationBudget,
  estimate: NextCallEstimate = {},
): CheckBudgetResult {
  const decision = canAffordAnotherCall(budget, estimate)
  if (decision.allowed) return { allowed: true, budget, decision }
  return {
    allowed: false,
    budget: { ...budget, stopped: true, stopReason: 'exceeded_budget' },
    decision,
  }
}

// ── The honest stop response ─────────────────────────────────────────────────

export interface BudgetStopMessage {
  type: 'budget_exceeded'
  /** Human-readable, with the REAL numbers in it. No fabricated precision. */
  message: string
  spentUsd: number
  limitUsd: number
  calls: number
  totalTokens: number
  /** True when at least one call succeeded, so the UI can offer what WAS built. */
  partial: boolean
}

/**
 * The structured response to return when a generation is stopped by its cost
 * cap. The founder is told the truth — generation stopped, here is what it
 * cost, here is the cap — rather than being handed a silently truncated app.
 */
export function budgetStopMessage(budget: GenerationBudget): BudgetStopMessage {
  const spentUsd = typeof budget?.spentUsd === 'number' && Number.isFinite(budget.spentUsd) ? budget.spentUsd : 0
  const limitUsd = typeof budget?.limitUsd === 'number' && Number.isFinite(budget.limitUsd) ? budget.limitUsd : 0
  const calls = typeof budget?.calls === 'number' && Number.isFinite(budget.calls) ? budget.calls : 0
  const totalTokens = typeof budget?.totalTokens === 'number' && Number.isFinite(budget.totalTokens)
    ? budget.totalTokens
    : 0

  const partial = calls > 0
  const detail = partial
    ? ` ${calls} generation ${calls === 1 ? 'step' : 'steps'} (${totalTokens.toLocaleString('en-US')} tokens) completed before stopping — anything already built is kept.`
    : ''

  return {
    type: 'budget_exceeded',
    message:
      `Generation stopped: this build reached its cost limit of $${limitUsd.toFixed(2)} ` +
      `(spent $${spentUsd.toFixed(4)}).${detail}`,
    spentUsd,
    limitUsd,
    calls,
    totalTokens,
    partial,
  }
}
