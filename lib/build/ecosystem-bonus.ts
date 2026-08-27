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
 */
export const DEFAULT_SUBSTRATE_PRIMITIVES: ReadonlySet<string> = new Set([
  'zerodb',
  ...CATALOG.filter((p) => p.foundational).map((p) => normalize(p.name)),
])

/** Count the DISTINCT ecosystem (non-substrate) primitives in a build's composition. */
export function countEcosystemPrimitives(primitivesUsed: string[]): number {
  const distinct = new Set<string>()
  for (const raw of primitivesUsed || []) {
    if (typeof raw !== 'string') continue
    const name = normalize(raw)
    if (!name || DEFAULT_SUBSTRATE_PRIMITIVES.has(name)) continue
    distinct.add(name)
  }
  return distinct.size
}

/**
 * Bonus build allowance earned by ONE build's composition: ECOSYSTEM_BONUS_BUILDS
 * when it composes >= ECOSYSTEM_BONUS_MIN_PRIMITIVES ecosystem primitives, else 0.
 */
export function computeEcosystemBonus(primitivesUsed: string[]): number {
  return countEcosystemPrimitives(primitivesUsed) >= ECOSYSTEM_BONUS_MIN_PRIMITIVES
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
