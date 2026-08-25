/**
 * Help Center FAQ knowledge base + lightweight retrieval (#60).
 *
 * This is the grounding layer for the AI "Ask anything" box on /help. It is a
 * curated FAQ knowledge base (single source of truth) plus a dependency-free
 * keyword-overlap retriever that selects the most relevant FAQ entries for a
 * user's question. The selected entries are formatted into a compact context
 * block that the /api/build/help route feeds to Claude as grounding — so answers
 * stay factual about Builder/AINative and never hallucinate features.
 *
 * Design notes:
 *  - No external deps and no network: retrieval is a pure function so it is fully
 *    unit-testable and cheap (runs before every model call).
 *  - The FAQ entries double as SSR + FAQPage JSON-LD content on /help (AEO), so
 *    this module is imported by BOTH the page (crawlable Q&A) and the API
 *    (RAG grounding).
 *
 * Keep FAQ_ENTRIES in sync with:
 *   - app/help/page.tsx (renders the FAQ section + FAQPage JSON-LD)
 *   - app/api/build/help/route.ts (grounds Claude with retrieveFaq output)
 */

/** A single curated FAQ entry. */
export interface FaqEntry {
  /** Stable id (kebab-case) — used as a React key and anchor. */
  id: string
  /** The question, phrased the way a user would ask it. */
  question: string
  /** The grounded answer. Factual, specific to Builder/AINative. */
  answer: string
  /** Topic bucket for grouping in the UI. */
  category: 'getting-started' | 'building' | 'deploying' | 'billing' | 'ownership' | 'ai'
  /** Extra keywords to improve retrieval recall (synonyms not in the Q/A text). */
  keywords?: string[]
}

/**
 * Curated FAQ knowledge base. These answers are the ground truth the AI is
 * allowed to speak from. Add/adjust here — the page, JSON-LD, and RAG all read
 * this one array.
 */
export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'what-is-ainative-builder',
    question: 'What is AINative Builder?',
    answer:
      'AINative Builder is an AI-powered platform where Cody, an AI co-founder, turns a single idea into a real, running app on a live URL — backed by open primitives you fully own (ZeroDB for data, ZeroPipeline for CRM, ZeroInvoice for billing, ServiceOS for helpdesk, ZeroVoice for phone). It builds the product AND wires the business systems, then keeps operating them.',
    category: 'getting-started',
    keywords: ['cody', 'ai co-founder', 'platform', 'overview'],
  },
  {
    id: 'how-do-i-start',
    question: 'How do I start building?',
    answer:
      'Go to /build, describe your idea in one line, and Cody starts building immediately — no account required to watch the first build. You will see a live preview of your app render as Cody composes the frontend and selects the primitives your idea needs.',
    category: 'getting-started',
    keywords: ['get started', 'begin', 'first app', 'free'],
  },
  {
    id: 'do-i-need-an-account',
    question: 'Do I need an account to try it?',
    answer:
      'No. Anonymous users can describe an idea on /build and watch Cody build a live preview before signing up. You only need an account (and a plan) when you want to deploy the real backend, buy a domain, and let Cody run the company autonomously.',
    category: 'getting-started',
    keywords: ['signup', 'register', 'login', 'anonymous', 'guest', 'trial'],
  },
  {
    id: 'what-can-cody-build',
    question: 'What kind of apps can Cody build?',
    answer:
      'Cody builds real multi-file web apps — SaaS tools, dashboards, internal tools, marketplaces, and content sites — with working interactivity, not static mockups. It composes AINative primitives instead of regenerating everything, so your app ships with a real database, CRM, billing, and support wired in.',
    category: 'building',
    keywords: ['apps', 'saas', 'dashboard', 'capabilities', 'what can it make'],
  },
  {
    id: 'which-ai-models',
    question: 'Which AI models power Cody?',
    answer:
      'Cody runs on multiple models with tier-based routing: Claude (via Amazon Bedrock or the Anthropic API) for the strongest reasoning, with AINative-hosted models as a fallback. Paid tiers get faster, higher-quality models. The platform benchmarks models continuously and routes each request to the best available one.',
    category: 'ai',
    keywords: ['claude', 'bedrock', 'anthropic', 'llm', 'model', 'which model'],
  },
  {
    id: 'how-do-i-deploy',
    question: 'How do I deploy my app to a live URL?',
    answer:
      'Once you start a subscription, Cody builds the real backend and deploys your app to a live host. Every company gets a dedicated {slug}.ainative.studio subdomain automatically, and you can point a custom domain at it. Deployment is handled for you — you do not manage servers.',
    category: 'deploying',
    keywords: ['deploy', 'live', 'url', 'hosting', 'domain', 'subdomain', 'railway'],
  },
  {
    id: 'custom-domain',
    question: 'Can I use my own custom domain?',
    answer:
      'Yes. Each company is served on a CNAME-pointable {slug}.ainative.studio host, so you can point your own custom domain at your app. Domain setup is available once you have a plan.',
    category: 'deploying',
    keywords: ['custom domain', 'cname', 'dns', 'byo domain', 'own domain'],
  },
  {
    id: 'what-does-it-cost',
    question: 'How much does it cost?',
    answer:
      'You can start building and preview an app for free. Deploying the real backend, buying a domain, and running the autonomous loop require a paid subscription. There is no revenue share and no lock-in — you pay for the platform, not a cut of your business.',
    category: 'billing',
    keywords: ['price', 'pricing', 'cost', 'plan', 'subscription', 'free', 'paid', 'revenue share'],
  },
  {
    id: 'do-i-own-the-code',
    question: 'Do I own what Cody builds?',
    answer:
      'Yes — completely. Everything is built on open, inspectable primitives, so you own 100% of the app and the business systems. There is no black box: you can read, fork, and extend the code. If AINative disappeared tomorrow, your company would still run.',
    category: 'ownership',
    keywords: ['own', 'ownership', 'open source', 'fork', 'lock-in', 'export', 'my code'],
  },
  {
    id: 'autonomous-loop',
    question: 'What does the autonomous loop do?',
    answer:
      'After your company is live, Cody keeps operating it: lead qualification, customer follow-up, support triage, and operational reporting run on a nightly loop. You wake up to a company that has been running itself — not just a codebase that sits idle.',
    category: 'building',
    keywords: ['autonomous', 'nightly', 'loop', 'runs itself', 'operations', 'agents'],
  },
  {
    id: 'is-it-agent-accessible',
    question: 'Can AI agents query Builder programmatically?',
    answer:
      'Yes. The same "ask anything" help capability is exposed as the /api/build/help endpoint, so agents can query Builder help grounded in our docs and FAQ programmatically. This is part of our Agent Experience (AX) commitment — surfaces are agent-accessible, not closed boxes.',
    category: 'ai',
    keywords: ['agent', 'api', 'mcp', 'ax', 'programmatic', 'endpoint'],
  },
  {
    id: 'where-are-the-docs',
    question: 'Where can I find documentation and guides?',
    answer:
      'Long-form guides live at /guides (how to build a SaaS with AI, tool comparisons, AX optimization), and full platform documentation is at docs.ainative.studio. This Help Center adds an AI "ask anything" box grounded in those docs plus this FAQ.',
    category: 'getting-started',
    keywords: ['docs', 'documentation', 'guides', 'help', 'tutorials', 'learn'],
  },
]

