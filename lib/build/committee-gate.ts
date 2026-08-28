/**
 * Multi-model completeness committee (builder#346) — ported from headlong
 * `tools/pr-committee` (414-line bash, read in full).
 *
 * WHAT IT IS. K frontier models INDEPENDENTLY review the same brief (the
 * generated App.tsx + files + the idea/PRD) in parallel — each with its own
 * fresh context; the reviewers cannot see each other, and that independence is
 * the whole point: cross-model AGREEMENT is a far stronger completeness/quality
 * signal than any one model's self-review. Each reviewer emits STRUCTURED
 * findings (verdict + JSON: file/line/severity/confidence/category/title/detail/
 * suggestion). Then a CHAIR model merges: dedupes, COUNTS how many independent
 * reviewers raised each issue, checks each finding against the actual code, and
 * discards misreads WITH REASONS (never silently).
 *
 * THE GAP THIS CLOSES. Our shipped review path is ONE Sonnet reviewing its OWN
 * output — single-model self-review, which misses its own blind spots. We market
 * that we are multi-model; this turns that into a real quality mechanism.
 *
 * OFFLINE FIRST (the issue is explicit). This ships as an analyzer callable over
 * a STORED generation (by chatId) that produces the committee report — NOT wired
 * into the live build path. Measurement before gating: run it over recent builds,
 * see whether cross-model agreement predicts real defects, THEN decide if the K
 * frontier calls per build are worth gating on. See reviewGeneration().
 *
 * SPLIT: the merge / agreement-counting / dedupe / ranking logic is PURE and
 * thoroughly unit-tested; the K model calls are the I/O, injected as a `runModel`
 * function so tests mock them (zero API budget). A CHAIR merge is available in
 * two flavours: a deterministic local merge (mergeFindingsLocally — pure, always
 * runs, the trustworthy backbone) and an optional LLM chair narrative on top.
 *
 * BOUNDED + FAIL-OPEN + KILL SWITCH. A harness experiment must NEVER break or
 * hang a real build. Every model call is time-boxed; the roster is size-capped; a
 * per-run cost cap aborts before over-spending; COMMITTEE_GATE_DISABLED=1 (or the
 * `enabled:false` option) short-circuits to an inert report. Any reviewer failure
 * is tolerated (>=1 success proceeds); total failure yields an honest empty
 * report, never a throw.
 */

import { loadGeneration } from '@/lib/zerodb-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'blocker' | 'major' | 'minor' | 'nit'
export type Verdict = 'approve' | 'request-changes' | 'needs-discussion'
export type Category =
  | 'correctness'
  | 'security'
  | 'concurrency'
  | 'data-loss'
  | 'perf'
  | 'maintainability'
  | 'completeness'
  | 'other'

/** One structured finding as emitted by a single reviewer. */
export interface Finding {
  file: string
  line: number | null
  severity: Severity
  confidence: number
  category: Category
  title: string
  detail: string
  suggestion: string | null
}

/** A single reviewer's full independent review (verdict + summary + findings). */
export interface ReviewerReview {
  /** The reviewer model id (e.g. 'claude-opus-4.5'). */
  model: string
  verdict: Verdict
  summary: string
  findings: Finding[]
  /** True when the model call failed and this is an empty stand-in. */
  failed?: boolean
  /** Approx tokens the call consumed (for cost accounting), if known. */
  tokens?: number
}

/** A finding after the chair merges duplicates across reviewers. */
export interface MergedFinding extends Finding {
  /** Distinct reviewer models that independently raised this issue. */
  raisedBy: string[]
  /** How many independent reviewers raised it (== raisedBy.length). */
  agreement: number
  /** Max confidence any reviewer assigned. */
  maxConfidence: number
}

/** A finding the chair discarded, with the reason (never silently dropped). */
export interface DiscardedFinding {
  finding: Finding
  reason: string
}

/** The final committee report. */
export interface CommitteeReport {
  /** Identifier of the thing reviewed (chatId or a label). */
  target: string
  /** Overall verdict, derived from reviewer verdicts + merged severities. */
  verdict: Verdict
  /** Reviewer models that actually produced a review. */
  reviewers: string[]
  /** How many reviewers were dispatched (roster size). */
  rosterSize: number
  /** How many reviewers succeeded. */
  succeeded: number
  /** Each reviewer's verdict, for the report header. */
  reviewerVerdicts: { model: string; verdict: Verdict; failed?: boolean }[]
  /** Merged, agreement-counted, severity-ranked findings. */
  findings: MergedFinding[]
  /** Findings the chair discarded as misreads, with reasons. */
  discarded: DiscardedFinding[]
  /** Optional chair narrative (LLM-written markdown), when a chair ran. */
  chairNarrative?: string
  /** True when the gate was disabled/killed — an inert, non-blocking report. */
  disabled?: boolean
  /** Approx total tokens spent across all model calls. */
  tokensSpent: number
  /** Human-readable notes (kill switch, cost cap hit, failures). */
  notes: string[]
}

