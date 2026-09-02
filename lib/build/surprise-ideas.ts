/**
 * "Surprise me" starter-idea pool + selection logic (BuildStart.tsx). Split
 * out as pure, injectable-random logic so the no-immediate-repeat guarantee
 * is unit-testable without a full component/DOM harness — component tests
 * for this repo are lighter-weight than lib/build's own coverage (see
 * vitest.config.ts's coverage.include scope), and the actual bug this fixes
 * (the pool was 5 ideas, deterministically minute-bucketed —
 * Math.floor(Date.now()/60000) % 5 — so repeated clicks within the same
 * minute always returned the identical idea) lived entirely in this
 * selection logic, not in any DOM/render behavior.
 */

/** A varied pool of concrete starter ideas, spanning distinct business
 *  categories (support, sales, commerce, finance, ops, research, data
 *  collection, telephony, HR, equity) so back-to-back picks don't all land
 *  on the same "AI agent reviews X" shape. Kept concrete + on-brand (real,
 *  buildable AI-native companies). */
export const SURPRISE_IDEAS = [
  'An AI answer engine that replies from a company’s own docs and tools, with citations.',
  'A nightly agent that reviews a startup’s pipeline and drafts the next-best outreach for each deal.',
  'A support copilot that resolves tickets from your knowledge base and escalates only what it can’t.',
  'An invoicing service where closed deals auto-bill and reconcile against the cap table.',
  'A research assistant that monitors a market and files a morning brief on what changed and why.',
  'A headless storefront where an AI shopping assistant answers product questions and completes checkout.',
  'A booking + reminder service that calls or texts customers to confirm appointments and reduce no-shows.',
  'A form-driven intake tool that turns survey responses into a live, queryable dataset with zero code.',
  'A lightweight bookkeeping service that categorizes transactions and drafts a monthly close automatically.',
  'A cap-table and investor-update tool that turns a spreadsheet of SAFEs into a real, sharable equity story.',
  'An inventory and reorder assistant that watches stock levels across a small warehouse and flags shortfalls early.',
  'A hiring pipeline tracker that screens resumes against a role and drafts interview questions for each candidate.',
  'A helpdesk that triages incoming tickets by urgency and drafts a first-response reply for a human to approve.',
  'A workflow builder where a non-technical team can chain together AI steps into a repeatable business process.',
] as const

/**
 * Pick a random idea from the pool, re-rolling once if it would immediately
 * repeat `previous` — a real click handler concern, not a render concern, so
 * real randomness (not a deterministic clock-bucketed index) is safe here.
 * `rand` is injectable (defaults to Math.random) purely so tests can drive
 * exact outcomes without flakiness.
 */
export function pickSurpriseIdea(previous: string | null, rand: () => number = Math.random): string {
  const first = SURPRISE_IDEAS[Math.floor(rand() * SURPRISE_IDEAS.length)]
  if (first !== previous || SURPRISE_IDEAS.length <= 1) return first
  // One re-roll is enough at this pool size to make an immediate repeat rare
  // without a while-loop edge case (guaranteed termination either way).
  return SURPRISE_IDEAS[Math.floor(rand() * SURPRISE_IDEAS.length)]
}
