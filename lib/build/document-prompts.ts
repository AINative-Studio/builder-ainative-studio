/**
 * Document generation prompts + the daily-report builder (#64).
 *
 * QUALITY BAR (from the issue comment): research/audit docs must be STRUCTURED —
 * Executive Summary → Key Findings → Sources — with real citations, not lorem.
 * Generation is grounded in the founder's real idea/company; where the model can't
 * ground a claim in a real source it must say so honestly rather than fabricate.
 *
 * Two paths:
 *   1. Durable documents (research/roadmap/mission/market) — Claude authors STRICT
 *      structured markdown from the idea. Reuses the SAME completion stack as the
 *      artifact generator (lib/build/claude-completion → Bedrock/Anthropic), so it
 *      works server-side for every visitor and needs no new provider.
 *   2. Daily operational reports — built deterministically from the REAL nightly
 *      run result (what the swarm did, its task id + status, next actions). No
 *      model call needed: the report is grounded in actual loop data, so it is
 *      never fabricated. Pure + unit-testable.
 */

import type { DocType } from '@/lib/build/document-store'

/** Context for generating a durable document. */
export interface DocGenContext {
  idea: string
  companyName: string
  track: 'app' | 'company'
}

/** A generation spec for one durable document type. */
export interface DocPromptSpec {
  /** Default title for the generated document. */
  title: (ctx: DocGenContext) => string
  /** System prompt: the role + strict structure contract. */
  system: string
  /** Build the user prompt from the context. */
  user: (ctx: DocGenContext) => string
}

/**
 * The shared structure contract enforced on EVERY durable document: the model must
 * return well-formed markdown with an Executive Summary, Key Findings, and a Sources
 * section with real citations — and must flag any claim it cannot ground rather than
 * invent a citation. This is the anti-lorem guarantee from the quality bar.
 */
const STRUCTURE_CONTRACT =
  'You are Cody, an AI technical co-founder inside AINative Builder. You author ' +
  'investor-grade, decision-useful documents for a specific company — never generic ' +
  'filler, never lorem ipsum. Every document you return is well-formed GitHub-flavoured ' +
  'markdown with EXACTLY these top-level sections in order:\n' +
  '## Executive Summary\n## Key Findings\n## Sources\n' +
  'Rules:\n' +
  '- Executive Summary: 2–4 tight sentences a founder can act on.\n' +
  '- Key Findings: 4–8 specific, concrete bullets grounded in THIS company/idea. ' +
  'Each finding is a real claim, not a platitude.\n' +
  '- Sources: real, checkable citations as a markdown list (name + URL where a real ' +
  'public source exists). If you cannot ground a claim in a real source, write ' +
  '"- No public source located — flagged as an assumption to verify." Do NOT invent URLs.\n' +
  '- Return ONLY the markdown document. No preamble, no code fences.'

/** Per-type generation prompts for the four durable Polsia-style documents. */
export const DOCUMENT_PROMPTS: Partial<Record<DocType, DocPromptSpec>> = {
  research: {
    title: (ctx) => `Research: Audit competing platforms for ${ctx.companyName}`,
    system: STRUCTURE_CONTRACT,
    user: (ctx) =>
      `Company: ${ctx.companyName}\nIdea:\n"""${ctx.idea}"""\n\n` +
      'Write a COMPETITIVE RESEARCH & AUDIT document. In Key Findings, name the real ' +
      'top competing platforms/products in this space, what each does well, and where ' +
      'the wedge is for this company. Ground competitor names in reality; cite their ' +
      'sites in Sources. Flag anything you cannot verify.',
  },
  market: {
    title: (ctx) => `Market Research: ${ctx.companyName}`,
    system: STRUCTURE_CONTRACT,
    user: (ctx) =>
      `Company: ${ctx.companyName}\nIdea:\n"""${ctx.idea}"""\n\n` +
      'Write a MARKET RESEARCH document. In Key Findings, cover the target segment, a ' +
      'realistic market-size estimate (state the basis), demand signals, and the go-to-market ' +
      'wedge. Cite real reports/sources where possible; flag estimates you cannot ground.',
  },
  mission: {
    title: (ctx) => `${ctx.companyName} Mission`,
    system: STRUCTURE_CONTRACT,
    user: (ctx) =>
      `Company: ${ctx.companyName}\nIdea:\n"""${ctx.idea}"""\n\n` +
      'Write the COMPANY MISSION document. Executive Summary is the mission statement. ' +
      'Key Findings are the operating principles + the change this company exists to make. ' +
      'Sources may cite the founding idea/context; flag external claims you cannot ground.',
  },
  roadmap: {
    title: (ctx) => `${ctx.companyName} Product Roadmap`,
    system: STRUCTURE_CONTRACT,
    user: (ctx) =>
      `Company: ${ctx.companyName}\nIdea:\n"""${ctx.idea}"""\n\n` +
      'Write the PRODUCT ROADMAP document. Key Findings are the sequenced milestones ' +
      '(Now / Next / Later) with the concrete outcome each unlocks for THIS product. ' +
      'Sources cite the idea + any real dependencies; flag assumptions.',
  },
}

