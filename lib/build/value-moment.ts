/**
 * Value-moment sequencing (#310 GR-01 · #311 GR-02 · #320 GR-11).
 *
 * The Greg Rose interview cluster: the founder must SEE their working app
 * before any hard paywall, the card ask must come AFTER that value moment, and
 * the deeper build-out is offered MVP-first with an explicit, honest cost.
 *
 * Pure module — no React, no I/O. Every sequencing/gating decision the
 * components make around the preview→pricing ordering lives here so it's
 * deterministic and unit-covered:
 *
 *   - decideLimitAction():  what to do when the credits API says 402 — a founder
 *     who has NEVER seen a working preview is never routed to pricing (the build
 *     proceeds; the server's value guarantee allows it too — see
 *     applyValueGuarantee in build-credits.ts).
 *   - shouldShowMvpUpsell(): the MVP-first upsell banner appears only once the
 *     preview has actually rendered (never over a skeleton or an error state).
 *   - estimateSprintTokens() / sprintCostLine(): the explicit "this sprint costs
 *     N tokens" figure. No per-sprint cost exists server-side, so this is an
 *     ESTIMATE computed from the REAL per-call caps of the generation pipeline
 *     and the plan token allowances — and it is labeled as an estimate. No
 *     fabricated precision.
 *   - pricingFraming(): the Pricing headline claims "your prototype works" only
 *     when the founder has actually seen it work.
 */

// ── Real generation-pipeline caps (grounded, not invented) ────────────────────
// Prose artifact generation cap — app/api/build/artifact/route.ts (max_tokens).
export const ARTIFACT_MAX_TOKENS = 1600
// Full app generation cap per pass — app/api/chat-ws/route.ts (max_tokens 16000).
export const APP_GEN_MAX_TOKENS = 16000

/**
 * Monthly token allowances by plan — the SAME figures the pricing tiers publish
 * (components/build/screens/Pricing.tsx TIERS features / lib/build/pricing-tiers.ts).
 * Used to express the sprint estimate as a share of a plan, honestly.
 */
export const PLAN_TOKEN_ALLOWANCES: Record<string, number> = {
  pro: 1_000_000,
  business: 5_000_000,
  enterprise: 20_000_000,
}

export interface SprintEstimate {
  /** Estimated total tokens for the sprint, rounded UP to the nearest 1,000. */
  tokens: number
  /** Always true — this figure is an estimate, and the UI must say so. */
  isEstimate: true
  breakdown: {
    /** Prose artifacts (PRD, data model, sprint plan, …) × per-artifact cap. */
    artifacts: number
    /** Full app build passes (generation + repair) × per-pass cap. */
    appBuild: number
    /** Business systems wired around the app × per-artifact-scale call. */
    systems: number
  }
}

/**
 * Estimate the token cost of the deeper build-out sprint (full PRD + sprint
 * plan + app build passes + business-system wiring) from the real per-call
 * caps of the generation pipeline. Deterministic; rounds UP to the nearest
 * 1,000 so we never understate.
 *
 * @param opts.proseArtifacts  Number of prose artifacts in the sprint (the app
 *                             track generates 10: brief→sprintPlan).
 * @param opts.systems         Business systems Cody wires (proposal caps at 4).
 * @param opts.appBuildPasses  Full app generation passes (default 2 — build +
 *                             repair, mirroring the pipeline's correction pass).
 */
export function estimateSprintTokens(opts: {
  proseArtifacts: number
  systems: number
  appBuildPasses?: number
}): SprintEstimate {
  const proseArtifacts = Math.max(0, Math.floor(opts.proseArtifacts))
  const systems = Math.max(0, Math.floor(opts.systems))
  const passes = Math.max(1, Math.floor(opts.appBuildPasses ?? 2))

  const artifacts = proseArtifacts * ARTIFACT_MAX_TOKENS
  const appBuild = passes * APP_GEN_MAX_TOKENS
  const sys = systems * ARTIFACT_MAX_TOKENS

  const raw = artifacts + appBuild + sys
  const tokens = Math.ceil(raw / 1000) * 1000

  return { tokens, isEstimate: true, breakdown: { artifacts, appBuild, systems: sys } }
}

/**
 * The default sprint shape for the MVP-first upsell: the full 10-artifact app
 * track (brief→sprintPlan), 2 app build passes, 4 business systems (the
 * proposal's cap). ≈55,000 tokens.
 */
export function defaultSprintEstimate(): SprintEstimate {
  return estimateSprintTokens({ proseArtifacts: 10, systems: 4, appBuildPasses: 2 })
}

