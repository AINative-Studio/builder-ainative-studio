/**
 * Recursive-loop learning capture (#270) — ties every /build company flow's
 * IDEA → generated app → CONVERSION outcome together so Cody can LEARN from every
 * build, ESPECIALLY the ones that never convert to paid.
 *
 * Today generation is captured (lib/services/rlhf.service.ts), but nothing links
 * the idea a founder described to the app that got generated to whether the
 * company ultimately upgraded. This appends a durable row per build to a ZeroDB
 * table (builder_learning, auto-created on first insert like builder_app_registry)
 * carrying that full triple, and flips converted:true (+ plan) when a company pays.
 *
 * Reuses the exact ZeroDB row-append pattern as app-registry.ts (POST
 * /api/v1/projects/{PROJECT}/database/tables/{table}/rows). Latest row wins on
 * read (see app/api/build/learning/route.ts rollup). Every write is best-effort:
 * it NEVER throws into the build/checkout request path — callers fire-and-forget
 * with .catch(). No new PII is captured (idea + public brand only, no user email).
 */

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_learning'

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

export interface LearningOutcome {
  slug: string
  idea?: string
  brand?: string        // generated product name for the idea
  track?: string        // 'company' | 'app'
  chatId?: string       // the generated app's preview chatId (links back to rlhf_training_data)
  codeStatus?: string   // codegen result: 'success' | 'failure' | 'partial' | ...
  domainFound?: boolean // custom-domain search hit (a signal of intent)
  plan?: string         // active subscription plan id once converted
  keyKind?: 'tmp' | 'permanent'
  converted: boolean    // paid plan attached (true) vs tmp_/no plan (false)
}

export interface LearningRow extends LearningOutcome {
  createdAt: string
}

/**
 * Append a learning row for a build outcome. Best-effort — resolves false on any
 * failure and NEVER throws (safe to fire-and-forget in a request path). Requires a
 * slug; everything else is optional so it can be called at build time (converted:
 * false) and again on conversion (converted: true + plan).
 */
export async function logBuildOutcome(o: LearningOutcome): Promise<boolean> {
  if (!configured() || !o.slug) return false
  try {
    const row: LearningRow = {
      slug: String(o.slug).slice(0, 40),
      idea: o.idea ? String(o.idea).slice(0, 3000) : undefined,
      brand: o.brand ? String(o.brand).slice(0, 120) : undefined,
      track: o.track ? String(o.track).slice(0, 24) : undefined,
      chatId: o.chatId ? String(o.chatId).slice(0, 64) : undefined,
      codeStatus: o.codeStatus ? String(o.codeStatus).slice(0, 40) : undefined,
      domainFound: typeof o.domainFound === 'boolean' ? o.domainFound : undefined,
      plan: o.plan ? String(o.plan).slice(0, 40) : undefined,
      keyKind: o.keyKind,
      converted: Boolean(o.converted),
      createdAt: new Date().toISOString(),
    }
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

/**
 * Mark a company's build as CONVERTED (paid) — appends an updated learning row
 * carrying the same slug plus converted:true + plan, so the rollup's latest-wins
 * dedup surfaces the conversion. Best-effort; never throws. Called from the
 * post-checkout path (subscription/verify) alongside setAppPlan.
 */
export async function markConverted(slug: string, plan: string): Promise<boolean> {
  if (!slug) return false
  return logBuildOutcome({ slug, plan, converted: true })
}

/** Read every learning row (raw), newest first. Returns [] when unconfigured/failed. */
export async function readLearningRows(): Promise<LearningRow[]> {
  if (!configured()) return []
  try {
    // ZeroDB rows API caps limit at 1000 (1001+ → 422). Matches app-registry.
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const out = rows
      .map((r: { row_data?: LearningRow }) => r.row_data)
      .filter((rd: LearningRow | undefined): rd is LearningRow => Boolean(rd?.slug))
    out.sort((a: LearningRow, b: LearningRow) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return out
  } catch {
    return []
  }
}

export interface LearningRollup {
  totalBuilds: number
  converted: number
  conversionRate: number
  codegenFailureRate: number
  nonConverterIdeas: Array<{ slug: string; idea?: string; brand?: string; track?: string; createdAt: string }>
  byTrack: Record<string, { builds: number; converted: number }>
  updatedAt: string
}

/**
 * Roll up the raw rows into the aggregate signal the recursive briefing/RLHF loop
 * consumes: total distinct builds, conversion rate, non-converter ideas (the ones
 * to learn from), and codegen failure rate. Dedupes by slug (latest row wins) so a
 * build + its later conversion row count once. Exposes NO raw PII beyond the idea
 * text + public brand the founder already put on the page.
 */
export function rollup(rows: LearningRow[], recentLimit = 50): LearningRollup {
  // Collapse to one merged record per slug: newest non-empty field wins, and a
  // conversion in ANY row for the slug marks the build converted.
  const bySlug = new Map<string, LearningRow>()
  // rows are newest-first; iterate oldest-first so newer fields overwrite.
  for (const r of [...rows].reverse()) {
    const prev = bySlug.get(r.slug)
    const merged: LearningRow = {
      slug: r.slug,
      idea: r.idea ?? prev?.idea,
      brand: r.brand ?? prev?.brand,
      track: r.track ?? prev?.track,
      chatId: r.chatId ?? prev?.chatId,
      codeStatus: r.codeStatus ?? prev?.codeStatus,
      domainFound: r.domainFound ?? prev?.domainFound,
      plan: r.plan ?? prev?.plan,
      keyKind: r.keyKind ?? prev?.keyKind,
      converted: Boolean(r.converted) || Boolean(prev?.converted),
      createdAt: prev?.createdAt || r.createdAt, // keep earliest build time
    }
    bySlug.set(r.slug, merged)
  }

  const merged = [...bySlug.values()]
  const totalBuilds = merged.length
  const converted = merged.filter((m) => m.converted || Boolean(m.plan)).length
  const withStatus = merged.filter((m) => m.codeStatus)
  const failures = withStatus.filter((m) => m.codeStatus === 'failure').length

  const byTrack: Record<string, { builds: number; converted: number }> = {}
  for (const m of merged) {
    const t = m.track || 'unknown'
    byTrack[t] ||= { builds: 0, converted: 0 }
    byTrack[t].builds += 1
    if (m.converted || m.plan) byTrack[t].converted += 1
  }

  const nonConverterIdeas = merged
    .filter((m) => !m.converted && !m.plan)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, recentLimit)
    .map((m) => ({ slug: m.slug, idea: m.idea, brand: m.brand, track: m.track, createdAt: m.createdAt }))

  return {
    totalBuilds,
    converted,
    conversionRate: totalBuilds ? converted / totalBuilds : 0,
    codegenFailureRate: withStatus.length ? failures / withStatus.length : 0,
    nonConverterIdeas,
    byTrack,
    updatedAt: new Date().toISOString(),
  }
}
