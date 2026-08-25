/**
 * LLM Mention Tracker — testable core logic (Issue #47)
 *
 * Implements the Claude AEO Playbook "Play 6": your real Claude visibility is
 * "mentions out of 50" — how many of 50 answers (10 buyer questions × 5 runs)
 * name your brand on questions Claude does NOT look up (its pre-decided
 * shortlist) — NOT citation count. We baseline Builder (AINative) vs Polsia,
 * Lovable, Replit and Bolt, then re-measure monthly to track the trend.
 *
 * This module holds ONLY pure, side-effect-free logic so it can be unit tested
 * without spending API budget:
 *   - the buyer question set (naming no brands)
 *   - the brand definitions + aliases
 *   - the brand-mention counter / parser
 *   - aggregation + share computation
 *   - the JSON + markdown report formatters
 *
 * The network I/O (DataForSEO ai_optimization module and the direct
 * AINative/Claude fallback) lives in `scripts/llm-mention-tracker.ts`.
 */

// ---------------------------------------------------------------------------
// Question set — 10 buyer questions, in buyers' words, naming NO brands.
// These are the "pre-decided" style questions from the playbook (how to pick /
// best way to / is it worth it) where Claude answers from its shortlist.
// ---------------------------------------------------------------------------
export const BUYER_QUESTIONS: readonly string[] = [
  "What's the best way to build an app with AI?",
  'What tool builds a full working app from a single prompt?',
  'Which AI can build and run a whole startup for me?',
  'How do I go from an idea to a live web app without coding?',
  "What's the best AI app builder for non-technical founders?",
  'Which AI platform actually deploys the app it generates, not just code?',
  'What should I use to build a SaaS product with AI end to end?',
  'Is there an AI that builds a full-stack app with a database and auth?',
  "What's the fastest way to ship a startup MVP using AI?",
  'Which AI coding tool is best for building and launching a product?',
] as const

// ---------------------------------------------------------------------------
// Brands — the tracked set. `aliases` are matched case-insensitively as whole
// words so "Builder" doesn't hit "app builder" generically; each alias is a
// distinct brand token. The primary brand is Builder / AINative.
// ---------------------------------------------------------------------------
export interface BrandDef {
  /** Stable key used in the report. */
  key: string
  /** Human-readable display name. */
  label: string
  /** Whether this is our own brand (the one we want mentioned). */
  primary?: boolean
  /** Case-insensitive whole-word aliases that count as a mention. */
  aliases: string[]
}

export const BRANDS: readonly BrandDef[] = [
  {
    key: 'builder',
    label: 'Builder (AINative)',
    primary: true,
    // "AINative Builder", "AINative", "ainative.studio". Note we intentionally
    // do NOT include the bare word "builder" — it is too generic and would
    // over-count ("app builder", "website builder"). We require the AINative
    // brand token to attribute a mention to us.
    aliases: ['ainative builder', 'ainative.studio', 'ainative'],
  },
  { key: 'polsia', label: 'Polsia', aliases: ['polsia'] },
  { key: 'lovable', label: 'Lovable', aliases: ['lovable', 'lovable.dev'] },
  { key: 'replit', label: 'Replit', aliases: ['replit', 'replit agent'] },
  { key: 'bolt', label: 'Bolt', aliases: ['bolt.new', 'bolt'] },
] as const

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a whole-word, case-insensitive matcher for an alias. We treat a "word"
 * as bounded by non-alphanumeric characters (so "replit." and "(replit)" match
 * but "replitx" does not). Dots inside an alias (e.g. "bolt.new") are matched
 * literally.
 */
function aliasRegExp(alias: string): RegExp {
  const escaped = escapeRegExp(alias.trim())
  // (?<![a-z0-9]) / (?![a-z0-9]) are unicode-agnostic word boundaries that,
  // unlike \b, work correctly around dots and hyphens in brand tokens.
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i')
}

/**
 * Does the given answer text mention this brand at least once?
 * A brand is mentioned if ANY of its aliases appears as a whole word.
 */
export function answerMentionsBrand(answer: string, brand: BrandDef): boolean {
  if (!answer) return false
  return brand.aliases.some((alias) => aliasRegExp(alias).test(answer))
}

/**
 * Count, across a list of answers, how many answers mention EACH brand.
 * "Mentions out of N" semantics: an answer counts once per brand regardless of
 * how many times the brand appears in that answer (playbook counts answers,
 * not raw occurrences).
 *
 * @returns map of brand.key -> number of answers mentioning it
 */
export function countBrandMentions(
  answers: string[],
  brands: readonly BrandDef[] = BRANDS
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const brand of brands) counts[brand.key] = 0
  for (const answer of answers) {
    for (const brand of brands) {
      if (answerMentionsBrand(answer, brand)) counts[brand.key] += 1
    }
  }
  return counts
}

export interface BrandResult {
  key: string
  label: string
  primary: boolean
  /** Number of answers (out of `total`) that named this brand. */
  mentions: number
  /** mentions / total, rounded to 4 decimals; 0 when total is 0. */
  share: number
}

