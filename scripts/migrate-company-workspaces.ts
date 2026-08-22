/**
 * migrate-company-workspaces.ts (#250) — re-parent existing Builder company
 * projects into the AINative Builder workspace.
 *
 * Every generated company is a ZeroDB project; #250 wants them all filed under the
 * single AINative Builder workspace (core Organization `5d2376e1-…`) instead of the
 * Builder key's default "AINative Studio" workspace. New provisions are filed at
 * creation time (lib/build/instant-db.ts + the provision route); this script is the
 * one-time back-fill for company projects provisioned BEFORE that landed.
 *
 * SAFETY: dry-run by default. It reads the builder_app_registry table, finds every
 * entry with a provisioned `zerodbProjectId`, checks each project's current
 * organization_id, and REPORTS what it would move. It only mutates when run with
 * `--apply`, and even then only re-parents projects that (a) are currently under a
 * DIFFERENT workspace and (b) are owned by the Builder key (PATCH is authorized).
 * It NEVER sweeps arbitrary projects — only ones the registry knows are Builder
 * companies. Non-Builder projects in "AINative Studio" (ZeroBooks, hackerdojo,
 * test/experiment projects) are therefore untouched by construction.
 *
 * Usage:
 *   npx tsx scripts/migrate-company-workspaces.ts            # dry-run report
 *   npx tsx scripts/migrate-company-workspaces.ts --apply    # actually re-parent
 *
 * Env (same as the Builder server): AINATIVE_API_KEY (admin key), ZERODB_PROJECT_ID
 * (registry project), optionally AINATIVE_BUILDER_WORKSPACE_ID / AINATIVE_API_URL.
 */

// Make this file a module (not a global script) so `main()` doesn't collide with
// the `main()` in sibling one-off scripts under tsc's whole-program check.
export {}

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const REGISTRY_PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const BUILDER_WORKSPACE_ID =
  process.env.AINATIVE_BUILDER_WORKSPACE_ID || '5d2376e1-d4f0-4193-9a7f-84e4543a8f9a'
const TABLE = 'builder_app_registry'
const APPLY = process.argv.includes('--apply')

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}

interface AppEntry {
  slug: string
  chatId: string
  zerodbProjectId?: string
  keyKind?: 'tmp' | 'permanent'
  createdAt: string
}

/** Latest-wins de-dupe of the registry rows into one entry per slug. */
async function loadRegistry(): Promise<AppEntry[]> {
  const url = `${AINATIVE_API}/api/v1/projects/${REGISTRY_PROJECT_ID}/database/tables/${TABLE}/rows?limit=5000`
  const res = await fetch(url, { headers: headers() })
  if (!res.ok) throw new Error(`registry read failed: ${res.status} ${await res.text()}`)
  const data = JSON.parse(await res.text())
  const rows = Array.isArray(data) ? data : data.data || data.rows || []
  const bySlug = new Map<string, AppEntry>()
  for (const r of rows) {
    const rd: AppEntry | undefined = r.row_data
    if (!rd?.slug || !rd?.chatId) continue
    const prev = bySlug.get(rd.slug)
    if (!prev || (rd.createdAt || '').localeCompare(prev.createdAt || '') > 0) bySlug.set(rd.slug, rd)
  }
  return [...bySlug.values()]
}

async function projectOrg(projectId: string): Promise<{ ok: boolean; orgId?: string | null; name?: string; status: number; detail?: string }> {
  const res = await fetch(`${AINATIVE_API}/api/v1/projects/${projectId}`, { headers: headers() })
  const body = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, status: res.status, detail: String(body?.detail || res.status) }
  return { ok: true, status: res.status, orgId: body?.organization_id ?? null, name: body?.name }
}

async function reparent(projectId: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  const res = await fetch(`${AINATIVE_API}/api/v1/projects/${projectId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ organization_id: BUILDER_WORKSPACE_ID }),
  })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, detail: res.ok ? undefined : String(body?.detail || res.status) }
}

async function main() {
  if (!API_KEY || !REGISTRY_PROJECT_ID) {
    console.error('Missing AINATIVE_API_KEY and/or ZERODB_PROJECT_ID env. Aborting.')
    process.exit(1)
  }
  console.log(`\n#250 company-workspace migration ${APPLY ? '(APPLY)' : '(DRY-RUN)'}`)
  console.log(`  target workspace: ${BUILDER_WORKSPACE_ID}`)
  console.log(`  registry project: ${REGISTRY_PROJECT_ID}\n`)

  const entries = (await loadRegistry()).filter((e) => e.zerodbProjectId)
  console.log(`Provisioned company projects in registry: ${entries.length}\n`)
  if (entries.length === 0) {
    console.log('Nothing to migrate. (No company has a provisioned zerodbProjectId yet.)')
    return
  }

  let already = 0, wouldMove = 0, moved = 0, blocked = 0, unreadable = 0
  for (const e of entries) {
    const pid = e.zerodbProjectId!
    const cur = await projectOrg(pid)
    if (!cur.ok) {
      unreadable++
      console.log(`  ? ${e.slug.padEnd(24)} ${pid}  UNREADABLE (${cur.status} ${cur.detail})`)
      continue
    }
    if (cur.orgId === BUILDER_WORKSPACE_ID) {
      already++
      console.log(`  = ${e.slug.padEnd(24)} ${pid}  already under Builder workspace`)
      continue
    }
    wouldMove++
    const label = `${e.slug.padEnd(24)} ${pid}  ${cur.orgId ?? 'NULL'} → Builder [${e.keyKind || '?'}]`
    if (!APPLY) {
      console.log(`  → ${label}  (would move)`)
      continue
    }
    const r = await reparent(pid)
    if (r.ok) {
      moved++
      console.log(`  ✓ ${label}  MOVED`)
    } else {
      blocked++
      console.log(`  ✗ ${label}  BLOCKED (${r.status} ${r.detail})`)
    }
  }

  console.log(`\nSummary:`)
  console.log(`  already filed : ${already}`)
  console.log(`  ${APPLY ? 'moved         ' : 'would move    '}: ${APPLY ? moved : wouldMove}`)
  if (APPLY) console.log(`  blocked       : ${blocked}`)
  if (unreadable) console.log(`  unreadable    : ${unreadable}`)
  if (!APPLY) console.log(`\nRe-run with --apply to perform the migration.`)
}

main().catch((e) => {
  console.error('migration failed:', e?.message || e)
  process.exit(1)
})
