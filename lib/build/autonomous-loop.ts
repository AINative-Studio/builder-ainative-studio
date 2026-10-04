/**
 * Option B — the real autonomous loop, wired into the builder workflow (#207).
 *
 * MINIMAL NEW CODE. Same servers, same AINative API key, same primitives already
 * used elsewhere in the builder. This does NOT reimplement an agent runtime — it
 * composes the EXISTING platform primitives documented in docs/AINATIVE_PRIMITIVES.md:
 *   1. Agent Intelligence API  — GET /api/v1/internal/intelligence/agent-briefing
 *      → a lakehouse-derived, data-informed briefing before the run.
 *   2. Agent Swarm API         — POST /api/v1/agent-swarm/tasks
 *      → dispatch the highest-leverage task to the specialist agent swarm.
 *   3. RLHF / trajectory        — outcomes feed back so the next briefing is smarter.
 *
 * A user's company (created in the /build flow) is enrolled; the nightly cron
 * (app/api/cron/nightly-loop) runs this per enrolled company. The Live dashboard
 * reads the results. This is the same recursive loop that builds AINative itself
 * (ainative.studio/intelligence) — now pointed at each user's company.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'
import { listDocuments } from '@/lib/build/document-store'

/**
 * Read lazily, not cached at module scope: a top-level const freezes whatever
 * the env was at first import, which broke tests setting AINATIVE_API_KEY
 * per-test (module import happens once, before any beforeEach) and would
 * equally miss a real env change without a full process restart in
 * production. Matches the established pattern elsewhere (media-schedule.ts's
 * getApiKey(), the nightshift route) — read at call time instead.
 */
function ainativeApi(): string {
  return process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
}
function apiKey(): string {
  return getAinativeApiKey()
}

export interface NightlyRunInput {
  companyId: string
  companyName: string
  track: 'app' | 'company'
  goal?: string
}

export interface NightlyRunResult {
  companyId: string
  briefing: string | null
  taskId: string | null
  status: 'dispatched' | 'skipped' | 'error'
  detail: string
}

/** 1. Pull a data-informed pre-run briefing (Agent Intelligence API). */
async function getBriefing(input: NightlyRunInput): Promise<string | null> {
  try {
    const res = await fetch(
      `${ainativeApi()}/api/v1/internal/intelligence/agent-briefing?role=founder-operator&context=${encodeURIComponent(input.companyName)}`,
      { headers: authHeaders(), signal: AbortSignal.timeout(20000) },
    )
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    return data?.briefing ?? data?.summary ?? null
  } catch {
    return null
  }
}

/**
 * 2. Dispatch the highest-leverage task to the platform agent swarm.
 *
 * Uses the DOCUMENTED task-dispatch flow (docs/agent-cloud/task-dispatch): a
 * platform agent is registered once (POST /api/v1/public/agents/register →
 * X-Agent-API-Key), then work is submitted to the cloud task queue that
 * core's real Celery consumer (swarm_task_execution.py) claims and drives
 * through its application-generation engine. We register lazily + cache the
 * agent key. Errors are surfaced in `detail` (not swallowed) for diagnosability.
 */
async function dispatchSwarmTask(
  input: NightlyRunInput,
  briefing: string | null,
): Promise<{ taskId: string | null; detail: string }> {
  const description = buildTaskDescription(input, briefing)
  // Submit to the Agent Swarm public task API — POST /api/v1/public/agent-swarm/tasks
  // (public router mounts under /api/v1/public; get_current_user_flexible: the
  // builder's API key authenticates; requires an enterprise plan). Returns task_id.
  try {
    const res = await fetch(`${ainativeApi()}/api/v1/public/agent-swarm/tasks`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        agent_types: input.track === 'company'
          ? ['architect', 'data', 'docs']
          : ['architect', 'backend', 'qa'],
        config: { company: input.companyName, track: input.track, source: 'builder-nightly-loop' },
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { taskId: null, detail: `task submit → HTTP ${res.status} ${txt.slice(0, 120)}` }
    }
    const data = await res.json().catch(() => null)
    const taskId = data?.task_id ?? data?.id ?? null
    return { taskId, detail: taskId ? 'task queued for the swarm' : 'submit ok but no task_id' }
  } catch (e) {
    return { taskId: null, detail: `task submit → ${(e as Error).message}` }
  }
}

