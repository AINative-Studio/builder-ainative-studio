/**
 * POST /api/build/surprise-idea — LLM-generated "Surprise me" starter idea.
 *
 * Real gap this closes: lib/build/surprise-ideas.ts's SURPRISE_IDEAS was a
 * static 14-string array. Running selectPrimitives() against every one of
 * those 14 ideas showed Agent402, Model Catalog, Developer Program,
 * Community, and AINativeNGO NEVER get selected for ANY of them — none of
 * the 14 fixed sentences contain those primitives' trigger words, so no
 * matter how many times a founder clicked "Surprise me," those primitives
 * could never be showcased. A hand-curated list also silently stops covering
 * a brand-new catalog primitive the moment it's added, until someone
 * remembers to hand-write a matching idea for it.
 *
 * Fix: generate the idea live, grounded in the REAL primitive catalog, biased
 * toward whichever primitives haven't been surfaced by recent generations —
 * see lib/build/surprise-idea-generator.ts for the (unit-tested) prompt
 * construction + underrepresented-primitive tracking. This route is the thin
 * network layer: resolve the cheap LLM client, call it, sanitize/validate the
 * completion, record which real primitives it selects, and fall back to the
 * static pool (lib/build/surprise-ideas.ts) on ANY failure so a founder is
 * never left with no idea because a model call errored or timed out.
 *
 * Deliberately NOT the Claude/Bedrock codegen path (lib/build/claude-completion.ts)
 * — this is a single throwaway sentence, not a generation step, so it uses the
 * same cheap AINative-proxied completion client app/api/chat/route.ts already
 * calls in production, not the more expensive Claude tier.
 *
 * MODEL CHOICE — real, live comparison (not a guess), 2026-09-05: ran the exact
 * prompt this route builds against gpt-oss-120b, llama-4-maverick-17b-128e, and
 * kimi-k2 (3 samples each) via the real AINative chat-completions endpoint.
 * kimi-k2 failed outright at both 200 and 600 max_tokens — it spent the entire
 * completion budget on invisible reasoning tokens and returned empty content
 * every time (finish_reason "length", content ""). gpt-oss-120b did the same at
 * 200 tokens; at 600 tokens it produced coherent, catalog-grounded output but
 * took 4.7-11.8s per call. llama-4-maverick-17b-128e was the only model that
 * reliably produced a coherent, on-tone, catalog-grounded idea AT the shipped
 * 200-token budget, in 1.6-3.5s — 2-5x faster than the other two, and among the
 * cheapest models in the catalog on real per-token pricing (input $0.224/M,
 * output $0.448/M — tied for cheapest, well under gpt-oss-120b's $0.35/$0.75
 * and kimi-k2's $0.25/$1.00). "Surprise me" is a single click a founder expects
 * to feel instant, so latency matters as much as quality here — maverick wins
 * on both, plus cost. (The catalog's own `tier: "free"` label on these models is
 * a known mislabeling bug upstream in core's Model Catalog API, not a real
 * pricing signal — the pricing figures above are the real per-token numbers
 * from that same catalog response.)
 *
 * PER-USER REPETITION FIX (issue #755, 2026-09-14): live production testing
 * showed the LLM path itself is healthy (0/7 real calls fell back — the
 * static pool is NOT the cause of the reported repetition), but a real
 * founder clicking "Surprise me" repeatedly in one sitting saw near-duplicate
 * ideas ("A field service management platform that automates scheduling and
 * invoicing..." three times in a row). Root cause: `recentPrimitiveHistory`
 * below is process-scoped (shared across ALL users on one replica, a no-op
 * across replicas) AND only steers toward underrepresented PRIMITIVE
 * CATEGORIES, not away from similar idea CONCEPTS — two ideas can trivially
 * invoke the same primitive while reading as near-duplicates. Fix: the client
 * (BuildStart.tsx) now tracks the actual idea TEXT it has shown this founder
 * this session and sends it as `recentIdeas` in the POST body; this route
 * passes that real per-session history into buildSurpriseIdeaPrompt, which
 * quotes it back to the model as concrete negative examples. The process-
 * scoped primitive-category steer is kept alongside it (still useful for
 * catalog coverage) — the two signals are complementary, not redundant.
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { CATALOG, selectPrimitives } from '@/lib/build/primitive-catalog'
import {
  buildSurpriseIdeaPrompt,
  sanitizeSurpriseIdea,
  isUsableSurpriseIdea,
  RECENT_HISTORY_WINDOW,
  RECENT_IDEA_TEXT_WINDOW,
} from '@/lib/build/surprise-idea-generator'
import { pickSurpriseIdea } from '@/lib/build/surprise-ideas'
import { getAinativeApiKey } from '@/lib/build/env-keys'

export const runtime = 'nodejs'

const llama = new OpenAI({
  apiKey: getAinativeApiKey(),
  baseURL: (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1',
})

/** How long we'll wait on the LLM before falling back to the static pool —
 *  "Surprise me" is a single click a founder expects to feel instant; a hung
 *  provider call must never leave the button spinning indefinitely. */