/** The input a committee reviews: the generated app + the idea/PRD. */
export interface ReviewSubject {
  /** Identifier (chatId or a label) for the report + logs. */
  target: string
  /** The original idea / PRD / prompt that drove the generation. */
  idea: string
  /** The parsed multi-file map, when available (the authority). */
  files?: Record<string, string> | null
  /** The single concatenated code blob (fallback when no files map). */
  code?: string
}

/**
 * The model I/O the committee needs. Injected so tests mock it (zero API budget)
 * and so the live path can swap in the AINative proxy / Bedrock clients. A call
 * returns raw model text (the reviewer's VERDICT/SUMMARY/JSON block, or the
 * chair's markdown) plus an approximate token count for cost accounting.
 */
export type RunModel = (args: {
  model: string
  system: string
  user: string
  /** Hard wall-clock budget for this single call. */
  timeoutMs: number
}) => Promise<{ text: string; tokens?: number }>

// ---------------------------------------------------------------------------
// Config: roster, caps, kill switch
// ---------------------------------------------------------------------------

/**
 * Default reviewer roster. Independence is the signal, so the roster must span
 * VENDORS/families, not just Claude sizes. Claude + at least one other, per the
 * issue. These are AINative-proxy model names (the proxy routes each to its
 * vendor). Overridable via COMMITTEE_MODELS or the `models` option.
 */
// #351: the prior ids ('qwen-2.5-coder-32b', 'gemini-2.5-pro') were NOT in the
// AINative proxy registry — every call 400'd ("Unknown model … not in the model
// registry"), so only claude-opus-4.5 ever reached and the "committee" was a
// single reviewer (the whole cross-vendor-independence premise was untested).
// These ids are verified live against GET /api/v1/models + a chat/completions
// smoke (both 200 "OK"): qwen-coder-32b (Qwen) + gemini-flash (Google) + Claude
// = three vendors, which is what makes agreement meaningful.
export const DEFAULT_ROSTER = ['claude-opus-4.5', 'qwen-coder-32b', 'gemini-flash']

/** Default chair (strong synthesis model). Overridable via COMMITTEE_CHAIR. */
export const DEFAULT_CHAIR = 'claude-opus-4.5'

/** Hard cap on roster size — K frontier calls are expensive; never fan out wide. */
export const MAX_ROSTER = 5

/** Per-call wall-clock budget (ms). Frontier models on a big brief think a while. */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000

/**
 * Per-run token cost cap. Once cumulative spend crosses this, no further model
 * calls are dispatched (already-running ones finish). Guards the budget so a
 * harness experiment can never run away. Overridable via COMMITTEE_MAX_TOKENS.
 */
export const DEFAULT_MAX_TOKENS = 400_000

export interface CommitteeOptions {
  /** Reviewer roster (defaults to DEFAULT_ROSTER / COMMITTEE_MODELS). */
  models?: string[]
  /** Chair model for the optional LLM narrative (defaults to DEFAULT_CHAIR). */
  chair?: string
  /** Run the LLM chair narrative on top of the deterministic merge. Default false (offline measurement doesn't need it). */
  useLlmChair?: boolean
  /** Per-call timeout ms. */
  callTimeoutMs?: number
  /** Per-run token cost cap. */
  maxTokens?: number
  /** Explicit enable flag. Default: true unless the kill-switch env is set. */
  enabled?: boolean
  /** Steer the review (headlong --focus). Injected into every reviewer's brief. */
  focus?: string
  /** Cap on brief size (chars) to bound token spend. */
  maxBriefChars?: number
}

