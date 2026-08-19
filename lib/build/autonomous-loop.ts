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

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''

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
      `${AINATIVE_API}/api/v1/internal/intelligence/agent-briefing?role=founder-operator&context=${encodeURIComponent(input.companyName)}`,
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
 * X-Agent-API-Key), then work is submitted to the cloud task queue that the
 * OpenClaw swarm claims and executes. We register lazily + cache the agent key.
 * Errors are surfaced in `detail` (not swallowed) for diagnosability.
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
    const res = await fetch(`${AINATIVE_API}/api/v1/public/agent-swarm/tasks`, {
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
  if (!API_KEY) {
    return { companyId: input.companyId, briefing: null, taskId: null, status: 'skipped', detail: 'no AINative API key configured' }
  }
  const briefing = await getBriefing(input)
  const { taskId, detail } = await dispatchSwarmTask(input, briefing)
  if (!taskId) {
    return { companyId: input.companyId, briefing, taskId: null, status: 'error', detail }
  }
  return { companyId: input.companyId, briefing, taskId, status: 'dispatched', detail }
}

function buildTaskDescription(input: NightlyRunInput, briefing: string | null): string {
  const base = input.track === 'company'
    ? `Evaluate the AI-native company "${input.companyName}" and run the single highest-leverage growth or product task tonight (e.g. improve positioning, qualify pipeline leads, ship a landing-page improvement, draft outreach). Produce a concrete artifact + a one-line morning summary.`
    : `Evaluate the product "${input.companyName}" and ship the single highest-leverage improvement tonight (bug fix, UX polish, or a small feature from the backlog). Produce a diff + a one-line morning summary.`
  return briefing ? `${base}\n\nData-informed briefing:\n${briefing}` : base
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY }
}