const REQUEST_TIMEOUT_MS = 8000

/**
 * In-memory, server-lifetime record of which real primitives recent
 * generations surfaced (most-recent last). Deliberately not persisted —
 * per-process recency is enough to stop the model drifting back to the same
 * handful of primitives across consecutive clicks; it doesn't need to survive
 * a restart or be shared across replicas to do its job.
 */
let recentPrimitiveHistory: string[][] = []

/** Exposed for tests: reset the module-level history between cases. */
export function __resetSurpriseIdeaHistoryForTests(): void {
  recentPrimitiveHistory = []
}

function recordHistory(names: string[]): void {
  recentPrimitiveHistory.push(names)
  if (recentPrimitiveHistory.length > RECENT_HISTORY_WINDOW) {
    recentPrimitiveHistory = recentPrimitiveHistory.slice(-RECENT_HISTORY_WINDOW)
  }
}

/** Parse+validate the client-supplied per-session idea history. Defensive
 *  against a missing/malformed body — this is a best-effort steering signal,
 *  never something that should turn a malformed request into a 400; an
 *  absent or bad `recentIdeas` just means the concept-similarity steer sits
 *  out for this call, same as a cold session. */
function parseRecentIdeas(body: unknown): string[] {
  const raw = (body as { recentIdeas?: unknown } | null)?.recentIdeas
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim().slice(0, 400))
    .slice(-RECENT_IDEA_TEXT_WINDOW)
}

/** One real model call. Returns null on any failure — timeout, network error,
 *  empty/unusable completion — so the caller falls through to the static pool. */
async function generateIdea(recentIdeas: string[]): Promise<string | null> {
  const { system, user } = buildSurpriseIdeaPrompt(CATALOG, recentPrimitiveHistory, recentIdeas)
  try {
    const model = process.env.SURPRISE_IDEA_MODEL || 'llama-4-maverick-17b-128e'
    const res = await llama.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.9,
        max_tokens: 200,
      },
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    )
    const raw = res.choices?.[0]?.message?.content || ''
    const idea = sanitizeSurpriseIdea(raw)
    return isUsableSurpriseIdea(idea) ? idea : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const recentIdeas = parseRecentIdeas(body)
  const idea = await generateIdea(recentIdeas)

  if (idea) {
    // Track which REAL primitives this generation actually surfaces (company
    // track — "Surprise me" always seeds the company-track funnel, see
    // BuildStart.tsx) so the next call's steer favors what this one didn't.
    const { names } = selectPrimitives(idea, 'company')
    recordHistory(names)
    return Response.json({ idea, source: 'llm' })
  }

  // Fail open: any model failure (timeout, network error, unusable output)
  // falls back to the existing static pool rather than leaving the founder
  // stuck on a "Surprise me" click with nothing to show.
  return Response.json({ idea: pickSurpriseIdea(null), source: 'fallback' })
}
