/**
 * Design memory (real ZeroDB persistence) — a company build's accumulated
 * design preferences (color scheme, typography, spacing) and recent
 * component-generation history, surfaced back into later generations in the
 * same build thread so Cody stays visually/architecturally consistent
 * instead of re-deciding from scratch every call.
 *
 * Replaces lib/services/memory.service.ts (removed), which had two real
 * bugs found in review (2026-09-13):
 *
 * 1. Architecture-boundary violation: it persisted this data — real project
 *    artifacts (generated component code, design decisions) — into
 *    ZeroMemory's /remember endpoint. ZeroMemory is scoped to agent/
 *    conversation memory and entity-relationship graphs (confirmed against
 *    core's own current design docs: docs/ZeroMemory-Context-Graph-Analysis.md
 *    and cody-cli's MEMORY_FEATURE_PLAN.md — both scope ZeroMemory to facts,
 *    conversations, and typed entity relationships, never raw project
 *    artifacts). Real business/project data belongs in a real ZeroDB table,
 *    Postgres, or the vector/lakehouse APIs — never memory.
 * 2. Its primary store was an in-memory JS Map (the module's own comment:
 *    "In-memory store (replace with database in production)") — lost on
 *    every redeploy, and in practice never actually read back anyway: it was
 *    keyed on chat-ws's `responseId`, which is `chatId || nanoid()` — a
 *    brand-new, un-reused id on the very first call of any build thread, so
 *    the very same request that later WROTE to it could never have READ
 *    anything from it. Only genuine continuations (a real `chatId` already
 *    assigned) could ever benefit, and even then the data never survived a
 *    deploy.
 *
 * Fix: a real ZeroDB table (`build_design_memory`), append-only + latest-
 * wins (mirroring chat-summary.ts/app-registry.ts's own established
 * pattern), keyed on the real, stable `chatId` chat-ws already assigns per
 * build thread (not a per-call id) — genuinely persists across redeploys
 * and genuinely accumulates across real continuations.
 */

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'build_design_memory'

/** Only the most recent N components/feedback items are kept in the prompt —
 *  mirrors the old in-memory version's own `.slice(-3)` cap, so the prompt
 *  section doesn't grow unbounded over a long build thread. */
const MAX_RECENT_ITEMS = 3

export interface DesignPreferences {
  colorScheme?: string[]
  typography?: string
  spacing?: string
}

export interface ComponentHistoryEntry {
  prompt: string
  componentType: string
  createdAt: string
}

export interface FeedbackEntry {
  issue: string
  resolution: string
  createdAt: string
}

export interface DesignMemory {
  chatId: string
  designPreferences?: DesignPreferences
  componentHistory: ComponentHistoryEntry[]
  feedback: FeedbackEntry[]
  updatedAt: string
}

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

