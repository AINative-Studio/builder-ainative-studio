/**
 * Single source of truth for resolving AINative/ZeroDB's shared API key.
 *
 * Real incident (2026-09-13): AINATIVE_API_KEY and ZERODB_API_KEY drifted to
 * different values on the builder-ainative-studio Railway service —
 * AINATIVE_API_KEY was scoped to unrelated projects, not Builder's registry
 * project. ~50 files each had their own `process.env.AINATIVE_API_KEY ||
 * process.env.ZERODB_API_KEY` (or the reverse) fallback chain, so the same
 * drift silently broke a different subset of routes depending purely on
 * which env var a given file happened to check first (core#7395 fallout).
 *
 * ZERODB_API_KEY is the one confirmed correctly-scoped to Builder's real
 * ZeroDB project — check it first everywhere, with AINATIVE_API_KEY and the
 * legacy API_Key as fallbacks only for environments that never set it.
 */
export function getAinativeApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}
