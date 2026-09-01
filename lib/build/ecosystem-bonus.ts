/**
 * Ecosystem runway bonus (#324 GR-15, in-ecosystem-runway half).
 *
 * Builds that genuinely COMPOSE AINative primitives get more free runway before
 * the upgrade wall: a build that composes >= ECOSYSTEM_BONUS_MIN_PRIMITIVES
 * ecosystem primitives (beyond the default substrate every build gets — ZeroDB
 * plus the other foundational primitives) earns ECOSYSTEM_BONUS_BUILDS extra
 * build allowance, capped at ECOSYSTEM_BONUS_MAX_TOTAL total so the free tier
 * stays finite.
 *
 * WHY the substrate is excluded: every build is wired with the foundational
 * primitives (ZeroDB, Instant DB, ZeroMemory, AI Kit, Agent Cloud) regardless
 * of the idea — counting them would make the "bonus" universal and therefore
 * meaningless/dishonest. The bonus rewards the idea-matched business-ops layer
 * (ZeroInvoice, ZeroPipeline, ZeroCommerce, ZeroVoice, …) that only appears
 * when the founder's idea actually calls for it.
 *
 * DETERMINISM + SERVER ENFORCEMENT: these are pure functions. The credits API
 * route derives `primitivesUsed` server-side from the SAME deterministic
 * selection the composition pipeline uses (selectPrimitives(idea, track) in
 * lib/build/primitive-catalog.ts) and persists it with each recorded build —
 * a client can never hand the server an inflated primitives list.
 */

import { CATALOG } from '@/lib/build/primitive-catalog'

/**
 * A primitive's `foundational` flag counts as substrate on this track.
 *
 * OpenCapStack carries the same nonprofit carve-out as `selectPrimitives`
 * (#302/#443 follow-up): it's real, unconditional company-track substrate
 * EXCEPT for a nonprofit idea, where a founder composing it (via AINativeNGO's
 * own trigger words matching) should still count toward the ecosystem bonus
 * rather than be silently discounted as "always there anyway."
 */
function isSubstrateOnTrack(
  primitive: { name: string; foundational?: boolean | 'company'; triggers: string[] },
  track: 'app' | 'company',
  idea: string,
): boolean {
  if (primitive.name === 'OpenCapStack' && track === 'company') {
    const hay = ` ${(idea || '').toLowerCase()} `
    const ngo = CATALOG.find((p) => p.name === 'AINativeNGO')
    const isNonprofitIdea = ngo?.triggers.some((t) => hay.includes(` ${t}`) || hay.includes(`${t} `) || hay.includes(t)) ?? false
    return !isNonprofitIdea
  }
  if (primitive.foundational === true) return true
  if (primitive.foundational === 'company') return track === 'company'
  return false
}

/** Extra build allowance granted per qualifying (>= min primitives) build. */
export const ECOSYSTEM_BONUS_BUILDS = 1

/** Distinct ecosystem primitives (beyond the default substrate) a build must compose to qualify. */
export const ECOSYSTEM_BONUS_MIN_PRIMITIVES = 2

/** Cap on the TOTAL bonus an owner can accumulate — free runway stays finite. */
export const ECOSYSTEM_BONUS_MAX_TOTAL = 2

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * The default substrate every build gets regardless of the idea: ZeroDB plus
 * the catalog's foundational primitives. Derived from the catalog so the two
 * never drift; 'zerodb' is also listed explicitly per the GR-15 spec ("beyond
 * the default ZeroDB") in case its foundational flag ever changes.
 *
 * Track-scoped: a `foundational: 'company'` primitive (e.g. OpenCapStack —
 * #427 auto-provisions its real cap table for every company unconditionally,
 * so it's genuine substrate there) is ONLY substrate on the company track.
 * On the app track it isn't auto-provisioned at all, so a founder whose idea
 * genuinely trigger-matches it should still earn ecosystem-bonus credit for
 * composing it — excluding it universally would silently under-count that.
 *
 * `idea` defaults to '' (no nonprofit signal) so existing callers that don't
 * have the idea text handy keep today's behavior (OpenCapStack as substrate
 * on the company track) rather than silently changing shape.
 */
export function defaultSubstratePrimitives(track: 'app' | 'company' = 'company', idea = ''): ReadonlySet<string> {
  return new Set([
    'zerodb',
    ...CATALOG.filter((p) => isSubstrateOnTrack(p, track, idea)).map((p) => normalize(p.name)),
  ])
}

/** @deprecated Use `defaultSubstratePrimitives(track)` — this fixed set assumes the company track. */
export const DEFAULT_SUBSTRATE_PRIMITIVES: ReadonlySet<string> = defaultSubstratePrimitives('company')

/** Count the DISTINCT ecosystem (non-substrate) primitives in a build's composition. */
export function countEcosystemPrimitives(primitivesUsed: string[], track: 'app' | 'company' = 'company', idea = ''): number {
  const substrate = defaultSubstratePrimitives(track, idea)
  const distinct = new Set<string>()
  for (const raw of primitivesUsed || []) {
    if (typeof raw !== 'string') continue
    const name = normalize(raw)
    if (!name || substrate.has(name)) continue
    distinct.add(name)
  }
  return distinct.size
}

/**
 * Bonus build allowance earned by ONE build's composition: ECOSYSTEM_BONUS_BUILDS
 * when it composes >= ECOSYSTEM_BONUS_MIN_PRIMITIVES ecosystem primitives, else 0.
 *
 * `track` defaults to 'company' (recorded builds don't persist their track
 * today) — deliberately the conservative default: a 'company'-foundational
 * primitive like OpenCapStack is excluded as substrate either way this
 * defaults, so this only under-counts the rare app-track build whose idea
 * happens to trigger-match a primitive that's foundational-for-company only.
 */
export function computeEcosystemBonus(primitivesUsed: string[], track: 'app' | 'company' = 'company'): number {
  return countEcosystemPrimitives(primitivesUsed, track) >= ECOSYSTEM_BONUS_MIN_PRIMITIVES
    ? ECOSYSTEM_BONUS_BUILDS
    : 0
}

/**
 * Total bonus across an owner's recorded builds (one primitives list per build),
 * capped at ECOSYSTEM_BONUS_MAX_TOTAL. This is what raises the 402 threshold.
 */
export function computeTotalEcosystemBonus(perBuildPrimitives: string[][]): number {
  let total = 0
  for (const list of perBuildPrimitives || []) {
    total += computeEcosystemBonus(list)
    if (total >= ECOSYSTEM_BONUS_MAX_TOTAL) return ECOSYSTEM_BONUS_MAX_TOTAL
  }
  return total
}

/**
 * Cody's line for the moment the bonus is earned. First person, no hype.
 * `composed` = the ecosystem primitive count that earned it; `bonus` = builds granted.
 */
export function ecosystemBonusMessage(composed: number, bonus: number): string {
  const unit = bonus === 1 ? 'build' : 'builds'
  return `You composed ${composed} AINative primitives — I extended your free runway by ${bonus} ${unit}.`
}