/**
 * What share of a plan's monthly token allowance the sprint consumes, as a
 * whole percent (rounded up — never understate). Null when the plan has no
 * published allowance (free/starter are build-metered, not token-metered).
 */
export function sprintShareOfPlan(tokens: number, planId: string): number | null {
  const allowance = PLAN_TOKEN_ALLOWANCES[planId]
  if (!allowance || tokens <= 0) return null
  return Math.ceil((tokens / allowance) * 100)
}

/**
 * The explicit cost line for the MVP-first upsell (#320): real caps, honest
 * "estimate" label, tied to the recommended plan's published allowance.
 *
 * e.g. "This sprint costs ≈55,000 tokens — about 6% of Pro's 1M-token monthly
 *       allowance (estimate)."
 */
export function sprintCostLine(
  estimate: SprintEstimate,
  plan: { id: string; name: string },
): string {
  const tokens = estimate.tokens.toLocaleString('en-US')
  const share = sprintShareOfPlan(estimate.tokens, plan.id)
  const allowance = PLAN_TOKEN_ALLOWANCES[plan.id]
  if (share !== null && allowance) {
    const allowanceLabel = allowance >= 1_000_000
      ? `${allowance / 1_000_000}M`
      : allowance.toLocaleString('en-US')
    return `This sprint costs ≈${tokens} tokens — about ${share}% of ${plan.name}'s ${allowanceLabel}-token monthly allowance (estimate).`
  }
  return `This sprint costs ≈${tokens} tokens (estimate).`
}

/**
 * The "free builds remaining" line for the upsell, from the REAL credits API
 * response (GET /api/build/credits). '' when unlimited or the shape is off —
 * we never fabricate a number.
 */
export function buildsRemainingLine(status: {
  used?: number
  limit?: number
  unlimited?: boolean
} | null): string {
  if (!status || status.unlimited) return ''
  const used = status.used
  const limit = status.limit
  if (typeof used !== 'number' || typeof limit !== 'number' || limit <= 0) return ''
  return `You've used ${Math.min(used, limit)} of ${limit} free builds.`
}

// ── Gating decisions ─────────────────────────────────────────────────────────

export type LimitAction = 'build' | 'pricing'

/**
 * What the client does when the credits API reports the build limit (#311).
 * The rule: NO card gate before the first working preview. A founder who has
 * never seen a preview proceeds to build (fail toward value — the server's
 * value guarantee allows this too); one who HAS seen the value moment is
 * routed to pricing.
 */
export function decideLimitAction(opts: {
  limitReached: boolean
  sawPreview: boolean
}): LimitAction {
  if (!opts.limitReached) return 'build'
  return opts.sawPreview ? 'pricing' : 'build'
}

/**
 * The MVP-first upsell (#320) shows only AFTER the value moment: the MVP is
 * done AND the preview actually rendered (status 'ready'). Never over a
 * skeleton, an error state, or mid-generation.
 */
export function shouldShowMvpUpsell(opts: {
  builtMVP: boolean
  previewStatus: string
}): boolean {
  return opts.builtMVP && opts.previewStatus === 'ready'
}

// ── Pricing-screen honesty ───────────────────────────────────────────────────

export interface PricingFraming {
  headline: string
  sub: string
  /** Show a "see your app first" escape back to the preview (value before card). */
  showSeePreviewFirst: boolean
}

/**
 * The Pricing screen's framing must be honest about what the founder has
 * actually experienced (#310/#311). "Your prototype works" is only claimable
 * once they've SEEN it work; before that, the screen offers the preview first.
 */
export function pricingFraming(opts: {
  sawPreview: boolean
  companyName?: string
  appSub?: string
  hasBuild?: boolean
}): PricingFraming {
  const name = (opts.companyName || '').trim() || 'it'
  const sub = (opts.appSub || '').trim() || 'your-app'
  if (opts.sawPreview) {
    return {
      headline: 'Your prototype works. Let’s make it real.',
      sub: `I built ${name} for free — live at builder.ainative.studio/build/${sub}. To put it in front of real users and let me run the company around it, pick how far we go. You own 100%.`,
      showSeePreviewFirst: false,
    }
  }
  if (opts.hasBuild) {
    return {
      headline: 'See your app work first.',
      sub: `I’m building ${name} for free — you should kick the tires before you decide anything. The plans below are here when you’re ready.`,
      showSeePreviewFirst: true,
    }
  }
  return {
    headline: 'Pick how far we go.',
    sub: 'Your first builds are free — no card required. Start with an idea and I’ll show you a working prototype before you pay anything.',
    showSeePreviewFirst: false,
  }
}