/**
 * Run ONE nightly iteration for a company: brief → dispatch. The swarm executes
 * async (poll task_id); outcomes are RLHF-scored by the platform, closing the
 * loop. Returns a result the cron persists + the Live dashboard can surface.
 */
export async function runNightlyLoop(input: NightlyRunInput): Promise<NightlyRunResult> {
  if (!apiKey()) {
    return { companyId: input.companyId, briefing: null, taskId: null, status: 'skipped', detail: 'no AINative API key configured' }
  }
  const briefing = await getBriefing(input)
  const { taskId, detail } = await dispatchSwarmTask(input, briefing)
  if (!taskId) {
    return { companyId: input.companyId, briefing, taskId: null, status: 'error', detail }
  }
  return { companyId: input.companyId, briefing, taskId, status: 'dispatched', detail }
}

/** Exported so the nightly-loop route can seed a real backlog `todo` task
 * (#898) using the exact same description text already sent to the swarm,
 * instead of duplicating the prompt logic. */
export function buildTaskDescription(input: NightlyRunInput, briefing: string | null): string {
  const base = input.track === 'company'
    ? `Evaluate the AI-native company "${input.companyName}" and run the single highest-leverage growth or product task tonight (e.g. improve positioning, qualify pipeline leads, ship a landing-page improvement, draft outreach). Produce a concrete artifact + a one-line morning summary.`
    : `Evaluate the product "${input.companyName}" and ship the single highest-leverage improvement tonight (bug fix, UX polish, or a small feature from the backlog). Produce a diff + a one-line morning summary.`
  return briefing ? `${base}\n\nData-informed briefing:\n${briefing}` : base
}

function authHeaders(): Record<string, string> {
  const key = apiKey()
  return { Authorization: `Bearer ${key}`, 'X-API-Key': key }
}

// ---------------------------------------------------------------------------
// PRD-aware task-seed priority (#901, epic #900)
//
// WHY: a PRD artifact (lib/build/artifact-prompts.ts's `prd` view) already
// generates real `features: [{name, desc, priority: "P0"|"P1"|"P2"}]` — but
// until now the nightly loop's backlog seed (app/api/build/nightly-loop) used
// only the generic buildTaskDescription() prose above, so a founder's P0
// feature and P2 feature were indistinguishable to the autonomous loop.
//
// SCOPE (deliberately narrow — see PR/issue discussion): this is a READ-path
// addition only. It does NOT add any new persistence plumbing for PRD
// artifacts — that would overreach into issue #532's separate, undecided
// write-side territory. Today, NOTHING in this codebase writes a
// `type: 'prd'` document (confirmed: app/api/build/artifact/route.ts returns
// the generated PRD JSON directly to the client and never calls
// createDocument() with it) — so in practice `pickPrdFeatureDescription()`
// below will always return null today and every nightly seed will fall
// through to the generic buildTaskDescription(). That is intentional and
// honest, not a bug: once something starts writing a `prd` document (#532),
// this read path lights up for free with no further changes here.
//
// CONTRACT for a future writer: a `prd` document's `content` field is expected
// to be the JSON-stringified shape already defined by the `prd` artifact
// schema (lib/build/artifact-prompts.ts): `{ overview, features: [{ name,
// desc, priority: "P0"|"P1"|"P2" }], acceptance }`. Reusing that exact shape
// (rather than inventing a new one) means a future writer can persist the
// artifact's own generation output completely as-is.
// ---------------------------------------------------------------------------

/** One feature entry as authored in a PRD artifact's `features` array. */
export interface PrdFeature {
  name: string
  desc?: string
  priority?: string
}

/**
 * Parse a `prd` document's raw `content` string into its `features` array.
 * Defensive: PRD content is LLM-generated JSON (see artifact-prompts.ts) and
 * may be malformed, truncated, or (for some future non-PRD-shaped document)
 * entirely unrelated — never throws, returns [] on any parse/shape failure.
 * Pure.
 */
