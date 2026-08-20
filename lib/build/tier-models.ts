/**
 * Tiered model selection for builder-pivot artifact generation (#207).
 *
 * The autoplay driver fires 6–11 generations per build, so model choice is both
 * a cost and a UX lever. We map each AINative plan tier to the Bedrock Claude
 * model that best fits it. Verified live on the account (2026-08-19):
 *   - Haiku 4.5  — ~2× faster (2.4–3.6s), tight/correct → free/entry tier
 *   - Sonnet 4.5 — balanced quality/speed (6–7s)        → mid tier
 *   - Opus 4.5   — sharpest, most specific (~5–7s)       → top/paid tiers
 * (Sonnet 4, Opus 4/4.1, 3.5/3.7 are EOL or Legacy-locked on this account.)
 *
 * Tier keys come from lib/ainative/plan.ts (normalizeTier): hobbyist | pro |
 * scale | enterprise. Anything unknown falls back to hobbyist.
 */

export type Tier = 'hobbyist' | 'pro' | 'scale' | 'enterprise'

/** Bedrock inference-profile IDs — the model actually invoked for each tier. */
export const BEDROCK_MODEL_BY_TIER: Record<Tier, string> = {
  hobbyist: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  pro: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  scale: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  enterprise: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
}

/** AINative chat-completions model name (fallback path) per tier. */
export const AINATIVE_MODEL_BY_TIER: Record<Tier, string> = {
  hobbyist: 'claude-haiku-4.5',
  pro: 'claude-sonnet-4.5',
  scale: 'claude-sonnet-4.5',
  enterprise: 'claude-opus-4.5',
}

/** Human label for logging / the "PoweringThis" UI. */
export const MODEL_LABEL_BY_TIER: Record<Tier, string> = {
  hobbyist: 'Claude Haiku 4.5 (Amazon Bedrock)',
  pro: 'Claude Sonnet 4.5 (Amazon Bedrock)',
  scale: 'Claude Sonnet 4.5 (Amazon Bedrock)',
  enterprise: 'Claude Opus 4.5 (Amazon Bedrock)',
}

const VALID: ReadonlySet<string> = new Set(['hobbyist', 'pro', 'scale', 'enterprise'])

/** Coerce any incoming tier string to a known Tier (defaults to hobbyist). */
export function coerceTier(tier: string | null | undefined): Tier {
  const t = (tier || '').toLowerCase()
  return (VALID.has(t) ? t : 'hobbyist') as Tier
}

export interface TierModels {
  tier: Tier
  bedrockModel: string
  ainativeModel: string
  label: string
}

/** Resolve the full model set for a tier. */
export function modelsForTier(tier: string | null | undefined): TierModels {
  const t = coerceTier(tier)
  return {
    tier: t,
    bedrockModel: BEDROCK_MODEL_BY_TIER[t],
    ainativeModel: AINATIVE_MODEL_BY_TIER[t],
    label: MODEL_LABEL_BY_TIER[t],
  }
}
