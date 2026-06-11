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
const PROJECT_ID = '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
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
}): Promise<boolean> {
  try {
    const row = {
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
export async function loadGeneration(chatId: string): Promise<{ prompt: string; generatedCode: string } | null> {
  try {
    // GET with filter query param
    const result = await zerodbRequest(
      'GET',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows?limit=1&filter_chat_id=${encodeURIComponent(chatId)}`
    )

    const rows = result?.data || []
    if (rows.length > 0) {
      const row = rows[0].row_data || rows[0]
      console.log(`[ZeroDB] Loaded generation ${chatId}`)
      return {
        prompt: row.prompt,
        generatedCode: row.generated_code,
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
