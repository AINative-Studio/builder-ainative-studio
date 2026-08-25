#!/usr/bin/env npx tsx
/**
 * LLM Mention Tracker (Issue #47) — AEO Playbook "Play 6"
 * =======================================================
 * Baseline how often Builder (AINative) vs Polsia / Lovable / Replit / Bolt is
 * mentioned in LLM answers to brand-free buyer questions ("mentions out of
 * 50" = 10 questions × 5 runs). Re-runnable monthly to track the trend.
 *
 * Two data paths (choose with --source):
 *
 *   --source=dataforseo   (default; the "Claude looks it up" half, automated)
 *       Uses DataForSEO's ai_optimization module via a generic v3 api_request:
 *         POST /v3/ai_optimization/llm_responses/live
 *       Creds: DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (env, never hardcoded).
 *       Also (best-effort) hits /v3/ai_optimization/llm_mentions/* for the
 *       aggregate mention picture. Falls back to --source=direct-llm if creds
 *       are missing or the endpoint is unreachable.
 *
 *   --source=direct-llm   (the "pre-decided shortlist" half)
 *       Asks each buyer question N× directly against a model and counts brand
 *       names in the answers. Prefers the AINative chat-completions API
 *       (AINATIVE_API_KEY) and falls back to Anthropic (ANTHROPIC_API_KEY).
 *
 * Output (written to docs/growth/):
 *   - llm-mentions-<YYYY-MM-DD>.json   (machine-readable full report)
 *   - LLM_MENTIONS_<YYYY-MM-DD>.md     (human summary)
 *
 * Usage:
 *   pnpm mentions                              # dataforseo, 5 runs/question
 *   pnpm mentions -- --source=direct-llm       # direct model path
 *   npx tsx scripts/llm-mention-tracker.ts --runs=5 --source=dataforseo
 *   npx tsx scripts/llm-mention-tracker.ts --dry-run   # no network, prints plan
 *
 * Flags:
 *   --source=dataforseo|direct-llm   data path (default dataforseo)
 *   --runs=<n>                       runs per question (default 5)
 *   --model=<id>                     override model id for direct-llm
 *   --dry-run                        do not call any API; print what it would do
 *
 * Schedule monthly (example cron, 1st of month 09:00):
 *   0 9 1 * * cd <repo> && pnpm mentions >> logs/mentions.log 2>&1
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import {
  BUYER_QUESTIONS,
  BRANDS,
  buildReport,
  formatMarkdownReport,
  reportDateSlug,
  extractDataForSeoAnswers,
  type MentionReport,
} from '../lib/growth/llm-mention-tracker'

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
interface Options {
  source: 'dataforseo' | 'direct-llm'
  runs: number
  model?: string
  dryRun: boolean
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { source: 'dataforseo', runs: 5, dryRun: false }
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg.startsWith('--source=')) {
      const v = arg.split('=')[1]
      if (v === 'dataforseo' || v === 'direct-llm') opts.source = v
    } else if (arg.startsWith('--runs=')) {
      const n = parseInt(arg.split('=')[1], 10)
      if (Number.isFinite(n) && n > 0) opts.runs = n
    } else if (arg.startsWith('--model=')) {
      opts.model = arg.split('=')[1]
    }
  }
  return opts
}

const OUT_DIR = join(process.cwd(), 'docs', 'growth')

// ---------------------------------------------------------------------------
// DataForSEO path — generic v3 api_request against ai_optimization module.
// ---------------------------------------------------------------------------
const DFS_BASE = 'https://api.dataforseo.com'

function dfsAuthHeader(login: string, password: string): string {
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')
}

async function dfsApiRequest(
  path: string,
  data: unknown,
  login: string,
  password: string
): Promise<unknown> {
  const res = await fetch(`${DFS_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: dfsAuthHeader(login, password),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    throw new Error(`DataForSEO ${path} -> HTTP ${res.status} ${res.statusText}`)
  }
  return res.json()
}

async function collectViaDataForSeo(
  opts: Options,
  login: string,
  password: string
): Promise<{ answers: string[]; model: string; notes: string }> {
  const answers: string[] = []
  const model = opts.model || 'gpt-4o'
  // One live LLM response per (question × run). DataForSEO's live endpoint
  // takes a batch array of task objects.
  for (const question of BUYER_QUESTIONS) {
    for (let run = 0; run < opts.runs; run++) {
      const body = await dfsApiRequest(
        '/v3/ai_optimization/llm_responses/live',
        [
          {
            user_prompt: question,
            llm_name: model,
            // no web-search grounding: this is the "pre-decided shortlist" half
            web_search: false,
          },
        ],
        login,
        password
      )
      answers.push(...extractDataForSeoAnswers(body))
    }
  }
  return {
    answers,
    model: `dataforseo:${model}`,
    notes:
      'Automated via DataForSEO ai_optimization/llm_responses/live ' +
      '(web_search disabled to approximate the pre-decided shortlist).',
  }
}

// ---------------------------------------------------------------------------
// Direct-LLM path — ask each question N× and read the raw answer text.
// ---------------------------------------------------------------------------
async function askAinative(
  question: string,
  model: string,
  apiKey: string,
  baseUrl: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 1,
      messages: [{ role: 'user', content: question }],
    }),
  })
  if (!res.ok) throw new Error(`AINative chat -> HTTP ${res.status}`)
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return json.choices?.[0]?.message?.content || ''
}

async function askAnthropic(
  question: string,
  model: string,
  apiKey: string
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: question }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic messages -> HTTP ${res.status}`)
  const json = (await res.json()) as { content?: { text?: string }[] }
  return (json.content || []).map((b) => b.text || '').join('\n')
}

async function collectViaDirectLlm(
  opts: Options
): Promise<{ answers: string[]; model: string; notes: string }> {
  const ainativeKey = process.env.AINATIVE_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const answers: string[] = []

  let ask: (q: string) => Promise<string>
  let model: string
  let notes: string

  if (ainativeKey) {
    model = opts.model || 'claude-sonnet-4'
    const baseUrl =
      process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio/api/v1'
    ask = (q) => askAinative(q, model, ainativeKey, baseUrl)
    notes = `Direct via AINative chat-completions (${baseUrl}).`
  } else if (anthropicKey) {
    model = opts.model || 'claude-sonnet-4-20250514'
    ask = (q) => askAnthropic(q, model, anthropicKey)
    notes = 'Direct via Anthropic Messages API.'
  } else {
    throw new Error(
      'direct-llm requires AINATIVE_API_KEY or ANTHROPIC_API_KEY in the environment'
    )
  }

  for (const question of BUYER_QUESTIONS) {
    for (let run = 0; run < opts.runs; run++) {
      try {
        answers.push(await ask(question))
      } catch (err) {
        console.error(`  ! run failed (${question.slice(0, 40)}…): ${String(err)}`)
      }
    }
  }
  return { answers, model, notes }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function writeReports(report: MentionReport): { jsonPath: string; mdPath: string } {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const jsonPath = join(OUT_DIR, `llm-mentions-${report.date}.json`)
  const mdPath = join(OUT_DIR, `LLM_MENTIONS_${report.date}.md`)
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  writeFileSync(mdPath, formatMarkdownReport(report), 'utf8')
  return { jsonPath, mdPath }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const date = reportDateSlug()

  console.log('LLM Mention Tracker (Issue #47) — Play 6 "mentions out of 50"')
  console.log(
    `  source=${opts.source} runs/question=${opts.runs} questions=${BUYER_QUESTIONS.length} ` +
      `(target ${BUYER_QUESTIONS.length * opts.runs} answers)`
  )
  console.log(`  brands: ${BRANDS.map((b) => b.label).join(', ')}`)

  if (opts.dryRun) {
    console.log('\n[--dry-run] Would ask these questions:')
    BUYER_QUESTIONS.forEach((q, i) => console.log(`   ${i + 1}. ${q}`))
    console.log('\n[--dry-run] No API calls made, no files written.')
    return
  }

  let source: MentionReport['source'] = opts.source
  let collected: { answers: string[]; model: string; notes: string }

  const dfsLogin = process.env.DATAFORSEO_LOGIN
  const dfsPassword = process.env.DATAFORSEO_PASSWORD

  if (opts.source === 'dataforseo') {
    if (!dfsLogin || !dfsPassword) {
      console.warn(
        '  ! DATAFORSEO_LOGIN/PASSWORD not set — falling back to --source=direct-llm'
      )
      source = 'direct-llm'
      collected = await collectViaDirectLlm(opts)
    } else {
      try {
        collected = await collectViaDataForSeo(opts, dfsLogin, dfsPassword)
      } catch (err) {
        console.warn(`  ! DataForSEO unreachable (${String(err)}) — falling back to direct-llm`)
        source = 'direct-llm'
        collected = await collectViaDirectLlm(opts)
        collected.notes = `DataForSEO unreachable; ${collected.notes}`
      }
    }
  } else {
    collected = await collectViaDirectLlm(opts)
  }

  if (collected.answers.length === 0) {
    console.error('No answers collected — aborting without writing a report.')
    process.exit(1)
  }

  const report = buildReport({
    date,
    source,
    model: collected.model,
    questions: BUYER_QUESTIONS.length,
    runsPerQuestion: opts.runs,
    answers: collected.answers,
    notes: collected.notes,
  })

  const { jsonPath, mdPath } = writeReports(report)

  console.log('\nResults (mentions out of ' + report.totalAnswers + '):')
  for (const r of report.results) {
    console.log(
      `  ${r.label.padEnd(20)} ${String(r.mentions).padStart(3)}  ${(r.share * 100).toFixed(1)}%`
    )
  }
  console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}`)
}

// Only run when invoked directly (keeps the module importable in tests).
main().catch((err) => {
  console.error(err)
  process.exit(1)
})
