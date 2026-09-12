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
 * Explicitly relate a generation's entity to each primitive it composed
 * (builder#684). #675/#683 already get entity attribution "for free" via
 * `entity_id` on /remember (server-side auto-extraction + auto-relate), but
 * that only relates whatever the extractor happens to recognize in the
 * memory's free-text content — not the AUTHORITATIVE list of primitives this
 * specific generation actually selected (lib/build/primitive-catalog.ts's
 * selectPrimitives, the same source codegenCompositionBlock uses to build
 * the prompt). This calls the real POST /relate endpoint directly so the
 * Context Graph carries an explicit, reliable
 * {chatId} --uses--> {primitiveName} edge for every selected primitive,
 * queryable back via GET /graph/{entity_id} (relateEntityToPrimitives's
 * sibling, graphNeighborsOf below).
 *
 * Fire-and-forget, one call per primitive (the real API has no batch form).
 * Best-effort: a failed relate never blocks or fails generation.
 */
export async function relateEntityToPrimitives(entityId: string, primitiveNames: string[]): Promise<void> {
  if (!entityId || !primitiveNames.length) return
  const { apiUrl, apiKey } = getMemoryConfig()
  if (!apiKey) return
  await Promise.all(
    primitiveNames.map((name) =>
      fetch(`${apiUrl}/api/v1/public/memory/v2/relate`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: entityId, predicate: 'uses', object: name, confidence: 0.9 }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {}),
    ),
  )
}

/**
 * Query the Context Graph for everything related to an entity (builder#684)
 * — e.g. `graphNeighborsOf(companySlug)` after relateEntityToPrimitives has
 * run for it returns the primitives that company genuinely uses. Returns []
 * on any failure or when unconfigured; never throws.
 */
export async function graphNeighborsOf(entityId: string, limit = 50): Promise<Array<{ subject: string; predicate: string; object: string }>> {
  if (!entityId) return []
  try {
    const { apiUrl, apiKey } = getMemoryConfig()
    if (!apiKey) return []
    const res = await fetch(
      `${apiUrl}/api/v1/public/memory/v2/graph/${encodeURIComponent(entityId)}?limit=${limit}`,
      { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(5000) },
    )
    if (!res.ok) return []
    const data = await res.json()
    const rels = Array.isArray(data) ? data : data?.relationships || []
    return rels.map((r: any) => ({ subject: r.subject, predicate: r.predicate ?? r.relationship_type, object: r.object }))
  } catch {
    return []
  }
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
        // Temporal context expansion (Refs #3427, builder#686 item 1) — for
        // each matched memory, also fetch its 2 nearest neighbors by
        // created_at (same response shape, just more entries in `memories`).
        // A bare match like "used ZeroPipeline" is often thin on its own;
        // its neighbors (what came right before/after in that prior build)
        // frequently carry the actual reasoning/outcome detail that makes
        // the recalled context genuinely useful rather than a one-line echo.
        expand_context: 2,
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

/**
 * Decision Traces (builder#685) — a real, structured record of an agent's
 * reasoning + tool calls per task, mounted at
 * /api/v1/public/memory/v2/traces/* (core: app/api/v1/endpoints/
 * memory_traces.py, Refs #2110). This is the missing link #670 found: the
 * founder-visible backlog and the real BuildTask/nightly-loop pipeline are
 * connected (createTask), but nothing records WHY the agent made a given
 * generation or task-resolution decision — Decision Traces is exactly that,
 * already built and live, just never called from Builder.
 *
 * Kept deliberately thin and best-effort, matching every other helper in
 * this file: a failed trace call must never block or fail the real
 * generation/task work it's describing.
 */

/** Begin a trace. Returns the real trace_id, or null on any failure. */
export async function startDecisionTrace(task: string, sessionId: string): Promise<string | null> {
  if (!task || !sessionId) return null
  try {
    const { apiUrl, apiKey } = getMemoryConfig()
    if (!apiKey) return null
    const res = await fetch(`${apiUrl}/api/v1/public/memory/v2/traces/start`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: task.slice(0, 500), session_id: sessionId }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.trace_id || null
  } catch {
    return null
  }
}

/** Record one reasoning step within a trace. Best-effort, never throws. */
export async function addTraceStep(
  traceId: string,
  thought: string,
  action: string,
  observations?: string[],
): Promise<void> {
  if (!traceId || !thought || !action) return
  try {
    const { apiUrl, apiKey } = getMemoryConfig()
    if (!apiKey) return
    await fetch(`${apiUrl}/api/v1/public/memory/v2/traces/${encodeURIComponent(traceId)}/step`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ thought: thought.slice(0, 1000), action: action.slice(0, 200), observations }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {})
  } catch {
    // Best-effort — never block the caller's real work
  }
}

/** Mark a trace complete with its outcome. Best-effort, never throws. */
export async function completeDecisionTrace(traceId: string, outcome: string, success: boolean): Promise<void> {
  if (!traceId) return
  try {
    const { apiUrl, apiKey } = getMemoryConfig()
    if (!apiKey) return
    await fetch(`${apiUrl}/api/v1/public/memory/v2/traces/${encodeURIComponent(traceId)}/complete`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: outcome.slice(0, 500), success }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {})
  } catch {
    // Best-effort — never block the caller's real work
  }
}

/**
 * Auto-extract memories from a real conversation transcript (builder#686,
 * item 2) — POST /process (core: app/api/v1/endpoints/zeromemory.py,
 * ProcessConversationRequest, Refs #2960). Builder's ask/route.ts (the "Ask
 * Cody anything" Live-dashboard chat) already has full, real multi-turn
 * transcripts (buildMessagesWithHistory's exact {role, content}[] shape
 * matches /process's expected input) and never ran this — every real
 * exchange with a founder was a missed opportunity to auto-extract durable
 * facts/preferences instead of only ever writing the raw Q&A pair.
 *
 * `namespace` is REQUIRED by the real endpoint (Refs #2960 — no silent
 * global fallback for writes) — pass the same `session:{entityId}` shape
 * storeGenerationMemory already established for consistency.
 */
export async function processConversation(
  messages: Array<{ role: string; content: string }>,
  entityId: string,
): Promise<void> {
  if (!messages.length || !entityId) return
  try {
    const { apiUrl, apiKey } = getMemoryConfig()
    if (!apiKey) return
    await fetch(`${apiUrl}/api/v1/public/memory/v2/process`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, entity_id: entityId, namespace: `session:${entityId}` }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {})
  } catch {
    // Best-effort — never block the caller's real work
  }
}
