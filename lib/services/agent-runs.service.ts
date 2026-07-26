/**
 * Agent Runs Tracking Service — Phase 3 (builder#53)
 *
 * Logs every headless agent run (primary or fallback) to ZeroDB
 * table `agent_runs` for observability, cost tracking, and
 * intelligence-loop feedback.
 */

export interface AgentRunData {
  chatId: string
  userId: string
  model: string
  turns: number
  toolsUsed: string[]
  buildPassed: boolean
  durationMs: number
  tokenUsage: {
    inputTokens: number
    outputTokens: number
    totalCostUsd?: number
  }
  /** True if this run was a fallback from fast-path validation failure. */
  fallback: boolean
  error?: string
}

/** Whether we've ensured the table exists this process (avoid a create call per write). */
let _tableEnsured = false

/** Test-only: reset the table-ensured cache so each test starts fresh. */
export function __resetTableEnsuredForTests(): void {
  _tableEnsured = false
}

/**
 * Ensure the `agent_runs` table exists. A ZeroDB table must be created before
 * rows can be inserted, otherwise the row POST 404s — which was the cause of
 * the "[AgentRuns] ZeroDB responded 404" on every run (builder#101). Idempotent
 * and best-effort: a create for an existing table is a harmless no-op.
 */
async function ensureAgentRunsTable(baseUrl: string, projectId: string, apiKey: string): Promise<void> {
  if (_tableEnsured) return
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/database/tables`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_name: 'agent_runs',
        description: 'Headless agent run telemetry (builder#53): model, turns, tools, cost, build result',
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    _tableEnsured = true
  } catch {
    // best-effort — if create fails we still try the write (table may already exist)
  }
}

/**
 * Logs an agent run to ZeroDB table `agent_runs`.
 *
 * Fire-and-forget — callers should `.catch()` to avoid unhandled rejections.
 */
export async function logAgentRun(data: AgentRunData): Promise<void> {
  const apiKey = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''
  const projectId = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
  if (!apiKey) {
    console.warn('[AgentRuns] No API key — skipping log')
    return
  }

  const baseUrl =
    process.env.AINATIVE_API_URL ||
    process.env.ZERODB_BASE_URL ||
    'https://api.ainative.studio'

  // Create the table on first use so the row insert doesn't 404 (builder#101).
  await ensureAgentRunsTable(baseUrl, projectId, apiKey)

  const row = {
    chat_id: data.chatId,
    user_id: data.userId,
    model: data.model,
    turns: data.turns,
    tools_used: JSON.stringify(data.toolsUsed),
    build_passed: data.buildPassed,
    duration_ms: data.durationMs,
    input_tokens: data.tokenUsage.inputTokens,
    output_tokens: data.tokenUsage.outputTokens,
    total_cost_usd: data.tokenUsage.totalCostUsd ?? 0,
    fallback: data.fallback,
    error: data.error?.slice(0, 2000) || null,
    created_at: new Date().toISOString(),
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)

    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/database/tables/agent_runs/rows`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ row_data: row }),
        signal: controller.signal,
      },
    )
    clearTimeout(timer)

    if (res.ok) {
      console.log(`[AgentRuns] Logged ${data.chatId} (${data.fallback ? 'fallback' : 'primary'}, ${data.durationMs}ms, build=${data.buildPassed})`)
    } else {
      console.warn(`[AgentRuns] ZeroDB responded ${res.status}`)
    }
  } catch (err: any) {
    console.warn(`[AgentRuns] ZeroDB write failed: ${err?.name || err?.message || 'unknown'}`)
  }
}
