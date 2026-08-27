/**
 * ZeroDB Persistent Store for Builder
 *
 * Stores generated previews and showcase entries in ZeroDB NoSQL tables.
 * Survives server restarts, deploys, and scaling events.
 *
 * Project: AINative Builder (5dfbc60c-7463-4e21-ac68-9bbe536f9adf)
 * Table: generations
 */

const ZERODB_API = 'https://api.ainative.studio/api'
// Use env var for project ID — different keys have different projects
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'generations'

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || ''
}

async function zerodbRequest(
  method: string,
  path: string,
  body?: any,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<any> {
  const url = `${ZERODB_API}${path}`
  // ZeroDB list/query responses on the generations table can take 6–19s
  // (large payloads), so default generously. Reads also retry once to absorb
  // intermittent 401s / 30s timeouts (tracked in issue #58).
  const timeoutMs = opts.timeoutMs ?? 12_000
  const retries = opts.retries ?? 0

  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'X-API-Key': getApiKey(),
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(
          `[ZeroDB] ${method} ${path} failed (attempt ${attempt + 1}/${retries + 1}): ${res.status} ${text.substring(0, 100)}`,
        )
        // Retry on transient server/auth flakes; give up on client errors that won't change.
        if (attempt < retries && (res.status === 401 || res.status === 429 || res.status >= 500)) {
          continue
        }
        return null
      }
      return await res.json()
    } catch (e) {
      lastErr = e
      console.warn(
        `[ZeroDB] ${method} ${path} threw (attempt ${attempt + 1}/${retries + 1}): ${(e as Error)?.name || e}`,
      )
      // Retry on timeout / network errors.
    }
  }
  if (lastErr) throw lastErr
  return null
}

/**
 * Max serialized size of the multi-file map persisted alongside generatedCode
 * (#333). ZeroDB rows have a practical size ceiling — beyond ~800KB we skip the
 * files map (with a logged note) rather than risk failing the whole row write.
 */
const MAX_FILES_JSON_BYTES = 800_000

/**
 * Save a generation to ZeroDB (fire-and-forget)
 */
export async function saveGeneration(data: {
  chatId: string
  prompt: string
  generatedCode: string
  model: string
  codeLength: number
  category?: string
  title?: string
  isShowcase?: boolean
  ssrHtml?: string
  /** Parsed multi-file map (#333) — persisted as files_json so the Sandpack
   *  path works from the durable store, not just the live SSE stream. */
  files?: Record<string, string>
}): Promise<boolean> {
  try {
    const row: Record<string, any> = {
      chat_id: data.chatId,
      prompt: data.prompt,
      generated_code: data.generatedCode,
      model: data.model,
      code_length: data.codeLength,
      category: data.category || 'general',
      title: data.title || '',
      is_showcase: data.isShowcase || false,
      created_at: new Date().toISOString(),
    }
    if (data.ssrHtml) row.ssr_html = data.ssrHtml
    if (data.files && Object.keys(data.files).length > 0) {
      try {
        const filesJson = JSON.stringify(data.files)
        if (filesJson.length <= MAX_FILES_JSON_BYTES) {
          row.files_json = filesJson
        } else {
          console.warn(
            `[ZeroDB] files map for ${data.chatId} is ${filesJson.length}B > ${MAX_FILES_JSON_BYTES}B — skipping durable files persist (row size limit); generated_code blob still saved`,
          )
        }
      } catch {
        /* unserializable files map — persist the code without it */
      }
    }

    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
      { row_data: row }
    )

    if (result) {
      console.log(`[ZeroDB] Saved generation ${data.chatId} (${data.codeLength} chars)`)
      return true
    }
    return false
  } catch (e) {
    console.warn('[ZeroDB] Save failed:', e)
    return false
  }
}

/**
 * Load a generation by chatId from ZeroDB
 */
export async function loadGeneration(chatId: string): Promise<{
  prompt: string
  generatedCode: string
  ssrHtml?: string
  /** Durable multi-file map (#333), when one was persisted. */
  files?: Record<string, string> | null
} | null> {
  try {
    // Use ZeroDB query endpoint with server-side filtering by chat_id
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
      { filters: { chat_id: chatId }, limit: 1 }
    )

    const rows = result?.data || []
    if (rows.length > 0) {
      const row = rows[0].row_data || rows[0]
      console.log(`[ZeroDB] Loaded generation ${chatId} (${row.code_length || '?'} chars)`)
      // Rehydrate the durable files map (#333) — tolerate absent/corrupt JSON.
      let files: Record<string, string> | null = null
      if (typeof row.files_json === 'string' && row.files_json.length > 0) {
        try {
          const parsed = JSON.parse(row.files_json)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) files = parsed
        } catch {
          /* corrupt files_json — the generated_code blob is still usable */
        }
      }
      return {
        prompt: row.prompt,
        generatedCode: row.generated_code,
        ssrHtml: row.ssr_html,
        files,
      }
    }
    return null
  } catch (e) {
    console.warn('[ZeroDB] Load failed:', e)
    return null
  }
}

