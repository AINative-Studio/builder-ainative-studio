/**
 * #2226 — one-shot re-verification CLI for the single-file `/api/preview/{id}`
 * serving path, the same role `scripts/recheck-known-render-issues.ts` (#2164)
 * plays for the `files`-map/Sandpack path. See
 * `lib/build/single-file-preview-health.ts` for why this needed its own tool
 * and its own (deliberately narrow) notion of "broken."
 *
 * Read-only: fetches the real, public `GET /api/preview/{chatId}` HTML and
 * runs a pure string check against it. Never mutates ZeroDB, the backlog, or
 * Gitea, and never regenerates anything.
 *
 * Usage:
 *   npx tsx scripts/recheck-single-file-previews.ts
 *   BUILDER_BASE_URL=http://localhost:3000 npx tsx scripts/recheck-single-file-previews.ts
 *
 * To track a newly-found single-file company for future runs, add it to
 * TRACKED_COMPANIES below.
 */

export {}

import { checkSingleFilePreviewHealth } from '../lib/build/single-file-preview-health'

const BASE_URL = process.env.BUILDER_BASE_URL || 'https://builder.ainative.studio'
const FETCH_TIMEOUT_MS = 15000

export interface TrackedSingleFileCompany {
  /** Showcase slug or a short human label — for the printed report only, not looked up. */
  label: string
  chatId: string
  note?: string
}

/**
 * Companies confirmed, via `GET /api/generation/{chatId}/files` returning
 * 404 `{files:null}`, to be on the single-file preview path — the first 9
 * sampled fresh from a random 25-company showcase pull (#2226, 2026-11-24).
 * A 2026-11-28 full-showcase sweep (all 163 entries, not a random subset)
 * found 23 more companies on this same path and confirmed every one of
 * them — all 32, now tracked here — comes back `HTTP 200` with a real
 * bundle and no reliable broken-build signal. (That sweep's own naive
 * substring check for "needs another pass" initially flagged all 32 as
 * broken — a reconfirmation of the exact UNRELIABLE-signal false positive
 * this module's own doc comment above warns about; the real detector below
 * correctly clears all of them.)
 */
