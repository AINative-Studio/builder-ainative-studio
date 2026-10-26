/**
 * #1545 — migrate existing company Gitea repos OUT of the single shared
 * platform org into their real founder's own workspace org.
 *
 * Root cause this repairs (see docs/GITEA_PROVISIONING.md's "Incident"
 * section for the full writeup): #1543/#1544 fixed every NEW company's repo
 * to provision under `ws-{session.workspaceId}` instead of the shared
 * `ws-{BUILDER_WORKSPACE_ID}` org. Every repo provisioned BEFORE that fix
 * landed, and is still sitting, in the shared org — this script moves them.
 *
 * SAFETY: dry run by default (report-only, same posture as every other
 * scripts/backfill-*.ts in this repo). `--execute` is required to actually
 * call transferRepo() and move anything.
 *
 *   Dry run:  npx tsx scripts/backfill-gitea-org-per-workspace.ts
 *   Real run: npx tsx scripts/backfill-gitea-org-per-workspace.ts --execute
 *   Single company (either mode): npx tsx scripts/backfill-gitea-org-per-workspace.ts --slug=acme [--execute]
 *
 * WORKSPACE RESOLUTION, see builder#1555 (core PR #9214, confirmed live
 * 2026-10-26): `AppEntry.ownerEmail` is the only trustworthy input (the
 * stored `AppEntry.workspaceId` field is itself a separate instance of the
 * exact same #1543 bug, written via the same shared constant on the
 * ZeroDB-registry side — never read it as ground truth here).
 * `resolveFounderWorkspaceId` (./backfill-gitea-org-per-workspace-logic.ts,
 * split out so it's unit-testable without this file's top-level main() call
 * firing on import) calls core's real admin endpoint (`GET /api/v1/admin/
 * users/by-email/{email}/workspaces`, authenticated with Builder's existing
 * service key — no new credential needed) to resolve it.
 *
 * Requires GITEA_BASE_URL + GITEA_ADMIN_TOKEN, and ZERODB_API_KEY (or
 * AINATIVE_API_KEY) + ZERODB_PROJECT_ID to enumerate companies — e.g. via
 * `railway run --service builder-ainative-studio`.
 */

export {}

import { listAllAppsWithStatus, type AppEntry } from '../lib/build/app-registry'
import { BUILDER_WORKSPACE_ID } from '../lib/build/instant-db'
import { configured, getRepo, orgNameForWorkspace, transferRepo } from '../lib/git/gitea-client'
import { resolveFounderWorkspaceId } from './backfill-gitea-org-per-workspace-logic'

const EXECUTE = process.argv.includes('--execute')
const SLUG_ARG = process.argv.find((a) => a.startsWith('--slug='))
const ONLY_SLUG = SLUG_ARG ? SLUG_ARG.slice('--slug='.length).trim() : null

/** The shared platform org every repo provisioned before #1544 landed in.
 *  Imported from the SAME constant every provisioning call site reads
 *  (lib/build/instant-db.ts) rather than re-deriving from an env var here —
 *  this script had been reading `process.env.BUILDER_WORKSPACE_ID`, which
 *  does not exist; the real var is `AINATIVE_BUILDER_WORKSPACE_ID`, and the
 *  constant already has the correct live-default fallback baked in. */
const SHARED_WORKSPACE_ID = BUILDER_WORKSPACE_ID

type Disposition =
  | 'would_transfer'
  | 'already_correct'
  | 'transferred'
  | 'failed'
  | 'skipped_no_owner_email'
  | 'skipped_unresolvable_workspace'
  | 'skipped_no_repo'

interface MigrationRow {
  slug: string
  ownerEmail?: string
  currentOrg: string
  resolvedWorkspaceId?: string
  resolvedOrg?: string
  disposition: Disposition
  reason?: string
}

