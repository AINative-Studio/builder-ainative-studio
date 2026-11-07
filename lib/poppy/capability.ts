/**
 * What Builder actually DOES when a Personal Agent sends a message (#1842).
 *
 * A Poppy conversation is a Personal Agent, acting for a human, talking to
 * Builder as "the Company". The real, honest capability wired here is the one
 * Builder already has and already serves to humans: answer questions about
 * Builder from its REAL guides + Help Center FAQ corpus.
 *
 * This reuses lib/help/stuck-search.ts verbatim — the same retrieval that
 * powers the live /api/help/stuck endpoint and the "I'm stuck" box on /help
 * and /guides/[slug]. That corpus is every section of every guide in
 * lib/data/seo-guides.ts plus every entry in lib/build/help-faq.ts. It is
 * pure, local, deterministic and makes no network or model call, so a Poppy
 * reply costs nothing and cannot hallucinate: every sentence it returns is
 * real copy from a real published page, returned with the deep link a human
 * can open to read it in context.
 *
 * Deliberately NOT done here, and why:
 *  - No LLM call. There is a real model-backed Q&A route (/api/build/help),
 *    but putting an unauthenticated, externally-reachable endpoint in front
 *    of a paid model call is an open cost/abuse surface, and the retrieval
 *    corpus is the part that actually carries the real answers. Keyword Q&A
 *    over the real corpus is a complete, honest v1.
 *  - No build/draft creation. Builder requires a real account to build
 *    (anonymous-claimable builds were a false claim, corrected in #1848), so
 *    a Poppy message cannot start a real build on a real human's behalf
 *    without an authenticated account. Rather than create an orphan draft
 *    nobody can claim, a build-shaped message gets a truthful answer: here is
 *    how building works, here is where to start. The `builder:draft` scope is
 *    therefore NOT advertised in poppy.json — only what really works is.
 */

import { searchStuck, type StuckResult } from '@/lib/help/stuck-search'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

/** How many corpus hits to fold into one reply. */
const MAX_HITS = 3

/** Absolute URL for a corpus deep link, so an agent can cite it directly. */
function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE_URL}${href}`
}

/**
 * Answer a Personal Agent's message from Builder's real docs corpus.
 *
 * Always returns a truthful reply. When nothing in the corpus overlaps the
 * question, it says so plainly and points at the real entry points rather
 * than inventing an answer — the ranker returns [] for a genuine miss
 * (no fake matches), and that distinction is preserved here.
 */
export function answerMessage(text: string): { text: string; citations: string[] } {
  const question = String(text || '').trim()
  if (!question) {
    return {
      text:
        'I did not receive any question text. Ask me about what AINative Builder can build, ' +
        'how generation works, pricing, deployment, or adding data/auth/payments to a generated app.',
      citations: [],
    }
  }

  const hits: StuckResult[] = searchStuck(question, MAX_HITS)

  if (hits.length === 0) {
    return {
      text:
        "I could not find anything in AINative Builder's documentation that answers that. " +
        'AINative Builder turns a plain-language idea into a real, working web app or company, ' +
        'composing AINative primitives (ZeroDB, ZeroPipeline/CRM, ZeroCommerce, ZeroInvoice, ' +
        'ZeroVoice, ServiceOS, ZeroMemory, OpenCapStack) rather than hand-rolling business logic. ' +
        `Start at ${BASE_URL}/build, browse what is possible at ${BASE_URL}/capabilities, ` +
        `or read the guides at ${BASE_URL}/guides.`,
      citations: [`${BASE_URL}/capabilities`, `${BASE_URL}/guides`],
    }
  }

  const parts = hits.map((h) => `${h.title} — ${h.snippet} (${absolute(h.href)})`)
  return {
    text:
      `Here is what AINative Builder's documentation says about that:\n\n` +
      parts.map((p, i) => `${i + 1}. ${p}`).join('\n\n'),
    citations: hits.map((h) => absolute(h.href)),
  }
}
