/**
 * #1092 — backfill the Builder webhook onto every already-provisioned company
 * Gitea repo.
 *
 * Root cause this repairs: `docs/GITEA_PROVISIONING.md` documented webhook
 * registration as a one-time MANUAL admin-panel step
 * (https://git.ainative.studio/admin/hooks) — but that manual step never
 * actually happened for any real company repo, so `app/api/webhooks/gitea/
 * route.ts` (the committee PR gate, #1091's build_tasks sync, and push-based
 * redeploys) was silently never called by Gitea in production for ANY
 * company. `createRepoWebhook()` (lib/git/gitea-client.ts) now registers the
 * webhook automatically for every NEW repo going forward (wired into
 * `provisionCompanyRepo`) — this script is the one-time catch-up for
 * companies that were already provisioned before that fix and therefore
 * never re-enter the create path.
 *
 * Enumerates companies via listAllAppsWithStatus() (lib/build/app-registry) —
 * the honest-failure read (core#7395): an empty list here could mean "no
 * companies have a Gitea repo yet" OR "the registry read itself failed," and
 * this script treats those differently (abort vs. "backfill ran, 0 found").
 * Only rows with a real `gitOrg` + `gitRepoId`/`slug` (i.e. already git-
 * provisioned) are candidates — a company with no Gitea repo yet will get its
 * webhook automatically at provisioning time via the gitea-client.ts fix, so
 * this script correctly skips it rather than provisioning anything new.
 *
 * Calls the SAME idempotent `createRepoWebhook()` the provisioning path now
 * uses — safe to run multiple times; a repo that already has the hook is a
 * no-op (pre-flight GET match), never a duplicate.
 *
 * SAFETY: dry run by default (report-only, same posture as every other
 * scripts/backfill-*.ts in this repo). `--execute` is required to actually
 * call createRepoWebhook() and register anything.
 *
 *   Dry run:  npx tsx scripts/backfill-gitea-webhooks.ts
 *   Real run: npx tsx scripts/backfill-gitea-webhooks.ts --execute
 *   Single company (either mode): npx tsx scripts/backfill-gitea-webhooks.ts --slug=wallkind [--execute]
 *
 * Requires GITEA_BASE_URL + GITEA_ADMIN_TOKEN + GITEA_WEBHOOK_SECRET, and
 * ZERODB_API_KEY (or AINATIVE_API_KEY) + ZERODB_PROJECT_ID to enumerate
 * companies — e.g. via `railway run --service builder-ainative-studio`.
 */

export {}

import { listAllAppsWithStatus } from '../lib/build/app-registry'
import { configured, createRepoWebhook, getRepoWebhooks, webhookTargetUrl } from '../lib/git/gitea-client'

const EXECUTE = process.argv.includes('--execute')
const SLUG_ARG = process.argv.find((a) => a.startsWith('--slug='))
const ONLY_SLUG = SLUG_ARG ? SLUG_ARG.slice('--slug='.length).trim() : null

interface BackfillRow {
  slug: string
  gitOrg: string
  gitRepoId?: string
  disposition: 'would_register' | 'already_has_webhook' | 'registered' | 'failed' | 'skipped_no_repo'
  reason?: string
}

async function main() {
  console.log(`\n#1092 Gitea webhook backfill — ${EXECUTE ? 'EXECUTE (writes!)' : 'DRY RUN (no writes, default)'}\n`)

  if (!configured()) {
    console.error('✗ Gitea is not configured (GITEA_BASE_URL/GITEA_ADMIN_TOKEN unset) — backfill did not run.')
    process.exit(1)
  }

  const target = webhookTargetUrl()
  const secret = process.env.GITEA_WEBHOOK_SECRET || ''
  console.log(`  target URL : ${target}`)
  console.log(`  secret set : ${secret ? 'yes' : 'NO (webhook would be created WITHOUT a secret — aborting)'}`)
  if (!secret) {
    console.error('\n✗ GITEA_WEBHOOK_SECRET is not set in this environment — refusing to register webhooks without it.')
    process.exit(1)
  }

  const { apps, ok } = await listAllAppsWithStatus()
  if (!ok) {
    console.error('✗ Company registry read FAILED — backfill did not run.')
    console.error('  An empty result here is NOT "no companies" (see core#7395).')
    process.exit(1)
  }

  const candidates = apps.filter((a) => a.gitOrg && a.slug && (!ONLY_SLUG || a.slug === ONLY_SLUG))
  console.log(`\n  companies with a Gitea repo: ${candidates.length}${ONLY_SLUG ? ` (filtered to --slug=${ONLY_SLUG})` : ''}\n`)

  if (ONLY_SLUG && candidates.length === 0) {
    console.error(`✗ No registered company found with slug="${ONLY_SLUG}" and a gitOrg set.`)
    process.exit(1)
  }

  const rows: BackfillRow[] = []

  for (const app of candidates) {
    const org = app.gitOrg as string
    const slug = app.slug

    // Pre-flight check (read-only, safe in dry-run too) so dry-run output
    // honestly distinguishes "already has it" from "would register."
    const existingHooks = await getRepoWebhooks(org, slug)
    const already = existingHooks.some((h) => h.config?.url === target)

    if (already) {
      rows.push({ slug, gitOrg: org, gitRepoId: app.gitRepoId, disposition: 'already_has_webhook' })
      console.log(`  = ${slug.padEnd(24)} org=${org.padEnd(45)} already has the webhook`)
      continue
    }

    if (!EXECUTE) {
      rows.push({ slug, gitOrg: org, gitRepoId: app.gitRepoId, disposition: 'would_register' })
      console.log(`  → ${slug.padEnd(24)} org=${org.padEnd(45)} would register webhook`)
      continue
    }

    const result = await createRepoWebhook(org, slug, target, secret)
    if (result.ok) {
      rows.push({ slug, gitOrg: org, gitRepoId: app.gitRepoId, disposition: 'registered' })
      console.log(`  ✓ ${slug.padEnd(24)} org=${org.padEnd(45)} registered webhook (hook id ${result.hook?.id})`)
    } else {
      rows.push({ slug, gitOrg: org, gitRepoId: app.gitRepoId, disposition: 'failed', reason: result.reason })
      console.log(`  ✗ ${slug.padEnd(24)} org=${org.padEnd(45)} FAILED: ${result.reason}`)
    }
  }

  const byDisposition = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.disposition] = (acc[r.disposition] || 0) + 1
    return acc
  }, {})

  console.log('\n--- Summary ---')
  console.log(`  companies checked : ${rows.length}`)
  console.log('  by disposition    :', JSON.stringify(byDisposition))

  if (!EXECUTE) {
    const wouldRegister = rows.filter((r) => r.disposition === 'would_register')
    if (wouldRegister.length > 0) {
      console.log(`\n  ${wouldRegister.length} repo(s) WOULD get a webhook registered. Re-run with --execute to act.`)
      console.log('  Slugs:', JSON.stringify(wouldRegister.map((r) => r.slug)))
    } else {
      console.log('\n  Every checked repo already has the webhook — nothing to backfill.')
    }
  }

  const failed = rows.filter((r) => r.disposition === 'failed')
  if (failed.length > 0) {
    console.log('\n--- Failures (did not throw — provisioning-style resilience, but flagging here) ---')
    for (const r of failed) {
      console.log(`  ${r.slug}: ${r.reason}`)
    }
  }

  console.log()
}

main().catch((e) => {
  console.error('backfill failed:', e)
  process.exit(1)
})