export const TRACKED_COMPANIES: TrackedSingleFileCompany[] = [
  { label: 'flipsight', chatId: '7jN9GGnX5R3wv6sO7pNrv' },
  { label: 'to-connect-blue-collar-workers', chatId: 'SxztCIYv_gRkZs0B2pw6o' },
  { label: 'build-me-an-e-commerce-store (PQVq8S)', chatId: 'PQVq8SZT_J85xaJI0FwCU' },
  { label: 'make-an-app-that-helps-people-study', chatId: 'aBgB4heEyIxtvE10IvMqq' },
  { label: 'candor', chatId: 'fJj-trxTxpMTi1caNutXZ' },
  { label: 'on-line-reselling-business', chatId: 'yjAmTWoW7JbV6phHXt6wv' },
  { label: 'an-app-that-helps-kids-with-their-school', chatId: 'EbQGqn6Eecb1ZpXdoDwgT' },
  { label: 'haulio', chatId: 'WqDndNjnRwqZzHcvQbF9D' },
  { label: 'castlo', chatId: 'LcSXVuIK1me7HJkMxhr3v' },
  // Added from a 2026-11-28 full-showcase sweep (163 entries, not just a
  // random 25) — every one of these also 404s on the files map, putting
  // them on this same single-file path. Not yet checked against the real
  // reliable-signal detector before being added here.
  { label: 'me', chatId: 'vC5htDrfi2gBc6BlfHtAt' },
  { label: 'build-me-an-e-commerce-store-called-saltmarsh', chatId: 'serlTe04zKUfijFfjyHQe' },
  { label: 'launch-an-online-store', chatId: '91YxTtSKbVYNiJgy-0E-i' },
  { label: 'dwello', chatId: 'YePdYWSy6Gaype04fFfHL' },
  { label: 'pathly', chatId: '47FNBgmHj-qydw0NwRwKZ' },
  { label: 'value-economy', chatId: '6BeXqyuokIIE_w7Je9Z77' },
  { label: 'portside', chatId: 'yThGXwjMuoiFab1065Hh3' },
  { label: 'taplo', chatId: 'fm11HOkVnvO_xvWTCmMtO' },
  { label: 'graintrack', chatId: 'nNRcCA0hmHItLU7UinPcR' },
  { label: 'competitive-pokemon-players-app', chatId: 'xUyCHC1TZw7pojLaL5t-V' },
  { label: 'naruto-tabletop-game-app', chatId: 'NHOKwlyVsgzP4QCiRqlsc' },
  { label: 'maga-make-ai-gender-accessible', chatId: 'YP1qW0Q8K3jnzn7wafrhg' },
  { label: 'field-service-management-platform', chatId: 'KlIrLdV7Pyy4g-iLq_nkJ' },
  { label: 'agentive (Ycqjs_)', chatId: 'Ycqjs_v_ml46g1olEN2fR' },
  { label: 'autistic-teenagers-app', chatId: 'KwvjsMdumiay-VTeqin8N' },
  { label: 'volunteer-firefighters-app', chatId: 'yOmymZb0xqLBp0s0xf-mP' },
  { label: 'live-and-on-demand-video', chatId: '_X5waUU_hnSOxulOAO9Al' },
  { label: 'mendr', chatId: 'Ej-3Nfiqo_JTzmXVeFEXV' },
  { label: 'b2b-sales-crm-for-roofing-contractors-run (C_O75c)', chatId: 'C_O75cEHTLBsasHB1iQn_' },
  { label: 'b2b-sales-crm-for-roofing-contractors-run (_xdtUD)', chatId: '_xdtUD46UUyQlp-pvIckn' },
  { label: 'task-management-dashboard (agent-primary-verify)', chatId: 'agent-primary-verify-1789275299' },
  { label: 'subscription-box-hot-sauce (goeRs5)', chatId: 'goeRs5G6t8zcfk1HENKLE' },
  { label: 'subscription-box-hot-sauce (-lnM0i)', chatId: '-lnM0ihP9ZdeByixJj_gU' },
]

async function fetchPreviewHtml(chatId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/preview/${chatId}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const body = await res.text()
  if (!res.ok && !body) throw new Error(`HTTP ${res.status}`)
  return body
}

async function main() {
  console.log(
    `[recheck-single-file-previews] re-checking ${TRACKED_COMPANIES.length} tracked single-file companies against ${BASE_URL}`,
  )

  let healthy = 0
  let confirmedBroken = 0
  let inconclusive = 0
  let errored = 0

  for (const company of TRACKED_COMPANIES) {
    const prefix = `  ${company.label} (${company.chatId}):`
    try {
      const html = await fetchPreviewHtml(company.chatId)
      const result = checkSingleFilePreviewHealth(html)
      if (result.brokenServerSide) {
        confirmedBroken++
        console.log(`${prefix} CONFIRMED BROKEN — real server-side pre-validation failure page served`)
      } else if (result.looksLikeRealBundle) {
        healthy++
        console.log(`${prefix} no reliable broken-build signal (real bundle served) — NOT full browser confirmation, see module doc`)
      } else {
        inconclusive++
        console.log(`${prefix} INCONCLUSIVE — response didn't match either known shape, inspect manually`)
      }
      if (company.note) console.log(`      note: ${company.note}`)
    } catch (e) {
      errored++
      console.log(`${prefix} ERROR: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log(
    `[recheck-single-file-previews] summary: healthy=${healthy} confirmedBroken=${confirmedBroken} inconclusive=${inconclusive} errored=${errored} total=${TRACKED_COMPANIES.length}`,
  )
}

main()