/**
 * List showcase entries from ZeroDB
 */
export async function listShowcaseEntries(limit = 50): Promise<any[]> {
  try {
    const result = await zerodbRequest(
      'GET',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows?limit=${limit}&filter_is_showcase=true`
    )
    return (result?.data || []).map((r: any) => r.row_data || r)
  } catch (e) {
    console.warn('[ZeroDB] List showcase failed:', e)
    return []
  }
}

/**
 * List all generations (for showcase community section).
 *
 * The ZeroDB list endpoint is slow (6–19s) and intermittently fails (issue #58),
 * which used to blank the showcase ~75% of loads. To stay resilient we:
 *  - cache the last successful result (per limit) for CACHE_TTL_MS, and
 *  - serve the last-known-good result if a fresh fetch fails.
 *
 * The cache is process-local; a single warm instance keeps the showcase up even
 * while ZeroDB is flaky. Stale-but-present always beats empty.
 */
const CACHE_TTL_MS = 60_000
type GenCacheEntry = { rows: any[]; fetchedAt: number }
const genCache = new Map<number, GenCacheEntry>()

export async function listGenerations(limit = 50): Promise<any[]> {
  const cached = genCache.get(limit)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rows
  }

  try {
    const result = await zerodbRequest(
      'GET',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows?limit=${limit}`,
      undefined,
      { timeoutMs: 25_000, retries: 1 },
    )
    // Filter to showcase-flagged rows CLIENT-SIDE. The ZeroDB
    // `filter_is_showcase=true` query param is not honored by the API (returns
    // all rows), so without this the gallery showed EVERY generation regardless
    // of is_showcase — apps flagged is_showcase=false (validation failures,
    // crashing apps) still appeared, and the persist-time `isShowcase` gate had
    // no visible effect. `is_showcase === false` is excluded; legacy rows with
    // the field absent are kept (backwards-compatible). (builder#191)
    const rows = (result?.data || [])
      .map((r: any) => r.row_data || r)
      .filter((rd: any) => rd?.is_showcase !== false)
    if (rows.length > 0) {
      genCache.set(limit, { rows, fetchedAt: now })
      return rows
    }
    // Empty/failed fetch — fall back to last-known-good rather than blanking.
    if (cached) {
      console.warn('[ZeroDB] List generations empty; serving cached rows')
      return cached.rows
    }
    return rows
  } catch (e) {
    console.warn('[ZeroDB] List generations failed:', (e as Error)?.name || e)
    if (cached) {
      console.warn('[ZeroDB] Serving stale cached generations after error')
      return cached.rows
    }
    return []
  }
}

// ============================================================
// RLHF FEEDBACK — stored in ZeroDB (survives deploys)
// ============================================================

const RLHF_TABLE = 'rlhf_feedback'

/**
 * Submit RLHF feedback for a generation (thumbs up/down)
 */
export async function submitRLHFFeedback(data: {
  chatId: string
  rating: number         // 1-5 (1=thumbs down, 5=thumbs up)
  feedback?: string      // optional text
  prompt?: string        // the original prompt
  model?: string         // which model generated it
  theme?: string         // which theme was used
  codeLength?: number    // length of generated code
  passedValidation?: boolean
}): Promise<boolean> {
  try {
    const row = {
      chat_id: data.chatId,
      rating: data.rating,
      feedback_text: data.feedback || '',
      prompt: data.prompt || '',
      model: data.model || '',
      theme: data.theme || '',
      code_length: data.codeLength || 0,
      passed_validation: data.passedValidation !== false,
      created_at: new Date().toISOString(),
    }

    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${RLHF_TABLE}/rows`,
      { row_data: row }
    )

    if (result) {
      console.log(`[RLHF] Feedback saved: chatId=${data.chatId} rating=${data.rating}`)
      return true
    }
    return false
  } catch (e) {
    console.warn('[RLHF] Feedback save failed:', e)
    return false
  }
}

/**
 * Log a generation event for RLHF tracking
 * Called automatically after every successful generation
 */
export async function logGenerationEvent(data: {
  chatId: string
  prompt: string
  model: string
  theme: string
  codeLength: number
  passedValidation: boolean
  generationTimeMs: number
  retryCount: number
  finishReason: string
}): Promise<boolean> {
  try {
    const row = {
      chat_id: data.chatId,
      prompt: data.prompt,
      model: data.model,
      theme: data.theme,
      code_length: data.codeLength,
      passed_validation: data.passedValidation,
      generation_time_ms: data.generationTimeMs,
      retry_count: data.retryCount,
      finish_reason: data.finishReason,
      created_at: new Date().toISOString(),
      // Auto-categorize for analysis
      category: categorizePrompt(data.prompt),
    }

    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${RLHF_TABLE}/rows`,
      { row_data: row }
    )

    if (result) {
      console.log(`[RLHF] Generation logged: ${data.chatId} (${data.model}, ${data.codeLength} chars, ${data.passedValidation ? 'PASS' : 'FAIL'})`)
      return true
    }
    return false
  } catch (e) {
    console.warn('[RLHF] Generation log failed:', e)
    return false
  }
}