/** Is the committee killed via env? COMMITTEE_GATE_DISABLED=1. */
export function isKilledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.COMMITTEE_GATE_DISABLED || '').toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** Resolve the roster from options/env, deduped and size-capped. */
export function resolveRoster(opts: CommitteeOptions = {}, env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = (env.COMMITTEE_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const chosen = (opts.models && opts.models.length ? opts.models : fromEnv.length ? fromEnv : DEFAULT_ROSTER)
    .map((s) => String(s).trim())
    .filter(Boolean)
  // Dedupe (a committee of the same model twice buys no independence) and cap.
  return [...new Set(chosen)].slice(0, MAX_ROSTER)
}

// ---------------------------------------------------------------------------
// Prompts (ported verbatim in spirit from headlong sys-reviewer / sys-chair)
// ---------------------------------------------------------------------------

/** The reviewer system prompt. Steers toward grounded, structured findings. */
export function reviewerSystemPrompt(focus?: string): string {
  const focusLine = focus
    ? `\n- The requester set a PRIORITY FOCUS (in the brief). Weight your effort toward it, but still report any blocker you notice outside it.`
    : ''
  return `You are one member of an independent completeness-review committee examining a generated web app against the idea/PRD it was built from. Other frontier models are reviewing the same brief in parallel; you cannot see their work and must not speculate about it. Your value to the committee is an honest, independent, evidence-grounded review of whether this app is actually COMPLETE and CORRECT for the stated idea — not merely parseable.

Rules:
- Ground every finding in the provided files/code; quote the relevant lines. Never invent code that is not in the brief.
- Judge COMPLETENESS against the idea/PRD: missing features, dead buttons, stubbed handlers, TODOs, unimplemented flows, imports with no definition, data that is never wired.
- If you suspect a problem but the brief lacks the context to confirm it, report it with low confidence and say exactly what is missing.
- Prefer a few verified findings over many speculative ones. Do not pad with praise or restate the idea.
- Style nits only when they cause real risk of confusion or bugs.${focusLine}

Output EXACTLY this structure and nothing else:

VERDICT: approve | request-changes | needs-discussion
SUMMARY: <2-4 sentences>

Then a JSON array in a \`\`\`json fence. Each element:
{
  "file": "path",
  "line": <int or null>,
  "severity": "blocker" | "major" | "minor" | "nit",
  "confidence": <0.0-1.0>,
  "category": "correctness" | "security" | "concurrency" | "data-loss" | "perf" | "maintainability" | "completeness" | "other",
  "title": "<one line>",
  "detail": "<what is wrong, with quoted evidence>",
  "suggestion": "<concrete fix, or null>"
}
An empty array is a valid and respectable answer.`
}

/** The chair system prompt for the optional LLM narrative. */
export function chairSystemPrompt(focus?: string): string {
  const focusLine = focus ? `\n- The requester's priority focus was: ${focus} — lead with findings relevant to it.` : ''
  return `You chair a completeness-review committee. You receive the generated app and the final reviews from several independent frontier models, plus a deterministic merge of their findings (already deduped and agreement-counted). Produce the single report a maintainer will act on.

- Trust the agreement counts: agreement across independent models is a strong signal; a lone low-confidence finding is not.
- Check every finding against the code. Note any that misread the code in a "Discarded" section — do not silently drop.
- Rank by severity, then agreement.${focusLine}

Output a concise Markdown report, nothing else: a Verdict line, a Findings section (severity, file:line, title, raised-by n/K, why it matters, suggested fix), an Uncertain section, and a Discarded section.`
}

// ---------------------------------------------------------------------------
// Brief construction (pure)
// ---------------------------------------------------------------------------

/**
 * Build the reviewer brief from a subject: the idea/PRD, an optional focus, and
 * the full contents of the generated files (App.tsx first), bounded by a char
 * budget so the token count stays sane. Mirrors headlong's brief assembly.
 */
export function buildBrief(subject: ReviewSubject, opts: { focus?: string; maxChars?: number } = {}): string {
  const maxChars = Math.max(2_000, opts.maxChars ?? 120_000)
  const parts: string[] = []
  parts.push(`# Generated app under review: ${subject.target}`)
  parts.push('')
  parts.push('## The idea / PRD it was built from')
  parts.push('')
  parts.push((subject.idea || '(no idea/PRD recorded)').trim())
  parts.push('')
  if (opts.focus) {
    parts.push('## PRIORITY FOCUS from the requester')
    parts.push('')
    parts.push(opts.focus.trim())
    parts.push('')
  }
  parts.push('## Full contents of the generated files')
  parts.push('')

  const files = orderedFiles(subject)
  let budget = maxChars - parts.join('\n').length
  if (files.length === 0) {
    parts.push('(no source files recorded for this generation)')
  }
  for (const [path, content] of files) {
    if (budget <= 0) {
      parts.push('(remaining files omitted: brief budget exhausted)')
      break
    }
    const clipped = content.length > budget ? content.slice(0, budget) + '\n...(truncated)' : content
    parts.push(`### ${path}`)
    parts.push('```tsx')
    parts.push(clipped)
    parts.push('```')
    parts.push('')
    budget -= clipped.length + path.length + 16
  }
  return parts.join('\n')
}

/**
 * Order the subject's files so App.tsx / index come first (the entry point a
 * reviewer wants to read first), then the rest alphabetically. Falls back to a
 * single synthetic App.tsx from `code` when no files map is present.
 */
export function orderedFiles(subject: ReviewSubject): [string, string][] {
  const map = subject.files && Object.keys(subject.files).length > 0 ? subject.files : null
  if (!map) {
    const code = (subject.code || '').trim()
    return code ? [['App.tsx', code]] : []
  }
  const entries = Object.entries(map).filter(
    ([p, c]) => typeof c === 'string' && c.trim().length > 0 && /\.(t|j)sx?$/.test(p),
  )
  const rank = (p: string): number => {
    const base = p.split('/').pop() || p
    if (/^App\.(t|j)sx?$/.test(base)) return 0
    if (/^index\.(t|j)sx?$/.test(base)) return 1
    if (/^main\.(t|j)sx?$/.test(base)) return 2
    return 3
  }
  return entries.sort((a, b) => {
    const r = rank(a[0]) - rank(b[0])
    return r !== 0 ? r : a[0].localeCompare(b[0])
  })
}

// ---------------------------------------------------------------------------
// Parsing a reviewer's raw output (pure)
// ---------------------------------------------------------------------------

const SEVERITIES: ReadonlySet<string> = new Set(['blocker', 'major', 'minor', 'nit'])
const VERDICTS: ReadonlySet<string> = new Set(['approve', 'request-changes', 'needs-discussion'])
const CATEGORIES: ReadonlySet<string> = new Set([
  'correctness',
  'security',
  'concurrency',
  'data-loss',
  'perf',
  'maintainability',
  'completeness',
  'other',
])

function coerceSeverity(v: unknown): Severity {
  const s = String(v || '').toLowerCase().trim()
  return (SEVERITIES.has(s) ? s : 'minor') as Severity
}

function coerceVerdict(v: unknown): Verdict {
  const s = String(v || '').toLowerCase().trim()
  return (VERDICTS.has(s) ? s : 'needs-discussion') as Verdict
}

function coerceCategory(v: unknown): Category {
  const s = String(v || '').toLowerCase().trim()
  return (CATEGORIES.has(s) ? s : 'other') as Category
}

function coerceConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

function coerceLine(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

/** Coerce one raw JSON element into a validated Finding, or null if unusable. */
export function coerceFinding(raw: any): Finding | null {
  if (!raw || typeof raw !== 'object') return null
  const title = String(raw.title || '').trim()
  const detail = String(raw.detail || '').trim()
  if (!title && !detail) return null // an empty finding is noise
  return {
    file: String(raw.file || '').trim() || 'unknown',
    line: coerceLine(raw.line),
    severity: coerceSeverity(raw.severity),
    confidence: coerceConfidence(raw.confidence),
    category: coerceCategory(raw.category),
    title: title || detail.slice(0, 80),
    detail: detail || title,
    suggestion: raw.suggestion === null || raw.suggestion === undefined ? null : String(raw.suggestion).trim() || null,
  }
}

/**
 * Parse a reviewer's raw text into a structured review: pull VERDICT and SUMMARY
 * lines, then the JSON array from a ```json fence (or the first bare [...] array).
 * Never throws — a malformed reviewer yields a needs-discussion review with
 * whatever findings could be salvaged (possibly none).
 */
export function parseReviewerOutput(model: string, text: string): ReviewerReview {
  const raw = String(text || '')
  const verdictMatch = raw.match(/VERDICT:\s*(approve|request-changes|needs-discussion)/i)
  const summaryMatch = raw.match(/SUMMARY:\s*([^\n]*(?:\n(?!\s*```|VERDICT:)[^\n]*)*)/i)
  const verdict = coerceVerdict(verdictMatch?.[1])
  const summary = (summaryMatch?.[1] || '').trim()

  const findings = extractFindings(raw)
  return { model, verdict, summary, findings }
}

/** Extract + validate the findings array from raw reviewer text. */
export function extractFindings(raw: string): Finding[] {
  const jsonText = extractJsonArrayText(raw)
  if (!jsonText) return []
  let arr: any
  try {
    arr = JSON.parse(jsonText)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: Finding[] = []
  for (const el of arr) {
    const f = coerceFinding(el)
    if (f) out.push(f)
  }
  return out
}

/** Pull the JSON array text from a ```json fence, or the first balanced [...]. */
export function extractJsonArrayText(raw: string): string | null {
  const fence = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*(\[[\s\S]*?\])\s*```/)
  if (fence && fence[1] && fence[1].trim().startsWith('[')) return fence[1].trim()
  // Fallback: first top-level balanced bracket span.
  const start = raw.indexOf('[')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Merge / agreement-count / dedupe / rank (pure — the trustworthy backbone)
// ---------------------------------------------------------------------------

/** Normalize a title into a fuzzy key for dedupe (case/punctuation-insensitive). */
export function normalizeTitle(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 2) // drop stopword-ish short tokens
    .sort()
    .join(' ')
}

/** Normalize a file path for grouping ('/src/App.tsx' and 'App.tsx' collapse). */
export function normalizeFile(file: string): string {
  return String(file || '')
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/^src\//, '')
    .replace(/^app\//, '')
    .trim()
}

/**
 * Jaccard token overlap of two normalized titles. Used to fuse near-duplicate
 * findings two models phrased differently.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(' ').filter(Boolean))
  const tb = new Set(normalizeTitle(b).split(' ').filter(Boolean))
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

/** Should two findings (from different reviewers) be treated as the same issue? */
export function sameIssue(a: Finding, b: Finding, simThreshold = 0.5): boolean {
  if (normalizeFile(a.file) !== normalizeFile(b.file)) {
    // Different files are the same issue only on an exact normalized-title match.
    return normalizeTitle(a.title) === normalizeTitle(b.title) && normalizeTitle(a.title).length > 0
  }
  // Same file: identical normalized title, OR strong fuzzy overlap, OR the same
  // line with any real overlap.
  if (normalizeTitle(a.title) === normalizeTitle(b.title) && normalizeTitle(a.title).length > 0) return true
  const sim = titleSimilarity(a.title, b.title)
  if (a.line !== null && a.line === b.line && sim >= 0.34) return true
  return sim >= simThreshold
}

const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, nit: 3 }

/** The most severe of two severities (blocker beats major beats minor beats nit). */
function moreSevere(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b
}

/**
 * THE MERGE. Given each reviewer's findings, cluster duplicates ACROSS reviewers,
 * count how many DISTINCT models raised each cluster (the agreement signal), keep
 * the most severe severity + max confidence + the richest detail, and rank by
 * severity then agreement then confidence. Pure and deterministic.
 *
 * @param reviews reviewer reviews (failed ones contribute no findings)
 */
export function mergeFindingsLocally(reviews: ReviewerReview[]): MergedFinding[] {
  // Flatten to (finding, model) pairs from succeeded reviewers.
  const tagged: { f: Finding; model: string }[] = []
  for (const r of reviews) {
    if (r.failed) continue
    for (const f of r.findings) tagged.push({ f, model: r.model })
  }

  const clusters: { rep: Finding; models: Set<string>; maxConf: number }[] = []
  for (const { f, model } of tagged) {
    let placed = false
    for (const c of clusters) {
      if (sameIssue(c.rep, f)) {
        c.models.add(model)
        c.maxConf = Math.max(c.maxConf, f.confidence)
        // Keep the most severe severity across the cluster.
        c.rep.severity = moreSevere(c.rep.severity, f.severity)
        // Prefer the longest detail (usually the best-evidenced), and a non-null
        // suggestion / a resolved line if the representative lacked one.
        if (f.detail.length > c.rep.detail.length) {
          c.rep.detail = f.detail
          c.rep.title = f.title
        }
        if (!c.rep.suggestion && f.suggestion) c.rep.suggestion = f.suggestion
        if (c.rep.line === null && f.line !== null) c.rep.line = f.line
        placed = true
        break
      }
    }
    if (!placed) {
      clusters.push({ rep: { ...f }, models: new Set([model]), maxConf: f.confidence })
    }
  }

  const merged: MergedFinding[] = clusters.map((c) => ({
    ...c.rep,
    raisedBy: [...c.models].sort(),
    agreement: c.models.size,
    maxConfidence: c.maxConf,
  }))

  return rankFindings(merged)
}

/** Rank merged findings: severity asc (blocker first), then agreement desc, then confidence desc. */
export function rankFindings(findings: MergedFinding[]): MergedFinding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (s !== 0) return s
    if (b.agreement !== a.agreement) return b.agreement - a.agreement
    if (b.maxConfidence !== a.maxConfidence) return b.maxConfidence - a.maxConfidence
    return a.title.localeCompare(b.title)
  })
}

/**
 * Derive the committee verdict — WEIGHTED / CHAIR-ARBITRATED (builder#353).
 *
 * The #346 re-measurement showed the old CONSENSUS rule ("any reviewer disagrees
 * → needs-discussion / request-changes") false-blocked 100% of known-good builds:
 * the calibrated frontier reviewer (claude-opus-4.5) correctly approved, but a
 * single dissenting vendor (qwen-coder-32b / gemini-flash) vetoed every build.
 * A committee that needs consensus is only as good as its weakest reviewer.
 *
 * The fix: TRUST the frontier/chair reviewer as the backbone of the verdict. The
 * other vendors CONTRIBUTE findings and can escalate severity, but a single
 * non-consensus vendor must NOT force needs-discussion / request-changes on its
 * own. A finding only overrides the chair when it is CORROBORATED (>=2 reviewers).
 *
 * Rules (chair = the frontier reviewer, default DEFAULT_CHAIR):
 * - request-changes when there is a CORROBORATED blocker (agreement>=2), OR the
 *   chair itself said request-changes and backs a real blocker it is confident in.
 * - needs-discussion is reserved for a GENUINE SPLIT on a real blocker: the chair
 *   is uncertain (needs-discussion) AND at least one blocker exists, or a lone
 *   high-confidence blocker the chair did not clear. It is NOT triggered by a
 *   single dissenting vendor's majors or uncorroborated blockers.
 * - approve when the frontier reviewer approves AND no blocker is corroborated by
 *   >=2 reviewers (lone-vendor concerns are recorded as findings, not vetoes).
 * - When the chair is absent from the roster, fall back to the strongest merged
 *   signal alone (corroborated blocker → request-changes; else approve), never to
 *   a single-vendor veto.
 */
export function deriveVerdict(
  reviews: ReviewerReview[],
  merged: MergedFinding[],
  chairModel: string = DEFAULT_CHAIR,
): Verdict {
  const live = reviews.filter((r) => !r.failed)
  const chair = live.find((r) => r.model === chairModel)

  const blockers = merged.filter((f) => f.severity === 'blocker')
  // A blocker only overrides the frontier reviewer when INDEPENDENTLY corroborated.
  const corroboratedBlocker = blockers.some((f) => f.agreement >= 2)
  // A lone blocker the chair itself is confident in (its own high-confidence call).
  const chairHighConfBlocker =
    chair?.verdict !== 'approve' &&
    blockers.some((f) => f.raisedBy.includes(chairModel) && f.maxConfidence >= 0.7)

  // Corroboration across the committee is the one signal strong enough to override
  // the frontier reviewer. Also honor the chair's OWN confident block.
  if (corroboratedBlocker || chairHighConfBlocker) return 'request-changes'

  // No chair on the roster: fall back to the merged signal alone, never a lone veto.
  if (!chair) {
    return 'approve'
  }

  // Backbone: trust the frontier reviewer. Its approval stands unless a blocker was
  // corroborated (handled above). A single dissenting vendor cannot override it.
  if (chair.verdict === 'approve') return 'approve'

  // The chair itself is not clean. A genuine split on a real blocker → discuss;
  // otherwise the chair wants changes it did not raise a corroborated blocker for.
  if (chair.verdict === 'needs-discussion') {
    return blockers.length > 0 ? 'needs-discussion' : 'request-changes'
  }
  // chair.verdict === 'request-changes'
  return 'request-changes'
}

// ---------------------------------------------------------------------------
// Orchestration (I/O — the K model calls are injected)
// ---------------------------------------------------------------------------

/**
 * Run the committee over a prepared subject. This is the orchestration seam:
 * the pure merge logic is exercised here, but the K model calls come from the
 * injected `runModel`, which tests mock and the live path wires to real clients.
 *
 * Bounded + fail-open: each call is time-boxed by runModel; a per-run token cap
 * stops the LLM chair once crossed; the kill switch yields an inert report; and
 * total reviewer failure yields an honest empty report (never a throw).
 */
export async function runCommittee(
  subject: ReviewSubject,
  runModel: RunModel,
  opts: CommitteeOptions = {},
): Promise<CommitteeReport> {
  const notes: string[] = []
  const enabled = opts.enabled !== undefined ? opts.enabled : !isKilledByEnv()
  const roster = resolveRoster(opts)

  if (!enabled) {
    notes.push('committee disabled (kill switch) — inert report, nothing reviewed')
    return inertReport(subject.target, roster.length, notes)
  }
  if (roster.length === 0) {
    notes.push('empty roster — nothing to run')
    return inertReport(subject.target, 0, notes)
  }

  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
  const callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  const brief = buildBrief(subject, { focus: opts.focus, maxChars: opts.maxBriefChars })
  const system = reviewerSystemPrompt(opts.focus)

  // Round 1: independent parallel reviews. Each reviewer gets its OWN call with a
  // fresh context — that independence is the confidence signal. We cannot see
  // token spend until calls return, so the cap is enforced post-hoc (roster is
  // already size-capped, so the worst case is bounded).
  const results = await Promise.all(
    roster.map(async (model): Promise<ReviewerReview> => {
      try {
        const { text, tokens } = await runModel({ model, system, user: brief, timeoutMs: callTimeoutMs })
        const parsed = parseReviewerOutput(model, text)
        parsed.tokens = tokens
        return parsed
      } catch (e) {
        notes.push(`reviewer ${model} failed: ${(e as Error)?.message || 'error'}`)
        return { model, verdict: 'needs-discussion', summary: '', findings: [], failed: true }
      }
    }),
  )

  let tokensSpent = results.reduce((sum, r) => sum + (r.tokens || 0), 0)
  if (tokensSpent > maxTokens) {
    notes.push(`cost cap: reviewer spend ${tokensSpent} tokens exceeded cap ${maxTokens} — skipping LLM chair`)
  }

  const succeeded = results.filter((r) => !r.failed)
  if (succeeded.length === 0) {
    notes.push('every reviewer failed — honest empty report (fail-open, non-blocking)')
    return {
      target: subject.target,
      verdict: 'needs-discussion',
      reviewers: [],
      rosterSize: roster.length,
      succeeded: 0,
      reviewerVerdicts: results.map((r) => ({ model: r.model, verdict: r.verdict, failed: true })),
      findings: [],
      discarded: [],
      tokensSpent,
      notes,
    }
  }

  // The deterministic merge is the backbone — always runs, never trusts a model
  // to do the counting.
  const merged = mergeFindingsLocally(results)
  const chairModel = opts.chair || process.env.COMMITTEE_CHAIR || DEFAULT_CHAIR
  const verdict = deriveVerdict(results, merged, chairModel)

  // Optional LLM chair narrative — only when asked AND under the cost cap.
  let chairNarrative: string | undefined
  if (opts.useLlmChair && tokensSpent <= maxTokens) {
    try {
      const chairInput = buildChairInput(subject, results, merged)
      const { text, tokens } = await runModel({
        model: chairModel,
        system: chairSystemPrompt(opts.focus),
        user: chairInput,
        timeoutMs: callTimeoutMs,
      })
      chairNarrative = text.trim()
      tokensSpent += tokens || 0
    } catch (e) {
      notes.push(`chair ${chairModel} failed: ${(e as Error)?.message || 'error'} — deterministic merge stands`)
    }
  }

  return {
    target: subject.target,
    verdict,
    reviewers: succeeded.map((r) => r.model),
    rosterSize: roster.length,
    succeeded: succeeded.length,
    reviewerVerdicts: results.map((r) => ({ model: r.model, verdict: r.verdict, failed: r.failed })),
    findings: merged,
    discarded: [],
    chairNarrative,
    tokensSpent,
    notes,
  }
}

/** Build the chair's input: the merged findings + each reviewer's raw review. */
export function buildChairInput(subject: ReviewSubject, reviews: ReviewerReview[], merged: MergedFinding[]): string {
  const parts: string[] = []
  parts.push(`# Committee synthesis for: ${subject.target}`)
  parts.push('')
  parts.push('## Deterministic merge (already deduped + agreement-counted)')
  parts.push('')
  merged.forEach((f, i) => {
    parts.push(
      `${i + 1}. [${f.severity}] ${f.file}${f.line !== null ? `:${f.line}` : ''} — ${f.title} ` +
        `(raised by ${f.agreement}/${reviews.filter((r) => !r.failed).length}: ${f.raisedBy.join(', ')})`,
    )
    if (f.detail) parts.push(`   ${f.detail}`)
  })
  parts.push('')
  parts.push('## Each reviewer (independent)')
  parts.push('')
  reviews.forEach((r, i) => {
    parts.push(`### Reviewer ${i + 1} (${r.model})${r.failed ? ' — FAILED' : ''}`)
    parts.push(`VERDICT: ${r.verdict}`)
    if (r.summary) parts.push(`SUMMARY: ${r.summary}`)
    parts.push('')
  })
  return parts.join('\n')
}

/** An inert, non-blocking report (kill switch / empty roster). */
export function inertReport(target: string, rosterSize: number, notes: string[]): CommitteeReport {
  return {
    target,
    verdict: 'approve', // disabled == non-blocking; never fails a real build
    reviewers: [],
    rosterSize,
    succeeded: 0,
    reviewerVerdicts: [],
    findings: [],
    discarded: [],
    disabled: true,
    tokensSpent: 0,
    notes,
  }
}

// ---------------------------------------------------------------------------
// OFFLINE analyzer: review a STORED generation by chatId (the shipped surface)
// ---------------------------------------------------------------------------

/**
 * OFFLINE quality lens (the issue's headline surface). Load a stored generation
 * by chatId and run the committee over it. NOT wired into the live build path —
 * this is measurement: run it over recent builds, see whether cross-model
 * agreement predicts real defects, THEN decide about gating.
 *
 * Fail-open: a missing/unloadable generation, a killed gate, or total reviewer
 * failure all yield a report (possibly inert/empty) rather than a throw.
 *
 * @param chatId   the stored generation's chat id
 * @param runModel the model I/O (real clients in prod; mocked in tests)
 * @param opts     roster / caps / focus / kill switch
 */
export async function reviewGeneration(
  chatId: string,
  runModel: RunModel,
  opts: CommitteeOptions = {},
): Promise<CommitteeReport> {
  const id = String(chatId || '').trim()
  if (!id) return inertReport('(no chatId)', 0, ['no chatId provided'])

  const enabled = opts.enabled !== undefined ? opts.enabled : !isKilledByEnv()
  if (!enabled) return inertReport(id, resolveRoster(opts).length, ['committee disabled (kill switch)'])

  let gen: Awaited<ReturnType<typeof loadGeneration>> = null
  try {
    gen = await loadGeneration(id)
  } catch (e) {
    return inertReport(id, resolveRoster(opts).length, [`loadGeneration failed: ${(e as Error)?.message || 'error'}`])
  }
  if (!gen) return inertReport(id, resolveRoster(opts).length, [`no stored generation for chatId ${id}`])

  const subject: ReviewSubject = {
    target: id,
    idea: gen.prompt || '',
    files: gen.files || null,
    code: gen.generatedCode || '',
  }
  return runCommittee(subject, runModel, opts)
}

// ---------------------------------------------------------------------------
// Report rendering (pure) — a compact markdown summary for humans/logs
// ---------------------------------------------------------------------------

/** Render a committee report as compact markdown. */
export function renderReport(report: CommitteeReport): string {
  const lines: string[] = []
  lines.push(`# Committee review: ${report.target}`)
  lines.push('')
  if (report.disabled) {
    lines.push('_Committee disabled (kill switch) — no models were called. Non-blocking._')
    if (report.notes.length) lines.push('', ...report.notes.map((n) => `- ${n}`))
    return lines.join('\n')
  }
  lines.push(`**Verdict:** ${report.verdict}`)
  lines.push(
    `**Reviewers:** ${report.succeeded}/${report.rosterSize} succeeded` +
      (report.reviewers.length ? ` (${report.reviewers.join(', ')})` : ''),
  )
  lines.push(`**Tokens:** ~${report.tokensSpent}`)
  lines.push('')
  if (report.reviewerVerdicts.length) {
    lines.push('## Reviewer verdicts')
    for (const rv of report.reviewerVerdicts) {
      lines.push(`- ${rv.model}: ${rv.failed ? 'FAILED' : rv.verdict}`)
    }
    lines.push('')
  }
  lines.push(`## Findings (${report.findings.length})`)
  if (report.findings.length === 0) {
    lines.push('_No findings — committee saw no completeness/correctness issues._')
  } else {
    lines.push('')
    lines.push(`# | Severity | File:line | Title | Raised by`)
    lines.push(`--- | --- | --- | --- | ---`)
    report.findings.forEach((f, i) => {
      const loc = `${f.file}${f.line !== null ? `:${f.line}` : ''}`
      lines.push(`${i + 1} | ${f.severity} | ${loc} | ${f.title} | ${f.agreement}/${report.succeeded}`)
    })
    lines.push('')
    report.findings.forEach((f, i) => {
      lines.push(`### ${i + 1}. [${f.severity}] ${f.title}`)
      lines.push(`- File: ${f.file}${f.line !== null ? `:${f.line}` : ''}`)
      lines.push(
        `- Raised by ${f.agreement}/${report.succeeded} (${f.raisedBy.join(', ')}), confidence ${f.maxConfidence.toFixed(2)}`,
      )
      if (f.detail) lines.push(`- ${f.detail}`)
      if (f.suggestion) lines.push(`- Fix: ${f.suggestion}`)
      lines.push('')
    })
  }
  if (report.chairNarrative) {
    lines.push('## Chair narrative')
    lines.push('')
    lines.push(report.chairNarrative)
    lines.push('')
  }
  if (report.notes.length) {
    lines.push('## Notes')
    lines.push(...report.notes.map((n) => `- ${n}`))
  }
  return lines.join('\n')
}
