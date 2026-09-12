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
        // Hybrid vector + graph traversal (Refs #3426) — live-verified by
        // core 2026-09-10 (docs/guides/CODE_TRIGGERS_MEMORY.md): finds
        // contextually relevant prior builds that plain vector similarity
        // misses (e.g. a prior build that used the same PRIMITIVE for a
        // differently-worded idea). Same response shape either way
        // ({results: [...]}), so this is a pure quality upgrade with no
        // caller-visible change. Builder previously only ever did flat
        // vector search here — the whole point of recallPastPerformance's
        // own "cross-product learning" doc comment.
        use_graph: true,
        // storeGenerationMemory now writes each generation's memory into a
        // per-session namespace (builder#674, item 3) instead of the one
        // implicit 'global' pool. recallPastPerformance's whole purpose is
        // learning from OTHER builds' memories, so it must explicitly search
        // across all namespaces — otherwise the namespace scoping above would
        // silently break cross-product learning by hiding every OTHER
        // session's memories from this recall.
        allow_cross_namespace: true,
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
 *
 * `entityId` (added alongside the use_graph recall upgrade, builder#674):
 * pass the generation's own chatId here so this memory is attributable to
 * a real entity, not just a floating text blob. This is a bigger win than
 * it looks — ZeroMemory's remember() ALREADY runs entity extraction on the
 * content and auto-relates every extracted entity to entity_id via /relate
 * (see core's ZeroMemory.remember, "Relate each extracted entity to the
 * memory's primary entity") whenever entity_id is set. So passing the
 * chatId here gets the real Context Graph benefit — this company's build
 * genuinely linked to whatever primitives/technologies got extracted from
 * its own generation record — for free, with no separate /relate call
 * needed on Builder's side. Optional and additive: omitting it keeps
 * today's exact behavior (a memory with no entity_id, same as before).
 *
 * Namespace (builder#674, item 3): every call site already passes a real
 * chatId/sessionId as `entityId` — reused here as a `session:{entityId}`
 * ZeroMemory namespace (core's own valid namespace kinds, verified against
 * core/src/backend/app/services/memory/zeromemory.py's _validate_namespace:
 * 'global' | 'project:<id>' | 'session:<id>') instead of every company's
 * generation memory landing in the one implicit 'global' pool. No new
 * plumbing needed — omitting entityId keeps today's exact 'global' behavior.
 */
export async function storeGenerationMemory(
  prompt: string,
  success: boolean,
  quality: number,
  metadata?: Record<string, any>,
  entityId?: string,
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
        ...(entityId ? { entity_id: entityId, namespace: `session:${entityId}` } : {}),
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