async function main() {
  console.log(`\n#1545 Gitea org-per-workspace migration — ${EXECUTE ? 'EXECUTE (writes!)' : 'DRY RUN (no writes, default)'}\n`)

  if (!configured()) {
    console.error('✗ Gitea is not configured (GITEA_BASE_URL/GITEA_ADMIN_TOKEN unset) — migration did not run.')
    process.exit(1)
  }
  const sharedOrg = orgNameForWorkspace(SHARED_WORKSPACE_ID)
  console.log(`  shared org (migrating FROM) : ${sharedOrg}`)

  const { apps, ok } = await listAllAppsWithStatus()
  if (!ok) {
    console.error('✗ Company registry read FAILED — migration did not run.')
    console.error('  An empty result here is NOT "no companies" (see core#7395).')
    process.exit(1)
  }

  const candidates = apps.filter(
    (a: AppEntry) => a.gitOrg === sharedOrg && a.slug && (!ONLY_SLUG || a.slug === ONLY_SLUG),
  )
  console.log(`\n  companies currently in the shared org: ${candidates.length}${ONLY_SLUG ? ` (filtered to --slug=${ONLY_SLUG})` : ''}\n`)

  if (ONLY_SLUG && candidates.length === 0) {
    console.error(`✗ No registered company found with slug="${ONLY_SLUG}" and gitOrg="${sharedOrg}".`)
    process.exit(1)
  }

  const rows: MigrationRow[] = []

  for (const app of candidates) {
    const slug = app.slug
    const currentOrg = app.gitOrg as string
    const ownerEmail = (app.ownerEmail || '').trim()

    if (!ownerEmail) {
      rows.push({ slug, currentOrg, disposition: 'skipped_no_owner_email' })
      console.log(`  ⚠ ${slug.padEnd(24)} no ownerEmail on record — skipped, stays in shared org`)
      continue
    }

    const resolvedWorkspaceId = await resolveFounderWorkspaceId(ownerEmail)
    if (!resolvedWorkspaceId) {
      rows.push({ slug, currentOrg, ownerEmail, disposition: 'skipped_unresolvable_workspace', reason: 'blocked on builder#1555' })
      console.log(`  ⚠ ${slug.padEnd(24)} owner=${ownerEmail.padEnd(32)} workspace unresolvable (builder#1555) — skipped`)
      continue
    }

    const resolvedOrg = orgNameForWorkspace(resolvedWorkspaceId)
    if (resolvedOrg === currentOrg) {
      rows.push({ slug, currentOrg, ownerEmail, resolvedWorkspaceId, resolvedOrg, disposition: 'already_correct' })
      console.log(`  = ${slug.padEnd(24)} owner=${ownerEmail.padEnd(32)} already in the correct org`)
      continue
    }

    // Idempotent pre-flight, safe in dry-run too: a prior partial run may
    // have already transferred this one.
    const alreadyThere = await getRepo(resolvedOrg, slug)
    if (alreadyThere) {
      rows.push({ slug, currentOrg, ownerEmail, resolvedWorkspaceId, resolvedOrg, disposition: 'already_correct' })
      console.log(`  = ${slug.padEnd(24)} owner=${ownerEmail.padEnd(32)} already transferred to ${resolvedOrg}`)
      continue
    }

    if (!EXECUTE) {
      rows.push({ slug, currentOrg, ownerEmail, resolvedWorkspaceId, resolvedOrg, disposition: 'would_transfer' })
      console.log(`  → ${slug.padEnd(24)} owner=${ownerEmail.padEnd(32)} would transfer ${currentOrg} -> ${resolvedOrg}`)
      continue
    }

    try {
      const transferred = await transferRepo(currentOrg, resolvedOrg, slug)
      if (!transferred) {
        rows.push({ slug, currentOrg, ownerEmail, resolvedWorkspaceId, resolvedOrg, disposition: 'skipped_no_repo' })
        console.log(`  ⚠ ${slug.padEnd(24)} no repo found under ${currentOrg} to transfer`)
        continue
      }
      rows.push({ slug, currentOrg, ownerEmail, resolvedWorkspaceId, resolvedOrg, disposition: 'transferred' })
      console.log(`  ✓ ${slug.padEnd(24)} owner=${ownerEmail.padEnd(32)} transferred ${currentOrg} -> ${resolvedOrg}`)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      rows.push({ slug, currentOrg, ownerEmail, resolvedWorkspaceId, resolvedOrg, disposition: 'failed', reason })
      console.log(`  ✗ ${slug.padEnd(24)} owner=${ownerEmail.padEnd(32)} FAILED: ${reason}`)
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
    const wouldTransfer = rows.filter((r) => r.disposition === 'would_transfer')
    if (wouldTransfer.length > 0) {
      console.log(`\n  ${wouldTransfer.length} repo(s) WOULD be transferred. Re-run with --execute to act.`)
      console.log('  Slugs:', JSON.stringify(wouldTransfer.map((r) => r.slug)))
    }
  }

  const unresolvable = rows.filter((r) => r.disposition === 'skipped_unresolvable_workspace')
  if (unresolvable.length > 0) {
    console.log(`\n  ${unresolvable.length} repo(s) blocked on builder#1555 (no workspace resolution path yet).`)
  }

  const failed = rows.filter((r) => r.disposition === 'failed')
  if (failed.length > 0) {
    console.log('\n--- Failures ---')
    for (const r of failed) {
      console.log(`  ${r.slug}: ${r.reason}`)
    }
  }

  console.log()
}

main().catch((e) => {
  console.error('migration failed:', e)
  process.exit(1)
})
