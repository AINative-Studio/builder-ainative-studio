#!/usr/bin/env tsx

/**
 * committee-review — run the multi-model completeness committee (builder#346)
 * over a STORED generation, on demand, from the CLI. Measurement before gating.
 *
 * Usage:
 *   tsx scripts/committee-review.ts <chatId> [--focus "..."] [--models a,b,c]
 *                                            [--llm-chair] [--json]
 *
 * Env:
 *   AINATIVE_API_TOKEN   auth for non-Claude reviewers (via the AINative proxy)
 *   ANTHROPIC_API_KEY / Bedrock env   for the Claude reviewer/chair
 *   COMMITTEE_MODELS     override the roster (comma-separated)
 *   COMMITTEE_CHAIR      override the chair model
 *   COMMITTEE_GATE_DISABLED=1   kill switch → inert non-blocking report
 *
 * This never touches the live build path — it loads a generation by chatId and
 * runs the committee over it, printing the merged, agreement-counted report.
 */

import * as dotenv from 'dotenv'
import { reviewGeneration, renderReport, type CommitteeOptions } from '../lib/build/committee-gate'
import { runModelLive } from '../lib/build/committee-runner'

dotenv.config()

function parseArgs(argv: string[]): { chatId: string; opts: CommitteeOptions; json: boolean } {
  const opts: CommitteeOptions = {}
  let chatId = ''
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--focus') opts.focus = argv[++i]
    else if (a === '--models') opts.models = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--chair') opts.chair = argv[++i]
    else if (a === '--llm-chair') opts.useLlmChair = true
    else if (a === '--json') json = true
    else if (!a.startsWith('--') && !chatId) chatId = a
  }
  return { chatId, opts, json }
}

async function main() {
  const { chatId, opts, json } = parseArgs(process.argv.slice(2))
  if (!chatId) {
    console.error('usage: tsx scripts/committee-review.ts <chatId> [--focus "..."] [--models a,b,c] [--llm-chair] [--json]')
    process.exit(2)
  }
  console.error(`== committee review of generation ${chatId} ...`)
  const report = await reviewGeneration(chatId, runModelLive, opts)
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(renderReport(report) + '\n')
  }
}

main().catch((e) => {
  // Fail-open even at the CLI: print, non-zero exit for scripting, never a stack dump.
  console.error('committee-review failed:', (e as Error)?.message || e)
  process.exit(1)
})
