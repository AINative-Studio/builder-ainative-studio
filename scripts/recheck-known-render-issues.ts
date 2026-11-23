/**
 * #2164 — one-shot re-verification CLI for companies this loop has already
 * reported as having a broken current generation.
 *
 * This repo's overnight render-integrity loop repeatedly finds real,
 * broken companies (missing local import, truncated file, undefined
 * reference, …), files an issue, and — once a fix for the underlying
 * DETECTOR or backfill-sweep code lands — the issue gets closed. Nothing
 * ever goes back and re-checks whether that SPECIFIC company's own
 * generation was actually repaired. #1990 ("Agentive") is the confirmed
 * repro: closed as completed 2026-11-13, still broken, byte-for-byte, when
 * #2164 re-checked it 5+ days later.
 *
 * This script re-fetches each tracked company's CURRENT
 * `GET /api/generation/{chatId}/files` payload (a public endpoint — no
 * credentials needed) and re-runs the real checks via
 * lib/build/render-health-recheck.ts. It is read-only: it never writes to
 * ZeroDB, the backlog, or Gitea, and never regenerates anything.
 *
 * A company that now comes back CLEAN is a real signal worth a human
 * comment/close on its tracking issue (see #2151's thread for an example of
 * that happening this run). A company still broken is simply re-confirming
 * the existing finding — not news on its own, but useful to know the
 * backlog hasn't silently drifted.
 *
 * Usage:
 *   npx tsx scripts/recheck-known-render-issues.ts
 *   BUILDER_BASE_URL=http://localhost:3000 npx tsx scripts/recheck-known-render-issues.ts
 *
 * To track a newly-found broken company for future runs, add it to
 * TRACKED_COMPANIES below.
 */

export {}

import { checkRenderHealth } from '../lib/build/render-health-recheck'

const BASE_URL = process.env.BUILDER_BASE_URL || 'https://builder.ainative.studio'
const FETCH_TIMEOUT_MS = 15000

export interface TrackedCompany {
  /** Showcase slug or a short human label — for the printed report only, not looked up. */
  label: string
  chatId: string
  /** Issue(s) that reported this company as broken, e.g. "#1990, #2164". */
  issueRef: string
  /** Optional context a reader needs to interpret a "still broken" result correctly. */
  note?: string
}

/**
 * Companies this loop has confirmed broken so far, newest-finding first.
 * Append to this list whenever a future run confirms a new live repro —
 * don't resample the whole showcase from scratch every time.
 */
export const TRACKED_COMPANIES: TrackedCompany[] = [
  { label: 'silo', chatId: 'GqdGgOj6eJl4l5GFdtBQn', issueRef: '#2169' },
  {
    label: 'a-b2b-sales-crm-for-roofing-contractors (f4k20l)',
    chatId: 'f4k20l6jcFZLBuIf8HpKT',
    issueRef: '#2169',
  },
  {
    label: 'a-b2b-sales-crm-for-roofing-contractors-run (49AttP)',
    chatId: '49AttPLPQ4_5RgIohMhtY',
    issueRef: '#2159',
  },
  {
    label: 'a-b2b-sales-crm-for-roofing-contractors-run (Mkv1K7)',
    chatId: 'Mkv1K796zLs19K-WX7nt5',
    issueRef: '#2164',
  },
  { label: 'dispatch', chatId: 'pjB5gMxCNJ-2XqyZa7l5l', issueRef: '#2159' },
  { label: 'ai-marketing-studio', chatId: 'B8OnZCMYJdZRY-C366utU', issueRef: '#2161' },
  { label: 'aerosol', chatId: 'TBPoqlfc5nOU71UuyF_BH', issueRef: '#2161' },
  {
    label: 'a-personalized-ai-career-coach',
    chatId: 'eygeSq95XRTDRG4PGtG9v',
    issueRef: '#2161',
  },
  {
    label: 'a-personalized-financial-coaching-platform',
    chatId: 'BXmf9E9Nc9frHgXV4JHI3',
    issueRef: '#2164',
  },
  {
    label: 'luminary',
    chatId: 'xW3lIi44cTNLYsOdeOUzj',
    issueRef: '#2013, #2161, #2169',
  },
  {
    label: 'Agentive',
    chatId: 'vA8NFX4YMxZRfoANXohG_',
    issueRef: '#1990 (closed completed), #2164',
    note: '#1990 was closed as completed while still broken — the canonical repro for this gap.',
  },
  {
    label: 'wallkind',
    chatId: 'z4nabGqvy_UURyaKnCY8J',
    issueRef: '#2145',
    note: 'Confirmed by #2145 to NOT currently crash the live Sandpack preview — stubTruncatedFiles() replaces the flagged file before Sandpack sees it. A "still broken" result here means the underlying file is still truncated, not that the live preview is crashing.',
  },
  {
    label: 'a-game-that-helps-students-get-cyber-security (Hexlock)',
    chatId: 'PRBKNyWS2AJ7yz599rRpb',
    issueRef: '#2145',
    note: 'Same Sandpack-stub protection as wallkind above — see that note.',
  },
  {
    label: 'driftly',
    chatId: '94PwzN2gZ_8H9CovLRI9_',
    issueRef: '#2151, #2221',
    note: "This tool's files-map check reports CLEAN, but #2221 confirmed the real live page (GET /api/preview/{chatId}) is still broken — the files map and generatedCode blob have drifted apart (#1994/#2153). This is exactly the singleFileFlowUncovered:true case: do NOT treat a clean result here as #2151 being fixed until PR #2155 (generatedCode/files drift fix) lands and the real preview URL is re-checked directly.",
  },
  {
    label: 'revela',
    chatId: '-TRhRDvEXrmh-eQBF0zGr',
    issueRef: '#2026, #2027, #2220',
    note: 'Raw Navbar.tsx/HowItWorks.tsx use XIcon/MenuIcon/LoginIcon/AnalyticsIcon/LightningIcon with zero imports — genuinely self-healed by buildSandpackFiles()\'s sibling-import injector (confirmed #2220). Before #2220\'s fix this read as CONFIRMED RENDER-BREAKING because validationError was never re-checked against the self-healed output — kept here so a real regression in that injector shows up immediately.',
  },
  {
    label: 'younova',
    chatId: 'hN2q6yoEMkCXzrcbm-5-6',
    issueRef: '#2021, #2029, #2031, #2220',
    note: 'Raw App.tsx uses TaskList with zero import — genuinely self-healed by buildLocalDefaultExportMap()\'s default-export sibling injector (confirmed #2220). Same before/after-#2220 note as revela above.',
  },
]

