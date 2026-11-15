/**
 * Shared last-resort name derivation (#2067) — used by both `/api/build/brand`
 * (every real LLM-naming attempt failed/collided) and Intake.tsx (the brand
 * call itself failed outright) when a real brand name couldn't be invented.
 *
 * Before taking the idea's first word, strip a leading bracketed/parenthetical
 * tag (e.g. "[LOOP-TEST 2026-11-15] A simple cafe feedback board…") entirely —
 * otherwise `split(/\s+/)[0]` returns just "[LOOP-TEST" (no space between the
 * bracket and the tag text), dropping the closing bracket and the whole real
 * idea. Also strips common lead-in phrases ("I want to build a…") and any
 * stray leading/trailing punctuation left on the chosen word.
 */
export function fallbackNameFromIdea(idea: string, defaultWord = 'app'): string {
  let cleaned = (idea || '').trim()
  cleaned = cleaned.replace(/^[[(][^\])]*[\])]\s*/, '')
  cleaned = cleaned.replace(/^(i\s+want\s+to\s+build|i\s+want\s+to|build|create|make|a|an|the)\s+/gi, '')
  const token = (cleaned.split(/\s+/)[0] || '').replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
  const w = token || defaultWord
  return w.charAt(0).toUpperCase() + w.slice(1)
}