export function parsePrdFeatures(content: string | null | undefined): PrdFeature[] {
  if (!content || typeof content !== 'string') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }
  const features = (parsed as any)?.features
  if (!Array.isArray(features)) return []
  return features
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      name: String(f.name || '').trim(),
      desc: f.desc ? String(f.desc).trim() : undefined,
      priority: f.priority ? String(f.priority).trim().toUpperCase() : undefined,
    }))
    .filter((f) => f.name.length > 0)
}

/** Priority rank order: P0 is picked first, else P1, else P2. */
const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 }

/**
 * Pick the highest-priority feature from a PRD's features array (P0, else P1,
 * else P2). Ties within the same priority keep the PRD's own authored order
 * (first match wins) — the PRD artifact's array order is the only ordering
 * signal available today since nothing in this codebase tracks a feature as
 * "shipped" yet (confirmed: no shipped/unshipped concept exists anywhere in
 * lib/build or app/api/build). A feature with no/unknown priority is treated
 * as lowest-priority (ranked after P2), never preferred over a known
 * priority. Returns null for an empty list. Pure.
 */
export function pickHighestPriorityFeature(features: PrdFeature[]): PrdFeature | null {
  if (!Array.isArray(features) || features.length === 0) return null
  let best: PrdFeature | null = null
  let bestRank = Infinity
  for (const f of features) {
    const rank = f.priority && f.priority in PRIORITY_RANK ? PRIORITY_RANK[f.priority] : 3
    if (rank < bestRank) {
      best = f
      bestRank = rank
    }
  }
  return best
}

/**
 * Build a nightly task description from a PRD document's content, naming the
 * real highest-priority feature (P0 else P1 else P2) instead of generic
 * prose. Returns null when the content has no parseable/usable features, so
 * the caller can fall back to buildTaskDescription(). Pure (no I/O) — the
 * caller is responsible for fetching the PRD document itself.
 */
export function buildPrdFeatureDescription(
  input: NightlyRunInput,
  prdContent: string | null | undefined,
  briefing: string | null,
): string | null {
  const feature = pickHighestPriorityFeature(parsePrdFeatures(prdContent))
  if (!feature) return null
  const priorityLabel = feature.priority && feature.priority in PRIORITY_RANK ? feature.priority : 'unprioritized'
  const base = input.track === 'company'
    ? `Evaluate the AI-native company "${input.companyName}" and ship its ${priorityLabel} PRD feature "${feature.name}" tonight${feature.desc ? ` — ${feature.desc}` : ''}. Produce a concrete artifact + a one-line morning summary.`
    : `Evaluate the product "${input.companyName}" and ship its ${priorityLabel} PRD feature "${feature.name}" tonight${feature.desc ? ` — ${feature.desc}` : ''}. Produce a diff + a one-line morning summary.`
  return briefing ? `${base}\n\nData-informed briefing:\n${briefing}` : base
}

/**
 * Read the most recently created `prd` document for a scope. Returns null
 * when none exists (the common case today — see the scope note above this
 * section) or on any lookup failure; never throws. Thin wrapper around
 * listDocuments() isolated here so callers don't need their own document-
 * store import just for this one lookup.
 */
async function getLatestPrdDocument(scopeKey: string): Promise<{ content: string } | null> {
  if (!scopeKey) return null
  try {
    const docs = await listDocuments(scopeKey)
    const prdDocs = docs.filter((d) => d.type === 'prd')
    if (!prdDocs.length) return null
    // listDocuments() already returns newest-first (sortDocuments()).
    return { content: prdDocs[0].content }
  } catch {
    return null
  }
}

/**
 * Build the nightly backlog seed description for a company: prefer a real,
 * specific PRD feature (highest-priority P0/P1/P2) when that company has a
 * `prd` document in its scope; otherwise fall back to today's generic
 * buildTaskDescription() — no regression for the (currently universal) case
 * where no PRD exists yet. Never throws — a PRD lookup failure falls back to
 * the generic description exactly like "no PRD found".
 */
export async function buildNightlySeedDescription(
  scopeKey: string,
  input: NightlyRunInput,
  briefing: string | null,
): Promise<string> {
  try {
    const prd = await getLatestPrdDocument(scopeKey)
    if (prd) {
      const fromPrd = buildPrdFeatureDescription(input, prd.content, briefing)
      if (fromPrd) return fromPrd
    }
  } catch {
    // fall through to the generic description below
  }
  return buildTaskDescription(input, briefing)
}