/**
 * Compute per-brand results ("mentions out of total" + share) from a set of
 * answers. `total` defaults to answers.length (the "out of 50" denominator).
 */
export function computeResults(
  answers: string[],
  brands: readonly BrandDef[] = BRANDS,
  total: number = answers.length
): BrandResult[] {
  const counts = countBrandMentions(answers, brands)
  return brands.map((brand) => {
    const mentions = counts[brand.key]
    return {
      key: brand.key,
      label: brand.label,
      primary: Boolean(brand.primary),
      mentions,
      share: total > 0 ? Number((mentions / total).toFixed(4)) : 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Report shape + formatters
// ---------------------------------------------------------------------------
export interface MentionReport {
  /** ISO date (YYYY-MM-DD) the run was recorded. */
  date: string
  /** Which data path produced this report. */
  source: 'dataforseo' | 'direct-llm'
  /** Model / engine identifier (e.g. "claude-sonnet-4" or "dataforseo:gpt-4o"). */
  model: string
  /** Number of buyer questions asked. */
  questions: number
  /** Runs per question. */
  runsPerQuestion: number
  /** Total answers collected (questions × runsPerQuestion). */
  totalAnswers: number
  /** Per-brand mention counts + share, sorted by mentions desc. */
  results: BrandResult[]
  /** Optional free-form notes (e.g. "DataForSEO unreachable, used fallback"). */
  notes?: string
}

/**
 * Assemble a full report from collected answers.
 */
export function buildReport(params: {
  date: string
  source: MentionReport['source']
  model: string
  questions: number
  runsPerQuestion: number
  answers: string[]
  brands?: readonly BrandDef[]
  notes?: string
}): MentionReport {
  const brands = params.brands ?? BRANDS
  const totalAnswers = params.answers.length
  const results = computeResults(params.answers, brands, totalAnswers).sort(
    (a, b) => b.mentions - a.mentions || a.label.localeCompare(b.label)
  )
  return {
    date: params.date,
    source: params.source,
    model: params.model,
    questions: params.questions,
    runsPerQuestion: params.runsPerQuestion,
    totalAnswers,
    results,
    notes: params.notes,
  }
}

/** Format a share (0..1) as a percentage string like "24.0%". */
export function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}

/**
 * Render a report as a human-readable markdown summary for docs/growth/.
 */
export function formatMarkdownReport(report: MentionReport): string {
  const lines: string[] = []
  lines.push(`# LLM Mention Tracker — ${report.date}`)
  lines.push('')
  lines.push(
    'Play 6 baseline: "mentions out of N" — how often each brand is named in ' +
      'LLM answers to brand-free buyer questions. Re-measured monthly to track ' +
      'the trend, not a one-off number.'
  )
  lines.push('')
  lines.push(`- **Source:** ${report.source}`)
  lines.push(`- **Model:** ${report.model}`)
  lines.push(
    `- **Sample:** ${report.questions} questions × ${report.runsPerQuestion} runs = ` +
      `${report.totalAnswers} answers`
  )
  lines.push('')
  lines.push(`| Brand | Mentions (out of ${report.totalAnswers}) | Share |`)
  lines.push('|---|---|---|')
  for (const r of report.results) {
    const label = r.primary ? `**${r.label}**` : r.label
    lines.push(`| ${label} | ${r.mentions} | ${formatShare(r.share)} |`)
  }
  lines.push('')
  if (report.notes) {
    lines.push(`> ${report.notes}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** Slug used for dated output filenames, e.g. "2026-08-24". */
export function reportDateSlug(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// DataForSEO parsing — pull answer texts out of an ai_optimization
// llm_responses/live payload so the same counter can be reused. Kept pure and
// tolerant of the nested DataForSEO envelope (tasks[].result[].items[]).
// ---------------------------------------------------------------------------

/**
 * Extract answer text strings from a DataForSEO ai_optimization
 * llm_responses/live response body. DataForSEO wraps results as
 * `{ tasks: [{ result: [{ items: [{ ... }] }] }] }`; the assistant text lives
 * under items with `type: "message"` / a `text` (or `sections[].text`) field.
 * We defensively collect any string content we can find.
 */
export function extractDataForSeoAnswers(body: unknown): string[] {
  const answers: string[] = []
  const root = body as { tasks?: unknown[] } | undefined
  if (!root || !Array.isArray(root.tasks)) return answers

  for (const task of root.tasks) {
    const result = (task as { result?: unknown[] })?.result
    if (!Array.isArray(result)) continue
    for (const res of result) {
      const items = (res as { items?: unknown[] })?.items
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const it = item as {
          type?: string
          text?: unknown
          sections?: unknown[]
        }
        if (typeof it.text === 'string' && it.text.trim()) {
          answers.push(it.text)
        }
        if (Array.isArray(it.sections)) {
          for (const section of it.sections) {
            const text = (section as { text?: unknown })?.text
            if (typeof text === 'string' && text.trim()) answers.push(text)
          }
        }
      }
    }
  }
  return answers
}
