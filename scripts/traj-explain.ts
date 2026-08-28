/**
 * Trajectory DAG explainer (#347 slice 4) — the offline half of the fork/merge
 * DAG. Reads cody_trajectories from ZeroDB, reconstructs the fork tree via
 * parent_traj/parent_step, prints it with each node's reward + stop_reason, and
 * (optionally, --narrate) has an LLM explain what each sub-run did and why.
 *
 * Usage:
 *   ZERODB_API_TOKEN=<sk_...> npx tsx scripts/traj-explain.ts [--limit 2000] [--root <traj_id>] [--narrate]
 *
 * Read-only. No deploy. Degrades gracefully (empty report) if unconfigured.
 */
import { AINATIVE_API_BASE_URL } from '../lib/constants'
import {
  buildTrajTrees,
  explainTrajectories,
  renderTree,
  type TrajRow,
} from '../lib/agent/traj-explain'

const TABLE = 'cody_trajectories'

function projectId(): string {
  return process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
}
function token(): string | undefined {
  return process.env.ZERODB_API_TOKEN || process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function fetchRows(limit: number): Promise<TrajRow[]> {
  const tok = token()
  if (!tok) {
    console.error('[traj-explain] no ZeroDB token (set ZERODB_API_TOKEN) — nothing to read')
    return []
  }
  const url = `${AINATIVE_API_BASE_URL}/api/v1/projects/${projectId()}/database/tables/${TABLE}/rows?limit=${limit}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    console.error(`[traj-explain] read failed: HTTP ${res.status}`)
    return []
  }
  const data: any = await res.json()
  const rows = Array.isArray(data) ? data : data.data || data.rows || []
  return rows
    .map((r: { row_data?: TrajRow }) => r.row_data)
    .filter((rd: TrajRow | undefined): rd is TrajRow => !!rd && (!!rd.traj_id || !!rd.chat_id))
    .map((rd: TrajRow): TrajRow => {
      // Legacy rows (captured before #347 slice 1) have no provenance — treat them
      // as roots keyed by chat_id so the tool explains the full corpus, not just
      // post-#347 forks.
      if (!rd.traj_id) {
        return { ...rd, traj_id: rd.chat_id as string, parent_traj: null, parent_step: null, node_role: 'root' }
      }
      return rd
    })
}

/** Optional LLM narration of one tree via the AINative proxy (same as committee-runner). */
async function narrate(treeText: string): Promise<string> {
  const tok = process.env.AINATIVE_API_TOKEN || process.env.AINATIVE_API_KEY
  if (!tok) return '(narration skipped — no AINATIVE_API_TOKEN)'
  const base = process.env.AINATIVE_BASE_URL || 'https://api.ainative.studio/api/v1'
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.TRAJ_EXPLAIN_MODEL || 'claude-sonnet-4.5',
        messages: [
          { role: 'system', content: 'You explain a subagent trajectory fork/merge DAG. Given the tree (each node: id, role, reward, stop_reason), narrate in 3-5 sentences what each sub-run did and why the run ended as it did. Be concrete; no preamble.' },
          { role: 'user', content: treeText },
        ],
        temperature: 0.3,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(40000),
    })
    if (!res.ok) return `(narration failed HTTP ${res.status})`
    const data: any = await res.json()
    return String(data?.choices?.[0]?.message?.content || '(empty narration)')
  } catch (e) {
    return `(narration error: ${e instanceof Error ? e.message : String(e)})`
  }
}

async function main() {
  const limit = Number(arg('limit', '2000'))
  const rootFilter = arg('root')
  const doNarrate = flag('narrate')

  const rows = await fetchRows(limit)
  if (rows.length === 0) {
    console.log('No trajectories found.')
    return
  }

  console.log(explainTrajectories(rows))

  if (rootFilter || doNarrate) {
    const trees = buildTrajTrees(rows).filter((t) => !rootFilter || t.rootId === rootFilter)
    for (const tree of trees) {
      if (doNarrate) {
        console.log(`\n--- narration: ${tree.rootId} ---`)
        console.log(await narrate(renderTree(tree)))
      }
    }
  }
}

main().catch((e) => {
  console.error('[traj-explain] fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
