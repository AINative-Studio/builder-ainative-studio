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
import { resolveAppVerified } from '@/lib/build/app-registry'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { createTask, listTasks } from '@/lib/build/task-store'

export const runtime = 'nodejs'

export interface BacklogItem {
  id: string
  title: string
  status: 'built' | 'queued' | 'blocked'
  /** Why blocked (only set when status === 'blocked') */
  blockedBy?: 'subscription' | 'domain' | 'unverified'
  primitive?: string
}

export interface BacklogResult {
  built: BacklogItem[]
  queued: BacklogItem[]
  /** Conversion gate message — Cody uses this verbatim when explaining what's next */
  gate: string
  primitiveNames: string[]
  isProvisioned: boolean
  /**
   * #832-class bug (#1327): false when the registry lookup itself failed
   * (ZeroDB hiccup/timeout), as opposed to a confirmed "no entry yet" —
   * callers that want to tell these apart (e.g. a UI that should show "we
   * couldn't check your plan" instead of a sales pitch) can key off this.
   * Always true when companyId is empty (nothing to look up — see #1302's
   * own convention for the same distinction).
   */
  verified: boolean
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
  // #832-class bug (#1327): resolveApp()'s plain `null` return collapsed "no
  // registry entry yet" with "the registry read itself failed" — on a
  // transient ZeroDB hiccup, hasPlan/hasDomain silently became `false`,
  // which flipped every queued item's blockedBy to 'subscription' and made
  // `gate` confidently pitch a plan to a real, already-paying, provisioned
  // founder. `verified` lets this route tell the two apart; see its use
  // below for exactly how each is handled.
  let verified = true

  if (companyId) {
    const { entry, verified: v } = await resolveAppVerified(companyId).catch(() => ({ entry: null, verified: false }))
    verified = v
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

  // On an unverified lookup, deliberately never claim 'queued' (the real
  // plan/domain state is unknown, so "actively queued" would be an equally
  // unearned claim in the other direction) AND never claim blockedBy:
  // 'subscription' (a real, paying founder must never be told to pay again).
  // 'unverified' names the actual honest reason: this route couldn't check.
  const blockedStatus = !verified ? 'blocked' : hasPlan && hasDomain ? 'queued' : 'blocked'
  const blockedBy: 'subscription' | 'domain' | 'unverified' | undefined = !verified
    ? 'unverified'
    : !hasPlan ? 'subscription' : !hasDomain ? 'domain' : undefined

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

  // Wire "queued" into REAL tracked work (#670) — until now, telling a founder
  // an item is "actively queued for the next nightly loop" was never literally
  // true: this endpoint only ever computed strings, with no code path that
  // created a BuildTask row runTaskResolutions() (the real nightly loop) would
  // ever pick up. Only do this once an item is genuinely eligible to run (paid
  // plan + domain — the same gate the message already claims), and only for a
  // signed-in founder with a real company scope. Best-effort + idempotent:
  // never blocks the response, and skips items that already have a task with
  // the same title in this scope so re-asking "what's next?" doesn't create
  // duplicate tasks every call.
  if (blockedStatus === 'queued' && companyId) {
    const session = await auth().catch(() => null)
    if (session) {
      const scopeKey = chatScopeKey(deriveOwnerKey(session as any), companyId)
      const existing = await listTasks(scopeKey).catch(() => [])
      const existingTitles = new Set(existing.map((t) => t.title))
      for (const item of queued) {
        if (existingTitles.has(item.title)) continue
        void createTask(scopeKey, {
          title: item.title,
          detail: item.primitive ? `Primitive: ${item.primitive}` : undefined,
          stage: 'todo',
          source: 'cody',
        })
      }
    }
  }

  // Conversion gate message — Cody cites this to explain the path to a real app.
  // On an unverified lookup, the honest answer is "I couldn't check" — never
  // the sales pitch (which would wrongly tell a real, paying founder they
  // still need to buy a plan) and never the "actively queued" claim either
  // (the real plan/domain state is genuinely unknown here).
  const gate = !verified
    ? `I couldn't confirm your plan/domain status just now (a temporary hiccup on our end) — ask me again in a moment and I'll have a real answer.`
    : hasPlan && hasDomain
      ? `${companyName} is on a plan with a domain — these items are actively queued for the next nightly loop.`
      : !hasPlan
        ? `Your preview is a WORKING app right now — click it, add records, the data persists (the platform data layer is live in the sandbox). What a plan adds: your own domain, real user authentication, the production backend for ${selected.slice(0, 3).map((p) => p.name).join(', ')}, and the 24/7 autonomous loop. Kick the tires first — pay when you want it running for real users.`
        : `You're on a plan — grab a custom domain and I'll deploy the full stack. The frontend is live; I'm building the backend now.`

  const result: BacklogResult = { built, queued, gate, primitiveNames: names, isProvisioned, verified }
  return Response.json(result)
}
