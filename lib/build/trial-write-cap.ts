/**
 * Trial write-volume cap (#1606, piece 2/3 of #1579's recovery plan).
 *
 * WHY THIS EXISTS. #1605 made an expired, unpaid tmp_ trial key auto-renew
 * against the SAME project forever, with no payment ever required — real
 * fix for the "app silently breaks after 24h" problem, but it also means an
 * unpaid trial can now write to ZeroDB indefinitely at zero cost to the
 * founder and unbounded cost to Builder. This caps WRITE volume only for
 * keys tagged `usageTier: 'trial'` (see company-zerodb-credentials.ts) —
 * reads are NEVER capped, so a founder can always see what they've already
 * collected and the app never looks broken, only its ability to collect NEW
 * data pauses until they upgrade.
 *
 * STORAGE: a single counter row per project in its own small table
 * (`builder_trial_write_usage`), separate from `builder_company_zerodb_keys`
 * on purpose — that table holds encrypted credential material and gets a
 * brand-new row on every key store/renewal; bumping a counter there on every
 * single write would mean re-encrypting and re-appending a full key row per
 * write, which is both wasteful and a needless blast-radius increase for a
 * security-sensitive table. This table's rows are a single integer, cheap to
 * read/write, and UPDATED IN PLACE via PUT-by-row-id (confirmed real: ZeroDB
 * supports `PUT /v1/projects/{id}/database/tables/{table}/rows/{row_id}`,
 * see app/api/db/[table]/route.ts's own putHandler) rather than append-only.
 *
 * CONCURRENCY. ZeroDB's REST API has no conditional/compare-and-swap update
 * (no `WHERE count < cap` semantics) — only a plain PUT-by-id. So this is a
 * genuine, accepted read-then-write race: two concurrent writes can both
 * read the same count and both believe they're under the cap, overshooting
 * it by a handful of writes in rare concurrent bursts. That's an accepted
 * trade-off: the cap's purpose is cost containment, not a hard security
 * boundary, and it matches this codebase's existing best-effort/fail-open
 * philosophy elsewhere (e.g. #1579's renewal itself deliberately doesn't
 * de-dupe concurrent renewal attempts for the same reason).
 *
 * FAILS OPEN ON A COUNTER-STORE FAILURE, not closed: if this module can't
 * reach ZeroDB to check or increment the counter, the write is ALLOWED
 * through rather than blocking a real founder's real data because of an
 * unrelated counter-table outage. The cap is a cost-containment guard on
 * free usage, not a security boundary — failing closed here would turn a
 * transient metrics-table hiccup into real data loss for paying attention
 * (well, trial) founders, which is a worse outcome than briefly uncapped
 * writes during an outage.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const TABLE = 'builder_trial_write_usage'

/** Default write cap for a trial-tier project. Overridable per deploy. */
export const DEFAULT_TRIAL_WRITE_CAP = Number(process.env.TRIAL_WRITE_CAP || 5000)

function registryProjectId(): string {
  return process.env.ZERODB_PROJECT_ID || ''
}
function serviceKey(): string {
  return getAinativeApiKey()
}
function configured(): boolean {
  return Boolean(serviceKey() && registryProjectId())
}
function rowsUrl(suffix = ''): string {
  return `${AINATIVE_API}/api/v1/projects/${registryProjectId()}/database/tables/${TABLE}/rows${suffix}`
}
function headers(): Record<string, string> {
  const key = serviceKey()
  return { Authorization: `Bearer ${key}`, 'X-API-Key': key, 'Content-Type': 'application/json' }
}

interface UsageRow {
  projectId: string
  writeCount: number
  updatedAt: string
}

interface StoredUsageRow extends UsageRow {
  /** ZeroDB's own row id — required to PUT-update this exact row. */
  rowId: string
}

async function ensureTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${registryProjectId()}/database/tables`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ table_name: TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Already exists, or the create itself failed — the real read/write
    // below is authoritative, matching company-zerodb-credentials.ts's
    // identical ensureTable pattern.
  }
}

/** The project's current usage row, or null if none exists yet (first write). */
async function findUsageRow(projectId: string): Promise<StoredUsageRow | null> {
  const res = await fetch(`${rowsUrl()}?limit=1000`, {
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  const rows = Array.isArray(data) ? data : data?.data || data?.rows || []
  if (!Array.isArray(rows)) return null
  for (const r of rows) {
    const rd: UsageRow | undefined = r?.row_data
    const rowId = r?.row_id ?? r?.id
    if (rd?.projectId === projectId && rowId) {
      return { ...rd, rowId: String(rowId) }
    }
  }
  return null
}

async function createUsageRow(projectId: string, writeCount: number): Promise<boolean> {
  try {
    await ensureTable()
    const row: UsageRow = { projectId, writeCount, updatedAt: new Date().toISOString() }
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function updateUsageRow(rowId: string, projectId: string, writeCount: number): Promise<boolean> {
  try {
    const row: UsageRow = { projectId, writeCount, updatedAt: new Date().toISOString() }
    const res = await fetch(rowsUrl(`/${rowId}`), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

export interface WriteCapCheck {
  /** True when the write should proceed — either under cap, or the check
   *  itself failed (fails OPEN, see module doc comment). */
  allowed: boolean
  /** The count AFTER this write would be recorded, for diagnostics/future
   *  "X/Y writes used" UI (#1606's own follow-up note) — best-effort, may be
   *  stale/approximate under the accepted race window. */
  count?: number
  cap?: number
}

/**
 * Check whether a trial-tier project is still under its write cap, and if
 * so, record this write (increment the counter) in the same call — callers
 * should treat `allowed:false` as "do not forward this write to ZeroDB."
 *
 * ONLY call this for a write (POST/PUT/DELETE) on a key whose usageTier is
 * 'trial' — a 'paid'/undefined-tier key must never reach this function at
 * all (the call site checks usageTier first), and GET must never call it.
 */
export async function checkAndRecordTrialWrite(
  projectId: string,
  cap: number = DEFAULT_TRIAL_WRITE_CAP,
): Promise<WriteCapCheck> {
  if (!projectId || !configured()) return { allowed: true }
  try {
    const existing = await findUsageRow(projectId)
    const currentCount = existing?.writeCount ?? 0
    if (currentCount >= cap) {
      return { allowed: false, count: currentCount, cap }
    }
    const nextCount = currentCount + 1
    const wrote = existing
      ? await updateUsageRow(existing.rowId, projectId, nextCount)
      : await createUsageRow(projectId, nextCount)
    // A failed increment write still lets the DATA write through (fail
    // open) — we just couldn't durably record the count this time.
    if (!wrote) return { allowed: true, count: currentCount, cap }
    return { allowed: true, count: nextCount, cap }
  } catch {
    return { allowed: true }
  }
}
