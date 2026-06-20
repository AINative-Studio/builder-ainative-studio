/**
 * ZeroDB Persistent Store for Builder
 *
 * Stores generated previews and showcase entries in ZeroDB NoSQL tables.
 * Survives server restarts, deploys, and scaling events.
 *
 * Project: AINative Builder (5dfbc60c-7463-4e21-ac68-9bbe536f9adf)
 * Table: generations
 */

const ZERODB_API = 'https://api.ainative.studio'
// Use env var for project ID — different keys have different projects
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '29e8754c-c67d-4a74-9167-a069d87ab1aa'
const TABLE_NAME = 'generations'

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || ''
}

async function zerodbRequest(method: string, path: string, body?: any): Promise<any> {
  const url = `${ZERODB_API}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'X-API-Key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn(`[ZeroDB] ${method} ${path} failed: ${res.status} ${text.substring(0, 100)}`)
    return null
  }
  return res.json()
}

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
export async function loadGeneration(chatId: string): Promise<{ prompt: string; generatedCode: string; ssrHtml?: string } | null> {
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
      return {
        prompt: row.prompt,
        generatedCode: row.generated_code,
        ssrHtml: row.ssr_html,
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
 * List all generations (for showcase community section)
 */
export async function listGenerations(limit = 50): Promise<any[]> {
  try {
    const result = await zerodbRequest(
      'GET',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows?limit=${limit}`
    )
    return (result?.data || []).map((r: any) => r.row_data || r)
  } catch (e) {
    console.warn('[ZeroDB] List generations failed:', e)
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