async function zerodbRequest(method: string, path: string, body?: unknown): Promise<any> {
  try {
    const res = await fetch(`${ZERODB_API}${path}`, {
      method,
      headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Extract a readable component "type" from generated code, for the prompt
 *  summary — matches the old service's own heuristic exactly. */
export function extractComponentType(code: string): string {
  const functionMatch = code.match(/function\s+(\w+)/)
  if (functionMatch) return functionMatch[1]
  const constMatch = code.match(/const\s+(\w+)\s*=/)
  if (constMatch) return constMatch[1]
  return 'Unknown'
}

/** Load the latest design memory for a build thread, or null if none exists
 *  yet / on any failure (fails open — never blocks generation). */
export async function loadDesignMemory(chatId: string): Promise<DesignMemory | null> {
  if (!chatId) return null
  const result = await zerodbRequest(
    'POST',
    `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
    { filters: { chat_id: chatId }, limit: 50 },
  )
  const rows: any[] = result?.data || []
  const parsed = rows
    .map((r) => r.row_data || r)
    .filter((rd) => rd && rd.chat_id === chatId)
  if (!parsed.length) return null
  parsed.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  const latest = parsed[0]
  return {
    chatId,
    designPreferences: latest.design_preferences || undefined,
    componentHistory: Array.isArray(latest.component_history) ? latest.component_history : [],
    feedback: Array.isArray(latest.feedback) ? latest.feedback : [],
    updatedAt: String(latest.updated_at || ''),
  }
}

/** Persist a design memory snapshot. Append-only + latest-wins, matching
 *  chat-summary.ts's established pattern — never an update-in-place (sidesteps
 *  the real ZeroDB multi-field-filter PUT pitfall task-store.ts's updateTask
 *  hit, #698 follow-up). */
async function saveDesignMemory(memory: DesignMemory): Promise<boolean> {
  if (!memory.chatId) return false
  const result = await zerodbRequest(
    'POST',
    `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
    {
      row_data: {
        chat_id: memory.chatId,
        design_preferences: memory.designPreferences || null,
        component_history: memory.componentHistory.slice(-MAX_RECENT_ITEMS),
        feedback: memory.feedback.slice(-MAX_RECENT_ITEMS),
        updated_at: new Date().toISOString(),
      },
    },
  )
  return !!result
}

/**
 * Record a newly-generated component into the build thread's design memory.
 * Best-effort — never throws, never blocks generation on a storage failure.
 */
export async function recordComponent(chatId: string, prompt: string, componentCode: string): Promise<void> {
  if (!chatId || !prompt || !componentCode) return
  try {
    const existing = await loadDesignMemory(chatId)
    const componentHistory = [
      ...(existing?.componentHistory || []),
      { prompt: prompt.slice(0, 300), componentType: extractComponentType(componentCode), createdAt: new Date().toISOString() },
    ]
    await saveDesignMemory({
      chatId,
      designPreferences: existing?.designPreferences,
      componentHistory,
      feedback: existing?.feedback || [],
      updatedAt: new Date().toISOString(),
    })
  } catch {
    // Best-effort — never block the real generation this describes
  }
}

/**
 * Build the "prior context" prompt section for a build thread, or '' when
 * there's nothing real to show yet (a brand-new thread, or a storage
 * failure) — never a placeholder/empty-shell section like the old service
 * always injected regardless of whether it had anything to say.
 */
export async function formatDesignMemoryForPrompt(chatId: string): Promise<string> {
  if (!chatId) return ''
  const memory = await loadDesignMemory(chatId).catch(() => null)
  if (!memory) return ''
  if (!memory.designPreferences && memory.componentHistory.length === 0 && memory.feedback.length === 0) return ''

  let out = '\n## CONVERSATION CONTEXT\n\n'

  if (memory.designPreferences) {
    out += '**User Design Preferences:**\n'
    if (memory.designPreferences.colorScheme?.length) out += `- Color Scheme: ${memory.designPreferences.colorScheme.join(', ')}\n`
    if (memory.designPreferences.typography) out += `- Typography: ${memory.designPreferences.typography}\n`
    if (memory.designPreferences.spacing) out += `- Spacing: ${memory.designPreferences.spacing}\n`
    out += '\n'
  }

  if (memory.componentHistory.length > 0) {
    out += '**Recent Component History:**\n'
    memory.componentHistory.slice(-MAX_RECENT_ITEMS).forEach((c, i) => {
      out += `${i + 1}. User asked for: "${c.prompt}"\n   Component type: ${c.componentType}\n`
    })
    out += '\n'
  }

  if (memory.feedback.length > 0) {
    out += '**User Feedback Patterns:**\n'
    memory.feedback.slice(-MAX_RECENT_ITEMS).forEach((f, i) => {
      out += `${i + 1}. Issue: ${f.issue} → Resolution: ${f.resolution}\n`
    })
    out += '\n'
  }

  out += '**IMPORTANT:** Use this context to maintain consistency with user preferences and avoid repeating previous mistakes.\n\n'
  return out
}