/**
 * Get RLHF insights — aggregate metrics from feedback
 */
export async function getRLHFInsights(): Promise<{
  totalGenerations: number
  avgRating: number
  passRate: number
  avgCodeLength: number
  modelBreakdown: Record<string, { count: number; avgRating: number; passRate: number }>
  categoryBreakdown: Record<string, { count: number; avgRating: number }>
} | null> {
  try {
    const result = await zerodbRequest(
      'GET',
      `/v1/projects/${PROJECT_ID}/database/tables/${RLHF_TABLE}/rows?limit=500`
    )

    const rows = (result?.data || []).map((r: any) => r.row_data || r)
    if (rows.length === 0) return null

    const totalGenerations = rows.length
    const withRating = rows.filter((r: any) => r.rating > 0)
    const avgRating = withRating.length > 0
      ? withRating.reduce((sum: number, r: any) => sum + r.rating, 0) / withRating.length
      : 0
    const passCount = rows.filter((r: any) => r.passed_validation).length
    const passRate = (passCount / totalGenerations) * 100
    const avgCodeLength = rows.reduce((sum: number, r: any) => sum + (r.code_length || 0), 0) / totalGenerations

    // Model breakdown
    const modelBreakdown: Record<string, { count: number; totalRating: number; passCount: number }> = {}
    rows.forEach((r: any) => {
      const model = r.model || 'unknown'
      if (!modelBreakdown[model]) modelBreakdown[model] = { count: 0, totalRating: 0, passCount: 0 }
      modelBreakdown[model].count++
      if (r.rating > 0) modelBreakdown[model].totalRating += r.rating
      if (r.passed_validation) modelBreakdown[model].passCount++
    })

    const modelResult: Record<string, { count: number; avgRating: number; passRate: number }> = {}
    for (const [model, data] of Object.entries(modelBreakdown)) {
      modelResult[model] = {
        count: data.count,
        avgRating: data.totalRating > 0 ? data.totalRating / data.count : 0,
        passRate: (data.passCount / data.count) * 100,
      }
    }

    // Category breakdown
    const categoryBreakdown: Record<string, { count: number; totalRating: number }> = {}
    rows.forEach((r: any) => {
      const cat = r.category || 'unknown'
      if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { count: 0, totalRating: 0 }
      categoryBreakdown[cat].count++
      if (r.rating > 0) categoryBreakdown[cat].totalRating += r.rating
    })

    const catResult: Record<string, { count: number; avgRating: number }> = {}
    for (const [cat, data] of Object.entries(categoryBreakdown)) {
      catResult[cat] = {
        count: data.count,
        avgRating: data.totalRating > 0 ? data.totalRating / data.count : 0,
      }
    }

    return {
      totalGenerations,
      avgRating,
      passRate,
      avgCodeLength,
      modelBreakdown: modelResult,
      categoryBreakdown: catResult,
    }
  } catch (e) {
    console.warn('[RLHF] Insights failed:', e)
    return null
  }
}

/**
 * Auto-categorize a prompt for RLHF analysis
 */
function categorizePrompt(prompt: string): string {
  const lower = prompt.toLowerCase()
  if (lower.includes('dashboard') || lower.includes('analytics')) return 'dashboard'
  if (lower.includes('landing') || lower.includes('hero') || lower.includes('pricing')) return 'landing'
  if (lower.includes('ecommerce') || lower.includes('store') || lower.includes('shop') || lower.includes('cart')) return 'ecommerce'
  if (lower.includes('chat') || lower.includes('message') || lower.includes('social')) return 'social'
  if (lower.includes('task') || lower.includes('kanban') || lower.includes('todo')) return 'productivity'
  if (lower.includes('crm') || lower.includes('saas') || lower.includes('team')) return 'saas'
  if (lower.includes('blog') || lower.includes('article')) return 'content'
  if (lower.includes('music') || lower.includes('player') || lower.includes('weather')) return 'creative'
  if (lower.includes('fitness') || lower.includes('health') || lower.includes('workout')) return 'health'
  if (lower.includes('food') || lower.includes('restaurant') || lower.includes('recipe')) return 'food'
  return 'general'
}