/** Simple English stopword set — dropped before token overlap scoring. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'is', 'are', 'do', 'does', 'i', 'my', 'me', 'to', 'of',
  'for', 'on', 'in', 'it', 'this', 'that', 'can', 'how', 'what', 'with', 'you',
  'your', 'we', 'our', 'be', 'or', 'as', 'at', 'by', 'so', 'if', 'get', 'use',
])

/**
 * Tokenize free text into lowercase alphanumeric words, dropping stopwords and
 * 1-character tokens. Exported for testing.
 */
export function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/** Score a single FAQ entry against a tokenized query (keyword overlap). */
export function scoreEntry(queryTokens: string[], entry: FaqEntry): number {
  if (queryTokens.length === 0) return 0
  const haystack = new Set(
    tokenize(`${entry.question} ${entry.answer} ${(entry.keywords || []).join(' ')}`),
  )
  let score = 0
  for (const t of queryTokens) {
    if (haystack.has(t)) score += 1
  }
  return score
}

/**
 * Retrieve the top-K most relevant FAQ entries for a question. Pure and
 * deterministic. Returns [] for empty input. When nothing overlaps, returns the
 * first `limit` entries as a sensible default so the model always has grounding.
 */
export function retrieveFaq(question: string, limit = 4): FaqEntry[] {
  const q = tokenize(question)
  if (q.length === 0) return []
  const scored = FAQ_ENTRIES.map((entry) => ({ entry, score: scoreEntry(q, entry) }))
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
  if (hits.length === 0) {
    // No lexical overlap — fall back to the foundational entries so the AI still
    // answers grounded in Builder facts rather than from nothing.
    return FAQ_ENTRIES.slice(0, limit)
  }
  return hits.slice(0, limit).map((s) => s.entry)
}

/**
 * Format retrieved FAQ entries into a compact grounding block for the model.
 * Empty input yields an empty string (caller decides how to prompt).
 */
export function buildGroundingContext(entries: FaqEntry[]): string {
  if (!entries || entries.length === 0) return ''
  return entries
    .map((e, i) => `[FAQ ${i + 1}] Q: ${e.question}\nA: ${e.answer}`)
    .join('\n\n')
}

/**
 * Build the FAQPage JSON-LD object from the curated FAQ (AEO). Shared by the
 * page so the crawlable structured data always matches the rendered Q&A.
 */
export function faqPageJsonLd(entries: FaqEntry[] = FAQ_ENTRIES) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: e.answer,
      },
    })),
  }
}

export function buildHelpSystemPrompt(context: string): string {
  return (
    `You are Cody's Help assistant for AINative Builder — a platform where an AI ` +
    `co-founder turns an idea into a real, running app on infrastructure the ` +
    `founder fully owns.\n\n` +
    `Answer the user's question using ONLY the grounded knowledge below. If the ` +
    `answer is not covered, say so plainly and point them to /guides or ` +
    `docs.ainative.studio — do NOT invent features, prices, or capabilities.\n\n` +
    `GROUNDED KNOWLEDGE:\n${context}\n\n` +
    `INSTRUCTIONS:\n` +
    `- Answer directly and concretely in 2-4 sentences.\n` +
    `- Be specific to AINative Builder; never give generic AI advice.\n` +
    `- No fluff, no disclaimers, no marketing filler.`
  )
}