/** Is this a durable document type we know how to generate via Claude? Pure. */
export function isGeneratableDocType(type: DocType): type is 'research' | 'market' | 'mission' | 'roadmap' {
  return type in DOCUMENT_PROMPTS
}

// ---------------------------------------------------------------------------
// Daily operational report — built from REAL nightly-run data (no model call)
// ---------------------------------------------------------------------------

/** The real nightly-run signal a daily report is grounded in. */
export interface DailyReportInput {
  companyName: string
  /** ISO date the run happened (defaults to now). */
  runAt?: string
  /** The swarm task id dispatched this run, if any. */
  taskId?: string | null
  /** The run status ('dispatched' | 'skipped' | 'error' | …). */
  status?: string
  /** The data-informed briefing the loop pulled, if any. */
  briefing?: string | null
  /** The loop's own detail line (what happened). */
  detail?: string
}

/** Format an ISO date as "Aug 25, 2026" for the report title/body. Pure. */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Build the daily operational report title from the run date. Pure — so the report
 * appended by the nightly loop always carries an honest, dated title.
 */
export function dailyReportTitle(input: DailyReportInput): string {
  const runAt = input.runAt || new Date().toISOString()
  return `Daily Operational Report — ${formatDate(runAt)}`
}

/**
 * Build the daily operational report body as STRUCTURED markdown, grounded ENTIRELY
 * in the real nightly-run result (what the swarm did, the task id + status, and the
 * honest next action). Follows the same Executive Summary → Key Findings → Sources
 * structure as durable docs, so VIEW renders it consistently. No fabrication: when
 * the run was skipped/errored the report says so plainly. Pure + unit-testable.
 */
export function buildDailyReport(input: DailyReportInput): string {
  const runAt = input.runAt || new Date().toISOString()
  const status = String(input.status || 'unknown').toLowerCase()
  const dispatched = status === 'dispatched' && !!input.taskId
  const company = input.companyName || 'the company'

  const summary = dispatched
    ? `Overnight, Cody evaluated ${company} and dispatched the highest-leverage task to the AINative agent swarm (task ${input.taskId}). The swarm executes asynchronously; results feed back into tomorrow's briefing.`
    : status === 'skipped'
      ? `The nightly loop was skipped for ${company} this run (${input.detail || 'no work dispatched'}). No changes were made overnight.`
      : `The nightly loop for ${company} did not complete a dispatch this run (status: ${status}${input.detail ? `; ${input.detail}` : ''}). No changes were made overnight — this is flagged for review.`

  const findings: string[] = []
  findings.push(`- Run at ${formatDate(runAt)} (${runAt}).`)
  findings.push(`- Loop status: ${status}.`)
  if (input.taskId) findings.push(`- Swarm task dispatched: ${input.taskId}.`)
  if (input.briefing) {
    findings.push(`- Data-informed briefing used: ${String(input.briefing).slice(0, 300)}`)
  } else {
    findings.push('- No data-informed briefing was available for this run.')
  }
  if (input.detail) findings.push(`- Detail: ${String(input.detail).slice(0, 300)}`)

  const nextActions = dispatched
    ? '- Poll the dispatched swarm task for its result and review the produced artifact.\n- Cody will pick the next highest-leverage task on tomorrow\'s run.'
    : '- Investigate why no task was dispatched (enrollment, plan tier, or API availability).\n- The loop will retry on the next nightly run.'

  return (
    `## Executive Summary\n${summary}\n\n` +
    `## Key Findings\n${findings.join('\n')}\n\n### Next actions\n${nextActions}\n\n` +
    `## Sources\n- Nightly autonomous loop run record (task id + status), ${runAt}.\n` +
    (input.briefing
      ? '- AINative Agent Intelligence briefing (lakehouse-derived).\n'
      : '- No external briefing source for this run.\n')
  )
}
