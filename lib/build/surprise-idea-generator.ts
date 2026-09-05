/**
 * LLM-generated "Surprise me" starter idea (builder issue: the static
 * SURPRISE_IDEAS pool structurally can never surface most of the catalog —
 * see lib/build/surprise-ideas.ts. A hand-curated string array only ever
 * triggers whichever primitives happen to share a trigger word with one of
 * its fixed sentences; adding a new catalog primitive silently does nothing
 * for "Surprise me" until someone remembers to hand-write a matching idea.
 *
 * This module is the pure, unit-testable half of the fix: given the real
 * catalog (name + purpose for every entry) and a short history of which
 * primitives recent "Surprise me" generations already surfaced, build a
 * prompt that (a) grounds the model in the REAL product catalog so it can't
 * invent a fake primitive, and (b) explicitly steers it toward whichever
 * primitives haven't shown up recently, so the fix is self-correcting as the
 * catalog grows instead of another list someone has to remember to update.
 *
 * The actual network call (which model, which provider) lives in
 * app/api/build/surprise-idea/route.ts — kept separate so the prompt-
 * construction and recency-tracking logic can be tested deterministically
 * without mocking a network client.
 */

import type { CatalogPrimitive } from './primitive-catalog'

/** How many of the most recent generations count as "recently surfaced" —
 *  large enough that a genuinely rotating set of ~14 business-ops primitives
 *  doesn't get immediately re-suggested, small enough that the model isn't
 *  steered away from a primitive it hasn't seen in a very long time. */
export const RECENT_HISTORY_WINDOW = 8

/**
 * Given the primitives surfaced by the last N generations (most-recent last,
 * same convention as an append-only log), return the catalog's primitive
 * names that have NOT appeared in that recent window — the ones the next
 * generation should be biased toward. Falls back to the full catalog name
 * list when there is no history yet (first call since server start) or when
 * every primitive has recently appeared (nothing to bias toward — let the
 * model pick freely from the full catalog rather than an empty steer list).
 */
export function underrepresentedPrimitives(
  catalog: Pick<CatalogPrimitive, 'name'>[],
  recentHistory: string[][],
): string[] {
  const window = recentHistory.slice(-RECENT_HISTORY_WINDOW)
  const recentlySeen = new Set<string>()
  for (const names of window) {
    for (const name of names) recentlySeen.add(name)
  }
  const allNames = catalog.map((p) => p.name)
  const underrepresented = allNames.filter((n) => !recentlySeen.has(n))
  return underrepresented.length > 0 ? underrepresented : allNames
}

/** Compact "Name: purpose" catalog listing for the prompt — the FULL real
 *  catalog, not a hardcoded subset, so the model can't be anchored on the
 *  same handful of primitives the old static pool always reached for. */
function catalogListing(catalog: Pick<CatalogPrimitive, 'name' | 'purpose'>[]): string {
  return catalog.map((p) => `- ${p.name}: ${p.purpose}`).join('\n')
}

export const SURPRISE_IDEA_SYSTEM_PROMPT =
  'You invent ONE concrete, plausible, on-brand startup/app idea for a "Surprise me" button on an AI app-builder. ' +
  'Match this exact tone and shape: a single sentence, concrete and specific (not vague), phrased like ' +
  '"An X that Ys" or "A X that Ys" — e.g. "A support copilot that resolves tickets from your knowledge base and ' +
  'escalates only what it can\'t." or "A headless storefront where an AI shopping assistant answers product ' +
  'questions and completes checkout." Never mention the platform, the catalog, or any internal product name in ' +
  'the sentence itself — just describe the idea in plain, real-world business language, using words a founder ' +
  'would actually type, so the idea naturally implies the capabilities below without naming them. ' +
  'Return ONLY the single idea sentence — no quotes, no preamble, no markdown, no explanation.'

/**
 * Build the user-turn prompt: the real catalog for grounding, plus an
 * explicit steer toward the underrepresented primitives so repeated clicks
 * actually explore the catalog instead of drifting back to the same handful.
 */
export function buildSurpriseIdeaPrompt(
  catalog: Pick<CatalogPrimitive, 'name' | 'purpose'>[],
  recentHistory: string[][],
): { system: string; user: string; steerTowards: string[] } {
  const steerTowards = underrepresentedPrimitives(catalog, recentHistory)
  // Cap the steer list at a handful of names in the prompt itself — the model
  // only needs to compose 2-4 real primitives per idea, so listing every
  // underrepresented name (could be most of the catalog on a cold start)
  // would dilute the steer into "everything," which is no steer at all.
  const steerSample = steerTowards.slice(0, 6)
  const user =
    `REAL PRIMITIVE CATALOG (the only real capabilities that exist — do not invent others):\n${catalogListing(catalog)}\n\n` +
    `Invent ONE new idea that would plausibly compose 2-4 of these real primitives together. ` +
    `Favor an idea that naturally calls for one or more of these UNDERREPRESENTED primitives (they haven't come up ` +
    `in recent "Surprise me" picks, so lean toward covering NEW ground rather than the usual suspects): ` +
    `${steerSample.join(', ')}.\n` +
    `The idea must still read as a normal, plausible business — do not force an unnatural mash-up just to hit ` +
    `every primitive on the steer list.`
  return { system: SURPRISE_IDEA_SYSTEM_PROMPT, user, steerTowards: steerSample }
}

/** Strip wrapping quotes/markdown/preamble the model might still add despite
 *  the instruction, and enforce a sane length so a runaway completion never
 *  reaches the client as a multi-paragraph blob. */
export function sanitizeSurpriseIdea(raw: string): string {
  let s = (raw || '').trim()
  // Strip a leading/trailing single or double quote pair.
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    s = s.slice(1, -1).trim()
  }
  // Strip a markdown bullet/number prefix if the model added one anyway.
  s = s.replace(/^[-*\d.)\s]+/, '').trim()
  // First line only — a runaway completion must never surface as multiple sentences of preamble.
  s = s.split('\n')[0].trim()
  return s.slice(0, 400)
}

/** A sanitized completion is usable only if it's non-empty prose of a
 *  plausible length — guards against the model returning an empty string,
 *  a single word, or a clearly-broken fragment. */
export function isUsableSurpriseIdea(idea: string): boolean {
  return idea.length >= 20 && idea.length <= 400 && /[a-zA-Z]/.test(idea)
}
