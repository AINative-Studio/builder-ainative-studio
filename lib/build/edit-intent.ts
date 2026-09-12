/**
 * Edit-intent detection (#582) — distinguishes a real change request ("change
 * the hero headline to X", "add a dark mode toggle") from a plain question
 * ("what does this app do", "why isn't my domain live") in the "Ask Cody
 * anything" Live-dashboard chat.
 *
 * Deliberately a cheap, deterministic pattern match — NOT a second LLM call.
 * Real gap this closes: ask/route.ts previously told founders "there's still
 * NO in-dashboard editor" for every change request, no matter how explicit,
 * because no code path ever attempted to apply one. Confirmed via a real
 * user bug report (WhatsApp screenshot, product "dedux"): a follow-up
 * conversational request was never actually applied to the live app.
 *
 * Conservative by design: a false negative just falls through to the
 * existing conversational reply (safe, no behavior change). A false
 * positive would trigger a real LLM code-edit + git commit, so precision
 * matters more than recall here — only fire on an unambiguous imperative
 * verb aimed at the app itself, not a question ABOUT making changes.
 */

const EDIT_VERBS = [
  'change', 'update', 'add', 'remove', 'delete', 'fix', 'make', 'rename',
  'move', 'replace', 'swap', 'adjust', 'edit', 'redesign', 'restyle',
  'increase', 'decrease', 'hide', 'show', 'disable', 'enable',
]

const QUESTION_STARTERS = /^(what|why|how|when|where|who|is|are|can|could|should|do|does|did)\b/i

export function detectEditIntent(question: string): boolean {
  const q = String(question || '').trim().toLowerCase()
  if (!q) return false

  // A question about the possibility of a change ("can you change...?",
  // "how do I change...?") is a question, not a command — never an edit.
  if (QUESTION_STARTERS.test(q)) return false
  if (q.endsWith('?')) return false

  // Must open with (or very early contain) a real imperative edit verb.
  // "please change the headline" / "change the headline" / "can we change" —
  // the last is caught by QUESTION_STARTERS above via "can".
  const firstWords = q.replace(/^(please|hey cody|cody|can you|could you)[,\s]+/i, '').trim()
  const opensWithVerb = EDIT_VERBS.some((v) => new RegExp(`^${v}\\b`).test(firstWords))
  if (!opensWithVerb) return false

  return true
}
