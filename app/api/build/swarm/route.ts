/**
 * POST /api/build/swarm (#232) — attempt a REAL AINative agent-swarm run for the
 * build, and report its status. For paid/enterprise tiers this submits a real
 * task to the platform agent-swarm; for everyone else (or when the platform
 * swarm endpoint is unavailable) it returns { real: false, reason } so the UI
 * shows the representative overlay instead of faking a live run.
 *
 * The platform's public agent-swarm endpoints are currently enterprise-gated AND
 * returning 500 (core#6422). This route is written so that the MOMENT that is
 * fixed, paid-tier builds get a real swarm with NO further Builder change — it
 * already calls the real endpoint and surfaces real status. Until then it
 * degrades honestly rather than pretending.
 *
 * Body: { description, agentTypes? }
 * Returns: { real, taskId?, status?, agents?, reason? }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { createTask, stageFromSwarmStatus } from '@/lib/build/task-store'
import { codingStandardsContextBlock } from '@/lib/build/coding-standards'

export const runtime = 'nodejs'

const SWARM_BASE = (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/api/v1/public/agent-swarm'

async function resolveTierAndToken(): Promise<{ tier: string; token: string | null; session: any }> {
  try {
    const session = await auth()
    const token = (session as any)?.accessToken || null
    if (!token) return { tier: 'hobbyist', token: null, session }
    const status = await getPlanStatus(token)
    return { tier: status.tier || 'hobbyist', token, session }
  } catch {
    return { tier: 'hobbyist', token: null, session: null }
  }
}

/**
 * Prepend the canonical AINative engineering standards to the build task the
 * swarm agents receive, so Cody's build agents actually BUILD to them (#71) —
 * the integrity piece. These are the SAME standards surfaced in the
 * `codingStandards` artifact, mirrored from the AINative skills. Kept idempotent
 * so a description already carrying the block isn't double-injected.
 */
function withCodingStandards(description: string): string {
  const block = codingStandardsContextBlock()
  if (description.includes('AINATIVE ENGINEERING STANDARDS')) return description
  return `${block}\n\n---\n\nTASK:\n${description}`
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const rawDescription = String(body?.description || '').slice(0, 4000)
  // Inject standards into the codegen context (not display-only).
  const description = withCodingStandards(rawDescription)
  const agentTypes: string[] = Array.isArray(body?.agentTypes)
    ? body.agentTypes
    : ['architect', 'backend', 'frontend', 'qa', 'security']

  const companyId = String(body?.companyId || body?.chatId || '').slice(0, 80)
  // Title/detail for the UI task record use the RAW description — the standards
  // block is context for the build agents, not user-facing task copy.
  const taskTitle = String(body?.taskTitle || rawDescription || 'Swarm task').slice(0, 400)
  const { tier, token, session } = await resolveTierAndToken()

  // Only paid tiers get the real swarm; free/anon see the representative overlay.
  const paid = tier === 'pro' || tier === 'scale' || tier === 'enterprise'
  if (!paid || !token) {
    return Response.json({ real: false, reason: 'tier', tier })
  }

  // Try the real platform agent-swarm. If it 403s (gating) or 5xxs (core#6422),
  // degrade honestly — never fabricate a live run.
  try {
    const key = process.env.AINATIVE_API_KEY || process.env.API_Key || process.env.ZERODB_API_KEY || ''
    const res = await fetch(`${SWARM_BASE}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token || key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description, agent_types: agentTypes }),
      signal: AbortSignal.timeout(12_000),
    })

    if (!res.ok) {
      return Response.json({ real: false, reason: `platform_${res.status}`, tier })
    }
    const data = await res.json().catch(() => null)
    const taskId = data?.task_id || data?.id || null
    const status = data?.status || 'queued'

    // Surface the REAL dispatched task on the company's backlog (#55) so the
    // Live Tasks panel shows it and tracks its stage. Best-effort — a persistence
    // hiccup must not fail the swarm dispatch itself.
    if (companyId) {
      const scopeKey = chatScopeKey(deriveOwnerKey(session as any), companyId)
      void createTask(scopeKey, {
        title: taskTitle,
        detail: rawDescription,
        stage: stageFromSwarmStatus(status),
        source: 'swarm',
        taskId,
      }).catch(() => {})
    }

    return Response.json({
      real: true,
      tier,
      taskId,
      status,
      agents: agentTypes,
    })
  } catch (e: any) {
    return Response.json({ real: false, reason: 'platform_unreachable', tier })
  }
}