async function fetchGenerationFiles(chatId: string): Promise<Record<string, string> | undefined> {
  const res = await fetch(`${BASE_URL}/api/generation/${chatId}/files`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.files
}

async function main() {
  console.log(
    `[recheck-known-render-issues] re-checking ${TRACKED_COMPANIES.length} tracked companies against ${BASE_URL}`,
  )

  let clean = 0
  let selfHealed = 0
  let confirmedBroken = 0
  let errored = 0

  for (const company of TRACKED_COMPANIES) {
    const prefix = `  ${company.label} (${company.chatId}) [${company.issueRef}]:`
    try {
      const files = await fetchGenerationFiles(company.chatId)
      const result = checkRenderHealth(files)

      if (!result.hasFilesMap) {
        errored++
        console.log(`${prefix} NO FILES MAP available from the public API`)
        continue
      }

      // #2220: result.selfHealed/result.confirmedRenderBreaking now account
      // for validateJavaScriptCode's validationError too (re-run against the
      // self-healed buildSandpackFiles() output as builtValidationError), not
      // just missingImports/truncatedFiles — so a raw defect of ANY of the
      // three kinds that the real pipeline already repairs before Sandpack
      // renders it is correctly classified selfHealed here, not confirmed-broken.
      // #2221: a clean/selfHealed verdict only covers the `files` map via
      // buildSandpackFiles() — for a single-file company (shouldUseSandpack
      // false), the REAL page is served from a separate `generatedCode` blob
      // this function never looks at, which can drift from `files`
      // (#1994/#2153, confirmed live for driftly/#2151). Never suggest
      // closing a tracking issue off a clean/selfHealed result alone when
      // this is true — it means "the files map looks fine", not "the real
      // page is fine".
      const uncoveredSuffix = result.singleFileFlowUncovered
        ? ' — WARNING: single-file preview path (generatedCode) not covered by this check; do NOT close the tracking issue off this result alone, verify the real /api/preview/{chatId} page too'
        : ''

      if (result.clean) {
        clean++
        console.log(
          `${prefix} CLEAN${result.singleFileFlowUncovered ? '' : ' — re-verify and consider updating the tracking issue'}${uncoveredSuffix}`,
        )
      } else if (result.selfHealed) {
        clean++
        console.log(
          `${prefix} RAW DEFECT, SELF-HEALED — not a live crash (missingImports=` +
            `${JSON.stringify(result.missingImports)} truncatedFiles=${JSON.stringify(result.truncatedFiles)} ` +
            `validationError=${result.validationError ? JSON.stringify(result.validationError) : 'null'}); ` +
            `feeds the completeness-backfill sweep, not a render-breaking claim${uncoveredSuffix}`,
        )
      } else {
        confirmedBroken++
        console.log(
          `${prefix} CONFIRMED RENDER-BREAKING builtMissingImports=${JSON.stringify(result.builtMissingImports)} ` +
            `builtTruncatedFiles=${JSON.stringify(result.builtTruncatedFiles)} ` +
            `builtValidationError=${result.builtValidationError ? JSON.stringify(result.builtValidationError) : 'null'}`,
        )
      }
      if (company.note) console.log(`      note: ${company.note}`)
    } catch (e) {
      errored++
      console.log(`${prefix} ERROR ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log(
    `[recheck-known-render-issues] summary: clean=${clean} confirmedRenderBreaking=${confirmedBroken} ` +
      `errored=${errored} total=${TRACKED_COMPANIES.length}`,
  )
}

main().catch((e) => {
  console.error('[recheck-known-render-issues] fatal error:', e)
  process.exit(1)
})
