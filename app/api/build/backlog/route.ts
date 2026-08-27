/**
 * GET /api/build/backlog?idea=...&companyName=...&track=... (#287)
 *
 * Returns a per-company backlog grounded in the actual selected primitives:
 *  - built:  frontend preview + the foundational substrate (ZeroDB/ZeroMemory/AI Kit/Agent Cloud)
 *  - queued: real backend, auth, dashboard + the idea-selected business-ops primitives
 *
 * This endpoint is consumed by /api/build/ask to give Cody REAL items to cite
 * when a founder asks "what's next?" or "why doesn't X work?", so Cody names
 * concrete things — not invented placeholders — and can frame the conversion gate
 * accurately: "once you buy a domain + start a subscription, I build these."
 *
 * Query params:
 *   idea        - the founder's original idea (drives selection)
 *   companyName - used for display strings
 *   track       - 'app' | 'company'  (default 'company')
 *   companyId   - slug, used to check provisioning state
 */

import { NextRequest } from 'next/server'
import { selectPrimitives } from '@/lib/build/primitive-catalog'
import { resolveApp } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

export interface BacklogItem {
  id: string
  title: string
  status: 'built' | 'queued' | 'blocked'
  /** Why blocked (only set when status === 'blocked') */
  blockedBy?: 'subscription' | 'domain'
  primitive?: string
}

export interface BacklogResult {
  built: BacklogItem[]
  queued: BacklogItem[]
  /** Conversion gate message — Cody uses this verbatim when explaining what's next */
  gate: string
  primitiveNames: string[]
  isProvisioned: boolean
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const idea = params.get('idea') || ''
  const companyName = params.get('companyName') || 'the company'
  const track = params.get('track') === 'app' ? 'app' : 'company'
  const companyId = params.get('companyId') || ''

  let isProvisioned = false
  let hasDomain = false
  let hasPlan = false

  if (companyId) {
    const entry = await resolveApp(companyId).catch(() => null)
    isProvisioned = Boolean(entry?.zerodbProjectId)
    hasDomain = Boolean(entry?.domain)
    hasPlan = Boolean(entry?.plan)
  }

  const { foundational, selected, names } = selectPrimitives(idea, track, 6)

  // BUILT: the frontend preview + the foundational substrate are always live.
  const built: BacklogItem[] = [
    { id: 'frontend', title: `${companyName} working interactive preview (clickable, real UI)`, status: 'built' },
    { id: 'zerodb', title: 'ZeroDB — data layer LIVE in the preview (create/read/update/delete + semantic search persist through /api/db)', status: 'built', primitive: 'ZeroDB' },
    { id: 'zeromemory', title: 'ZeroMemory — cognitive memory + context persistence', status: 'built', primitive: 'ZeroMemory' },
    { id: 'aikit', title: 'AI Kit — UI components + streaming chat', status: 'built', primitive: 'AI Kit' },
    { id: 'agentcloud', title: 'Agent Cloud — nightly autonomous loop framework', status: 'built', primitive: 'Agent Cloud' },
  ]

  // QUEUED: real backend, auth, and each idea-selected business-op primitive.
  const queued: BacklogItem[] = []

  const blockedStatus = hasPlan && hasDomain ? 'queued' : 'blocked'
  const blockedBy: 'subscription' | 'domain' | undefined =
    !hasPlan ? 'subscription' : !hasDomain ? 'domain' : undefined

  // Core backend is always queued — it requires a plan to build for real.
  queued.push(
    { id: 'auth', title: 'Authentication + user accounts (OAuth, JWT, sessions)', status: blockedStatus, blockedBy },
    { id: 'backend', title: `Real API backend for ${companyName} (full business logic, not preview)`, status: blockedStatus, blockedBy },
    { id: 'dashboard', title: 'Founder dashboard — live metrics, agent controls, RLHF', status: blockedStatus, blockedBy },
  )

  // Each idea-selected primitive that isn't in the foundational set.
  for (const prim of selected) {
    if (foundational.find((f) => f.name === prim.name)) continue
    queued.push({
      id: prim.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      title: `${prim.name} — ${prim.purpose}`,
      status: blockedStatus,
      blockedBy,
      primitive: prim.name,
    })
  }

  // Conversion gate message — Cody cites this to explain the path to a real app.
  const gate = hasPlan && hasDomain
    ? `${companyName} is on a plan with a domain — these items are actively queued for the next nightly loop.`
    : !hasPlan
      ? `Your preview is a WORKING app right now — click it, add records, the data persists (the platform data layer is live in the sandbox). What a plan adds: your own domain, real user authentication, the production backend for ${selected.slice(0, 3).map((p) => p.name).join(', ')}, and the 24/7 autonomous loop. Kick the tires first — pay when you want it running for real users.`
      : `You're on a plan — grab a custom domain and I'll deploy the full stack. The frontend is live; I'm building the backend now.`

  const result: BacklogResult = { built, queued, gate, primitiveNames: names, isProvisioned }
  return Response.json(result)
}
