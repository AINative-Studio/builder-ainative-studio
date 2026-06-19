/**
 * ZeroMemory Integration for Agent Recall + Cross-Product Learning (Refs #43)
 *
 * Best-effort recall/store — NEVER blocks generation.
 * Uses the ZeroDB/ZeroMemory public API for semantic memory.
 */

import { logger } from '../logger'

function getMemoryConfig() {
  const apiUrl = process.env.AINATIVE_API_URL || process.env.NEXT_PUBLIC_API_BASE || 'https://api.ainative.studio'
  const apiKey = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''
  return { apiUrl, apiKey }
}

/**
 * Recall past performance data for similar prompts.
 * Returns a string of past learnings to inject as context, or empty string.
 */
export async function recallPastPerformance(userPrompt: string): Promise<string> {
  try {
    const { apiUrl, apiKey } = getMemoryConfig()
    if (!apiKey) return ''

    const res = await fetch(`${apiUrl}/api/v1/public/memory/v2/recall`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: userPrompt,
        limit: 3,
        tags: ['builder', 'rlhf'],
      }),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return ''

    const data = await res.json()
    const memories = data.memories || data.results || []
    if (memories.length === 0) return ''

    const context = memories
      .map((m: any) => m.content || m.text || '')
      .filter(Boolean)
      .join('\n')

    if (context) {
      logger.info('Recalled past performance context', {
        memoryCount: memories.length,
        contextLength: context.length,
      })
    }

    return context
  } catch {
    return ''
  }
}

/**
 * Store a successful (or failed) generation as a searchable memory
 * for cross-product learning. Fire-and-forget.
 */
export async function storeGenerationMemory(
  prompt: string,
  success: boolean,
  quality: number,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const { apiUrl, apiKey } = getMemoryConfig()
    if (!apiKey) return

    await fetch(`${apiUrl}/api/v1/public/memory/v2/remember`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `Builder generation: "${prompt.slice(0, 200)}" — ${success ? 'succeeded' : 'failed'}, quality=${quality.toFixed(2)}`,
        tags: ['builder', 'generation', success ? 'success' : 'failure', 'rlhf'],
        importance: success ? 0.4 : 0.7,
        metadata: {
          prompt: prompt.slice(0, 500),
          success,
          quality,
          source: 'builder.ainative.studio',
          ...metadata,
        },
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {})
  } catch {
    // Best-effort — never block generation
  }
}
