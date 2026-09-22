/**
 * /api/build/ask (#207 · B2, #287, #288, #52) — the "Ask Cody anything" chat on
 * the Live dashboard.
 *
 * Improvements:
 *  #288 — system prompt now uses the company's ACTUAL selected primitives from
 *          the catalog (via catalogPromptBlock) instead of a hardcoded list.
 *  #287 — Cody knows what's live vs queued, can explain the conversion gate, and
 *          names 3-5 concrete backlog items for THIS company — not invented ones.
 *  #52  — the conversation is now PERSISTENT and Cody has MEMORY. Each turn
 *          (user + Cody) is written to ZeroDB, scoped per {owner, company}, and
 *          the last N turns are fed to Claude so follow-ups have context. A GET
 *          on this route rehydrates the thread on mount, so reload/re-login
 *          restores exactly where the founder left off.
 *
 * POST body: { question, idea, companyName?, track?, companyId?, chatId? }
 * POST returns: { answer, model, provider }
 * GET  ?companyId=…&chatId=…  returns: { turns: [{ role, text, createdAt }] }
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { getClaudeCompletion, completeText } from '@/lib/build/claude-completion'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { resolveActivePlan } from '@/lib/ainative/active-plan'
import { modelsForTier } from '@/lib/build/tier-models'
import { selectPrimitives, catalogPromptBlock } from '@/lib/build/primitive-catalog'
import {
  deriveOwnerKey,
  chatScopeKey,
  loadChatWithFallback,
  saveExchange,
  buildMessagesWithHistory,
  type ChatAttachment,
} from '@/lib/build/chat-store'
import { resolveApp } from '@/lib/build/app-registry'
import { processConversation } from '@/lib/agent/zeromemory'
import { detectEditIntent, QUESTION_STARTERS } from '@/lib/build/edit-intent'
import { createIssue, listIssues } from '@/lib/git/gitea-client'
import { ensureChatSummary } from '@/lib/build/chat-summary'
import { ensureCompanyProfile } from '@/lib/build/company-profile'
import { getAinativeApiKey } from '@/lib/build/env-keys'
import { fetchFileDownload } from '@/lib/build/media-schedule'
import { resolveAttachmentBlocks, type ChatAttachmentRef } from '@/lib/build/chat-attachment'

export const runtime = 'nodejs'

const ainative = new OpenAI({
  apiKey: getAinativeApiKey(),
  baseURL: (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1',
})

async function resolveTier(): Promise<string> {
  try {
    const session = await auth()
    const accessToken = (session as any)?.accessToken
    if (!accessToken) return 'hobbyist'
    return (await getPlanStatus(accessToken)).tier || 'hobbyist'
  } catch {
    return 'hobbyist'
  }
}

/**
 * Resolve the durable conversation scope key for THIS request from the server
 * session (owner) + the company/chat identifier (never trusted from the body
 * for the owner half). Authenticated users key by email; guests key by their
 * stable guest session so the thread survives reload. Returns '' when there is
 * no company identifier to scope by (persistence/load are then skipped).
 */
async function resolveScopeKey(companyId: string): Promise<string> {
  const slug = String(companyId || '').trim()
  if (!slug) return ''
  const session = await auth().catch(() => null)
  const ownerKey = deriveOwnerKey(session as any)
  return chatScopeKey(ownerKey, slug)
}

/**
 * Resolve the company's own dedicated ZeroDB project id (#400), when it has
 * one — real per-company chat ownership instead of the shared platform
 * project. Best-effort: any resolution failure yields undefined, which makes
 * every chat-store call below fall back to the shared project (unchanged
 * pre-#400 behavior) rather than failing the request.
 */
export async function resolveCompanyProjectId(companyId: string): Promise<string | undefined> {
  const slug = String(companyId || '').trim()
  if (!slug) return undefined
  try {
    const entry = await resolveApp(slug)
    return entry?.zerodbProjectId || undefined
  } catch {
    return undefined
  }
}

/** Fetch a compact backlog summary for this company to ground Cody's answers.
 *  Plan-aware: a PAID founder's queue is framed as work-in-queue (their plan
 *  covers it) — the conversion-gate line is only included for free accounts.
 *
 *  #774 (Gap 2): also surfaces the company's REAL Gitea issues (open +
 *  recently closed) when it's git-provisioned, so "it's in the queue"/
 *  "already built" claims are grounded in the SAME system of record the
 *  nightly loop and the SMS-to-issue path (#744) already use — not only the
 *  synthetic, idea-derived primitive list /api/build/backlog computes.
 *  Real gap this closes: that synthetic list never changes based on what a
 *  founder has actually asked for or what's genuinely been done — a founder
 *  who'd been told "I'll wire that" for a specific request had no way to see
 *  whether it was real. Best-effort and additive: an unconfigured/unreachable
 *  Gitea, or a company with no repo yet, silently omits this section rather
 *  than blocking or degrading the rest of the backlog grounding.
 */
async function fetchBacklogSummary(companyId: string, idea: string, companyName: string, track: string, paid: boolean, gitOrg?: string): Promise<string> {
  let synthetic = ''
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
    const url = new URL('/api/build/backlog', base)
    url.searchParams.set('companyId', companyId)
    url.searchParams.set('idea', idea)
    url.searchParams.set('companyName', companyName)
    url.searchParams.set('track', track)
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) })
    const d = r.ok ? await r.json().catch(() => null) : null
    if (d) {
      const builtNames = d.built?.map((b: any) => b.title).join('; ') || ''
      const queuedNames = (d.queued || []).slice(0, 5).map((q: any) => q.title).join('; ')
      synthetic =
        `COMPANY BACKLOG:\n` +
        `Built & live now: ${builtNames}\n` +
        (paid
          ? `In the queue (covered by the founder's plan — next runs pick these up): ${queuedNames}`
          : `Queued (part of the paid build-out): ${queuedNames}\n` +
            `Conversion gate: ${d.gate || ''}`)
    }
  } catch {
    // Fall through — the Gitea section below is independent of this succeeding.
  }

  let giteaSection = ''
  if (gitOrg) {
    const result = await listIssues(gitOrg, companyId, { state: 'all', limit: 15 }).catch(() => null)
    if (result?.ok && result.issues) {
      const open = result.issues.filter((i) => i.state === 'open').slice(0, 8)
      const closed = result.issues.filter((i) => i.state === 'closed').slice(0, 5)
      if (open.length || closed.length) {
        giteaSection =
          `\n\nREAL TRACKED REQUESTS (this company's own Gitea repo — the actual system of record ` +
          `for "I'll wire that"/"it's queued" claims):\n` +
          (open.length ? `Open — genuinely not done yet: ${open.map((i) => `#${i.number} ${i.title}`).join('; ')}\n` : '') +
          (closed.length ? `Recently closed — genuinely shipped: ${closed.map((i) => `#${i.number} ${i.title}`).join('; ')}` : '')
      }
    }
  }

  return synthetic + giteaSection
}

/** A single, cheap word-boundary check for whether `question` reads as a
 *  plain question — the exact same filter detectEditIntent already applies
 *  (QUESTION_STARTERS/trailing `?`), reused here rather than re-derived so
 *  the two heuristics can never silently disagree. */
function looksLikePlainQuestion(question: string): boolean {
  const q = question.trim().toLowerCase()
  if (!q) return true
  return QUESTION_STARTERS.test(q) || q.endsWith('?')
}

/** Cap the classifier's own timeout well under the caller's overall request
 *  budget — a slow/hung classifier call must never be the reason a chat
 *  reply itself times out. Failing this check just means no issue gets
 *  filed for THIS message (the honest, safe default), never a crash. */
const CLASSIFIER_TIMEOUT_MS = 6_000

/**
 * #774 (Gap 2): does `question` read as a genuine feature/change request,
 * even though detectEditIntent's deliberately-conservative imperative-verb
 * match didn't fire? Two layers:
 *
 *  1. Deterministic heuristic (no LLM call): ANY non-question message that
 *     reaches here already passed detectEditIntent's own "not a question"
 *     filter without matching an edit verb — e.g. a bare topic phrase like
 *     "The stripe integration". Conservative on its own would under-fire on
 *     genuine requests phrased as statements-with-more-words; ambitious on
 *     its own would over-fire on plain conversational remarks ("that makes
 *     sense", "thanks"). So the heuristic here is intentionally narrow: it
 *     only auto-qualifies a SHORT message (<= 6 words) with no verb at all
 *     detectEditIntent would recognize — the exact "The stripe integration"
 *     shape from the real incident — and defers everything longer/more
 *     conversational to the classifier below.
 *  2. Secondary classifier (single cheap Claude call): for anything the
 *     heuristic didn't already resolve, ask a real, narrowly-scoped
 *     yes/no question. Bounded timeout; any failure (timeout, no provider
 *     configured, malformed response) is treated as "no" — the safe
 *     default is under-filing (Cody just doesn't get to say "it's queued"
 *     for an ambiguous remark), never over-filing junk issues into a
 *     founder's real repo.
 */
async function isLikelyChangeRequest(question: string): Promise<boolean> {
  const q = question.trim()
  if (!q || looksLikePlainQuestion(q)) return false

  const wordCount = q.split(/\s+/).length
  if (wordCount <= 6) return true

  try {
    const result = await Promise.race([
      completeText({
        system:
          'You classify a single message from a startup founder to their AI co-founder. ' +
          'Answer with EXACTLY one word: YES if the message is a genuine feature request, change request, ' +
          'or something the founder wants built/fixed/added — even if phrased as a topic or statement rather ' +
          'than a command (e.g. "the stripe integration", "dark mode would be nice", "my checkout is broken"). ' +
          'Answer NO if it is a plain question, small talk, an acknowledgment, or unrelated to requesting work.',
        user: q,
        maxTokens: 5,
        temperature: 0,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CLASSIFIER_TIMEOUT_MS)),
    ])
    if (!result) return false
    return /^yes/i.test(result.text.trim())
  } catch {
    return false
  }
}

/**
 * Fetch + base64-encode an attachment's image bytes for a real Anthropic
 * multimodal content block (#741). Resolves the file's presigned download URL
 * via `fetchFileDownload` (the SAME resolver the media/documents serve routes
 * use — presigns expire, so this must be looked up fresh per request, never
 * cached) then fetches the bytes directly. Returns null on any failure (a
 * stale fileId, an expired/broken presign, a transient network error) so the
 * caller can degrade to an honest text mention instead of losing the request.
 * Real I/O, kept out of lib/build/chat-attachment.ts so that module stays a
 * pure, network-free unit under test.
 */
async function resolveImageBase64(attachment: ChatAttachmentRef): Promise<string | null> {
  try {
    const download = await fetchFileDownload(attachment.fileId)
    if (!download?.url) return null
    const res = await fetch(download.url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) return null
    return Buffer.from(bytes).toString('base64')
  } catch {
    return null
  }
}

export interface AskCodyParams {
  question: string
  attachments?: ChatAttachment[]
  idea: string
  companyName: string
  track: 'app' | 'company'
  companyId: string
  /** Pre-resolved conversation scope key (owner + company). The dashboard
   *  route derives this from the browser session; a non-browser caller
   *  (e.g. the SMS webhook, #744 follow-up) has no session to read but CAN
   *  derive the identical key from the company registry's own ownerEmail
   *  (deriveOwnerKey's authenticated-user branch is just the lowercased
   *  email) — passing it in here is what lets a founder's text message and
   *  dashboard chat share the SAME persisted conversation thread. */
  scopeKey: string
  /** Pre-resolved account tier (hobbyist/pro/business/…). Same reasoning as
   *  scopeKey — resolveTier() reads the browser session; a caller with no
   *  session resolves the tier itself (e.g. from the company's own stored
   *  `plan`) and passes it through. */
  tier: string
  /** Origin to dispatch a real edit task against (POST {baseUrl}/api/build/edit-app),
   *  when this turn's question matches detectEditIntent. The dashboard route
   *  derives this from the incoming request's own URL; a non-HTTP caller
   *  (the SMS webhook) has no request to read one from, so it passes
   *  NEXT_PUBLIC_APP_URL / the production origin explicitly instead. */
  baseUrl: string
  /** Max prior turns to load as context (default: chat-store's own
   *  MAX_LOAD_TURNS, 100). Real bug found live (2026-09-16): a voice call
   *  shares the SAME persisted conversation thread as the dashboard/SMS, so
   *  a long-running phone call kept re-sending more and more accumulated
   *  history to the LLM on every turn — turn latency climbed 4.7s → 6s →
   *  7.6s → 12s+ (timed out) purely from growing prompt size, against a
   *  live caller who is waiting in real time and against Twilio's own hard
   *  15s webhook-response ceiling. The voice webhook passes a small cap
   *  here; dashboard/SMS omit this and keep the full default. */
  historyLimit?: number
}

export interface AskCodyResult {
  answer: string
  provider: string
  model: string
}

/**
 * Core "ask Cody" logic — model call, system-prompt construction, history,
 * and persistence. Extracted from POST (2026-09-16, SMS-conversation
 * follow-up to #744) so a non-browser transport (the inbound-SMS webhook)
 * can have the SAME real conversation with Cody a founder gets on the
 * dashboard — same system prompt, same backlog grounding, same persisted
 * history — instead of a separate, narrower one-shot action. Every
 * session-derived input (scopeKey, tier) is a parameter here, never
 * resolved internally, so this function has no dependency on a browser
 * session at all.
 */
export async function askCody(params: AskCodyParams): Promise<AskCodyResult | { error: string; status: number }> {
  const { question, idea, companyName, track, companyId, scopeKey, tier: tierName, baseUrl, historyLimit } = params
  const attachments = params.attachments || []
  if (!question && attachments.length === 0) return { error: 'question required', status: 400 }

  const companyProjectId = await resolveCompanyProjectId(companyId)
  const history = scopeKey ? await loadChatWithFallback(scopeKey, historyLimit, companyProjectId).catch(() => []) : []

  // Get the actual primitives selected for this company's idea
  const { names: primitiveNames } = selectPrimitives(idea, track)
  const primList = primitiveNames.join(', ')

  // Plan-aware voice (Greg Rose feedback 2026-08-27): resolve the account's real
  // plan BEFORE building the prompt/backlog framing — see gateInstructions below.
  //
  // #830: this used to be `resolveActivePlan().catch(() => ({ plan: '' as const }))`,
  // which discarded `verified` on ANY error and collapsed "couldn't confirm the
  // plan this turn" into the exact same shape as "confirmed unpaid" — the precise
  // anti-pattern lib/ainative/active-plan.ts's own doc comment warns every caller
  // against (the #762 bug class: a transient core /auth/me hiccup silently
  // demoted a real Enterprise founder). Confirmed live: a real paying customer
  // (agentive) asked Cody "what's next" and was told "you're on the free tier."
  // resolveActivePlan() already fails safely internally (auth() itself is
  // caught, returning NONE with verified:true for "no session") — the extra
  // .catch() here only fired on a genuine internal error, and threw away the
  // one signal (`verified`) that exists specifically so callers don't do this.
  // auto-mode/route.ts's checkGate() gets this right; mirrored here.
  const { plan: activePlan, verified: planVerified } = await resolveActivePlan().catch(
    () => ({ plan: '' as const, verified: false }),
  )
  const paid = Boolean(activePlan)

  // #748: resolve the company's registry entry ONCE, unconditionally, so its
  // real provisioning fields (gitOrg, zerodbProjectId, plan) are always in
  // scope for BOTH the edit-intent check below AND the honest-provisioning-
  // status system-prompt block (provisioningInstructions) further down. Before
  // this fix, resolveApp(companyId) was only ever called INSIDE the
  // detectEditIntent branch — a founder who simply asked "is my company set
  // up?" never triggered it, so the data Cody needed to answer honestly was
  // never fetched for that turn at all. Confirmed root cause of the false "I
  // don't have a way to check your git provisioning status" answer (issue
  // #748) — the data was resolvable, just never resolved for that question
  // shape. Best-effort: any resolution failure yields null, which the honest-
  // status block below treats the same as "not provisioned" (never as "must
  // be live" — the safe default is to under-claim, not over-claim).
  const app = companyId ? await resolveApp(companyId).catch(() => null) : null

  // Real "edit an already-deployed app from chat" capability (#582). Requires
  // the company to be git-provisioned (paid + provisioned, see #689) — the
  // same hard requirement resolveTask itself enforces. Fires as a DETACHED
  // background task (never awaited here) so this reply stays fast — the real
  // outcome (PR opened, merged, or an honest failure) lands in the founder's
  // own Tasks panel, already rendered on the Live dashboard, not a second
  // silent channel. Gated on companyId being a real registry entry, not the
  // ask-only `idea` param, so a stray edit-shaped question with no company
  // context never triggers a wasted implement+commit attempt.
  let editTriggered = false
  if (companyId && app?.gitOrg && detectEditIntent(question)) {
    editTriggered = true
    void fetch(`${baseUrl}/api/build/edit-app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, request: question }),
    }).catch(() => {})
  }

  // #774 (Gap 2): a paid, git-provisioned founder's message that ISN'T an
  // imperative edit (detectEditIntent correctly stayed conservative — a
  // topic phrase like "The stripe integration" is not a command) and ISN'T a
  // plain question either is exactly the shape of message a founder sends
  // as a genuine feature/change request in conversational language. Before
  // this fix, gateInstructions unconditionally told Cody to respond to
  // EVERY such message with "I'll wire that next — it's in the queue" —
  // pure scripted confidence, with nothing real ever dispatched. Real
  // incident: a founder said "The stripe integration" (following an earlier
  // exchange), Cody said "I'll have this wired in the next run," and zero
  // task was created anywhere.
  //
  // Fixed with two layers, deliberately combined rather than either alone:
  //  1. A cheap, deterministic heuristic (no extra LLM call) — the same
  //     "not a plain question" filter detectEditIntent already uses. This
  //     guarantees the promise can never be made hollow again for the
  //     obvious case (any non-question message), independent of whether a
  //     classifier call succeeds or times out.
  //  2. A secondary, single-purpose classifier call for genuinely ambiguous
  //     phrasing the heuristic's blunt filter might still miss (e.g. a
  //     complaint or an aside that isn't obviously a request) — ONLY run
  //     when the heuristic didn't already resolve it, to bound the extra
  //     latency/cost to the cases that actually need it.
  // Either path files a REAL Gitea issue in the company's own repo before
  // the system prompt is built, so `realWorkFiledThisTurn` can gate whether
  // "I'll wire that"/"it's in the queue" language is actually true this turn.
  let realWorkFiledThisTurn: { issueNumber: number; title: string } | null = null
  if (companyId && app?.gitOrg && paid && !editTriggered) {
    const looksLikeAGenuineRequest = await isLikelyChangeRequest(question)
    if (looksLikeAGenuineRequest) {
      const title = question.length > 80 ? `${question.slice(0, 79)}…` : question
      const created = await createIssue(
        app.gitOrg,
        companyId,
        title,
        `${question}\n\n---\nFiled automatically from a founder chat message (#774) — Cody said or was about to say ` +
          `this is queued/being worked on, so a real tracked issue backs that claim.`,
      ).catch(() => null)
      if (created?.ok && created.issueNumber) {
        realWorkFiledThisTurn = { issueNumber: created.issueNumber, title }
      }
    }
  }

  // #748: whether this company has been REALLY provisioned (a real ZeroDB
  // project exists) — the single source of truth the honest-status system-
  // prompt block below reasons from. A brand-new company with only an
  // idea-generation registry row (no zerodbProjectId/gitOrg/plan set) reads
  // as unprovisioned here, same as the real "Clearpath" row that triggered
  // this issue.
  const isProvisioned = Boolean(app?.zerodbProjectId)

  // Fetch backlog so Cody can cite real items (not invented ones)
  const backlogBlock = companyId
    ? await fetchBacklogSummary(companyId, idea, companyName, track, paid, app?.gitOrg)
    : ''

  // Build the catalog block for context
  const catalogBlock = catalogPromptBlock(idea, track)

  // Cody was scripted to pitch "buy a domain + subscription" to EVERY founder —
  // including paying Enterprise accounts, and including free founders who still
  // have build credits and CAN iterate right now. A paying founder is never
  // pitched; a free founder is told what they can do NOW for free first.
  //
  // #774 (Gap 2): the paid-tier "I'll wire that next — it's in the queue"
  // line used to be unconditional — said for EVERY change/feature message,
  // whether or not anything was actually dispatched. Now conditioned on
  // realWorkFiledThisTurn (a real Gitea issue genuinely filed THIS turn, see
  // isLikelyChangeRequest above) OR editTriggered (a real background
  // implement-task genuinely dispatched THIS turn) — Cody is only allowed to
  // claim "it's queued" when one of those actually happened just now.
  const realWorkHappenedThisTurn = editTriggered || Boolean(realWorkFiledThisTurn)
  const gateInstructions = !planVerified
    ? // #830: the plan genuinely could not be confirmed this turn (a transient
      // verification failure, not a real answer) — never assert either "paid"
      // or "free tier" when this is true, since either claim has a real chance
      // of being flatly wrong for whoever is actually asking.
      `- Your account/plan status could not be confirmed for this message (a temporary check, not a real ` +
      `answer about their account). Do NOT say they're on the free tier, do NOT say a plan is required, and do ` +
      `NOT assume they're unpaid. If it's relevant to their question, say plan/billing status isn't available ` +
      `right now and to check the Account screen or refresh — otherwise just answer their actual question and ` +
      `don't bring up plans/billing at all.\n`
    : paid
    ? `- The founder is on a PAID AINative plan (${activePlan}) — their plan already covers the build-out. ` +
      `NEVER pitch a subscription, plan, or purchase, and never say work is "gated". ` +
      (realWorkHappenedThisTurn
        ? `When they ask for a change or feature: confirm you're on it in first person ` +
          `("I'll wire that next — it's in the queue for tonight's run"), name the concrete backlog items ` +
          `it maps to, and point at the real levers they already have (Auto Mode, the nightly loop, ` +
          `regenerating the app from the workspace).${realWorkFiledThisTurn ? ` A real tracked issue (#${realWorkFiledThisTurn.issueNumber}) was just filed in their company repo for this — you may reference it directly.` : ''}\n`
        : `If they ask for a change or feature and no real task was just dispatched for it (you'll know because ` +
          `neither an edit task nor a tracked issue was created this turn), do NOT say "I'll wire that" or "it's ` +
          `queued" — those claims are ONLY true when real work was just dispatched. Instead say you've noted it and ` +
          `will follow up, or ask one specific clarifying question if the request is genuinely unclear.\n`) +
      `A custom domain is OPTIONAL — mention it only if they ask about domains.\n`
    : `- The founder is on the FREE tier. They can still iterate NOW at no cost: updating and ` +
      `regenerating the app preview from the workspace uses their free build allowance — say so ` +
      `plainly when they ask for a change, and tell them to make the change from the workspace. ` +
      `Only the REAL backend build-out (production data wiring, 24/7 ops, custom domain) is part of ` +
      `a plan: frame that honestly as "when you're ready to make it real" — never imply a small ` +
      `edit requires payment. Do NOT promise free future backend feature work.\n`

  // #748: honest provisioning-status grounding. Real incident: an admin-
  // created company ("Clearpath") had a real registry row but NO owner, NO
  // ZeroDB project, NO primitives, NO auth — provisioning only ever happens
  // via the separate /api/build/provision endpoint, never automatically. Cody
  // still claimed "the data layer is fully functional" and "next up in the
  // queue is authentication," and when asked directly whether git
  // provisioning had run, said "I don't have a way to check your git
  // provisioning status from this chat" — FALSE, since `app` (resolved just
  // above) already carries that answer. This block is the fix: it puts the
  // REAL provisioning state in front of Cody explicitly, with an unambiguous
  // instruction never to claim otherwise.
  const provisioningInstructions = isProvisioned
    ? `- PROVISIONING STATUS: this company IS provisioned — it has a real per-company cloud project ` +
      `(ZeroDB project id on file). You CAN and MUST answer questions about provisioning/setup status ` +
      `directly and confidently; never say you "don't have a way to check" — you do, and it says live.\n`
    : `- PROVISIONING STATUS: this company has NOT been provisioned yet — there is no per-company ZeroDB ` +
      `project, no primitive resources, and no real authentication wired up for it yet. If asked about ` +
      `setup/provisioning/git status, or whether data/auth/primitives are live, say so PLAINLY: nothing ` +
      `has been provisioned yet, and mention it happens automatically once the founder engages with this ` +
      `dashboard (auto-provisioning), or can be triggered right now from the "Provision cloud" control in ` +
      `Website & infrastructure. NEVER say "I don't have a way to check" — you DO have this data, it's ` +
      `simply telling you setup hasn't run yet. NEVER claim the data layer, ZeroMemory context, auth, or ` +
      `any primitive is "fully functional," "handling context," "next in the queue," or otherwise live — ` +
      `none of that is true until provisioning actually completes.\n`

  // #780: the #748 pattern above (ground Cody on general cloud-provisioning
  // status) had a real, primitive-specific blind spot for ZeroVoice. Real
  // incident: a founder TEXTED Fieldko's real, live ZeroVoice number asking
  // whether it could handle two-way SMS — Cody's reply, sent back over that
  // SAME number, said ZeroVoice "isn't wired into this company yet." Self-
  // contradicting in the most direct way possible: the founder's own message
  // and Cody's own reply both proved the opposite. `app.zerovoiceProvisioned`/
  // `app.zerovoiceE164` (lib/build/app-registry.ts) already carry the real
  // answer — this block puts it in front of Cody explicitly, the same way
  // provisioningInstructions does for general cloud provisioning.
  const zerovoiceInstructions = app?.zerovoiceProvisioned && app?.zerovoiceE164
    ? `- ZEROVOICE STATUS: this company HAS a real, live ZeroVoice phone number (${app.zerovoiceE164}) — ` +
      `SMS and voice are ALREADY wired up and working. If asked whether this company can text/call, or ` +
      `whether ZeroVoice is connected, answer YES confidently and reference the real number. NEVER say ` +
      `ZeroVoice "isn't wired into this company yet" or that it's part of a future build-out — that is ` +
      `false whenever this line is shown to you.\n`
    : `- ZEROVOICE STATUS: this company has NOT provisioned a ZeroVoice phone number yet — there is no ` +
      `real SMS/calling capability live. If asked about texting/calling/telephony, say so plainly and ` +
      `point at the "Get a phone number" action in Website & infrastructure (paid plans only). Do not ` +
      `imply a number already exists.\n`

  const system =
    `You are Cody, the AI co-founder who just built and now operates "${companyName}", ` +
    `an AI-native ${track === 'app' ? 'product' : 'company'} built on AINative primitives.\n\n` +
    `The founder's idea: "${idea}".\n\n` +
    `This company's selected primitives (what is actually wired for this idea, not a generic list): ${primList}.\n\n` +
    `${catalogBlock}\n\n` +
    (backlogBlock ? `${backlogBlock}\n\n` : '') +
    `INSTRUCTIONS:\n` +
    `- Answer the founder's question directly, concretely, and in first person as Cody.\n` +
    `- Be specific to THIS company and THIS idea — not generic AI advice.\n` +
    `- If they ask about status, what's next, or why things aren't working yet:\n` +
    `  (a) Say what IS live now (the frontend preview + foundational primitives above).\n` +
    `  (b) Name the SINGLE next concrete backlog item from the company backlog above (use its actual ` +
    `title) — not a menu of everything on the backlog. If they specifically ask "what could you build" ` +
    `or "what are all my options," THEN list 3-5 items; otherwise stay on the one next thing.\n` +
    `- SEQUENTIAL, NOT A DUMP: when the founder asks you to design or build something, address what ` +
    `they actually asked for — do not respond with a multi-part architecture proposal covering things ` +
    `they didn't ask about, and do not enumerate every feature/endpoint/table you could possibly build. ` +
    `Pick the one thing they asked for, describe that, and stop.\n` +
    `- NEVER end a reply with an open-ended question ("does this direction feel right?", "what would ` +
    `you like me to adjust?", "should I proceed?"). If you genuinely need one decision to continue, ask ` +
    `ONE specific question with a concrete two-option or yes/no choice — never a broad menu.\n` +
    `- PRIMITIVE DISAMBIGUATION (#773): the catalog above lists BOTH foundational substrate every ` +
    `company gets (OpenCapStack, ZeroDB, ZeroMemory, AI Kit, Agent Cloud — present regardless of what ` +
    `this specific question is about) AND idea-matched business-ops primitives. When the founder asks ` +
    `about a SPECIFIC capability, answer with the primitive whose own listed purpose actually names that ` +
    `capability — never a foundational primitive just because it sounds finance/business-adjacent. ` +
    `Concretely: a question about PAYMENTS, STRIPE, CHECKOUT, or GETTING PAID is answered by ZeroInvoice, ` +
    `ZeroCommerce, or the standalone bring-your-own-Stripe primitive — NEVER OpenCapStack (that is cap ` +
    `table/equity/SAFEs/vesting, unrelated to processing a payment, even though it is finance-adjacent ` +
    `and always present for this company). Real incident this fixes: Cody named OpenCapStack for a plain ` +
    `"can I connect my own Stripe account" question, twice, in the same conversation where it had ` +
    `already correctly identified ZeroInvoice/ZeroCommerce as Stripe-capable — read each primitive's ` +
    `actual listed purpose before naming it, don't pattern-match on the topic being finance-shaped.\n` +
    gateInstructions +
    provisioningInstructions +
    zerovoiceInstructions +
    `- TRUTH CONSTRAINT: the preview IS a working interactive app with LIVE data persistence ` +
    `(create/read/update/delete and semantic search work in the sandbox through the platform data ` +
    `layer). NEVER claim data persistence, interactivity, or the data layer are "not live yet" or ` +
    `"only come with a plan" — that is false and destroys trust. What a plan actually adds: own ` +
    `domain, real user authentication, production backend hardening, and 24/7 autonomous ops. ` +
    `IMPORTANT DISTINCTION per the PROVISIONING STATUS above: this preview-sandbox persistence is ` +
    `separate from the company's OWN permanent per-company cloud project (auth, dedicated ZeroDB ` +
    `project, primitives) — never conflate the two. If this company is not yet provisioned, it is ` +
    `still true the preview works, but false that a permanent per-company backend, auth, or primitive ` +
    `connections are live — say exactly that when asked, don't blur the two claims together.\n` +
    `- REAL EDITING CAPABILITIES ON THIS DASHBOARD — do not invent workflows beyond these, even if ` +
    `they sound plausible for a product like this:\n` +
    `  * There IS a real in-chat file upload (#741): the attach button next to this chat lets the ` +
    `founder share an image or reference document directly in the conversation. Uploaded images are ` +
    `sent to you as real image content, so you genuinely see them — describe what you actually see, ` +
    `don't guess. Uploaded documents (PDF/DOC/DOCX/TXT/MD/CSV) are NOT yet text-extracted for you — you ` +
    `know the file's name and type, but not its contents; ask the founder to paste or describe the ` +
    `relevant part if you need specifics. This chat is otherwise plain text.\n` +
    (editTriggered
      ? `  * REAL EDIT IN PROGRESS: this founder's message IS a change request, and it has just been ` +
        `dispatched as a REAL tracked task — the exact same pipeline (implement → commit → coverage-` +
        `verify → auto-merge/redeploy) the nightly loop uses. Confirm this in first person, tell them ` +
        `it will show up in their Tasks panel below with real progress, and that it typically takes a ` +
        `few minutes (a real LLM implementation + a real coverage-gated merge, not instant). Do NOT say ` +
        `"I'll wire that next" as a vague future promise — the work has genuinely already started.\n`
      : `  * REAL EDIT CAPABILITY (#582): a founder's genuine change request ("change the headline to X", ` +
        `"add a dark mode toggle") CAN be dispatched as a real tracked task that implements, commits, ` +
        `coverage-verifies, and auto-merges the change into the live app — but ONLY once the company is ` +
        `git-provisioned (requires a paid plan). If this founder is not yet provisioned and asks for a ` +
        `change, tell them honestly that real edits need a paid plan first (do not claim the edit already ` +
        `happened), and that meanwhile they can keep iterating for free by regenerating from the workspace.\n`) +
    `  * There IS a real logo upload: "Logo & brand" in the Website & app section (Build Ops) lets ` +
    `the founder upload their own logo/brand mark (PNG/JPG/WebP/SVG, up to 2MB) and it is saved to ` +
    `their company.\n` +
    `  * IMPORTANT HONEST LIMIT: an uploaded logo is saved to the founder's account but is NOT yet ` +
    `automatically pushed into an ALREADY-DEPLOYED company's live generated site — that requires the ` +
    `founder's next real regeneration/redeploy to pick it up, and is not guaranteed today. Say this ` +
    `plainly if asked whether it's live yet; do not claim the live site updates automatically.\n` +
    `  * "Auto Media" (the Growth section) lets the founder upload their own photos or have Cody ` +
    `generate on-brand images/video — but those assets are NOT currently wired into the generated ` +
    `app/landing page automatically. Uploading a photo there does not change the live site.\n` +
    `  * "Redeploy" (Build Ops section) re-ships the CURRENT stored version — it does not regenerate ` +
    `or accept new creative direction.\n` +
    `  * If asked to change something the platform can't directly wire into the live site yet, say so ` +
    `honestly — do not describe a workflow that doesn't exist. It is fine to say this is a real gap ` +
    `and name it as backlog-worthy feedback, but never fabricate a plausible-sounding set of steps to ` +
    `work around it.\n` +
    `- PLAIN TEXT ONLY: no markdown, no asterisks, no headers — this chat renders raw text.\n` +
    `- Keep it to 2-4 sentences for simple questions; up to 6 sentences for status/next-steps questions.\n` +
    `- No fluff, no disclaimers. Run it 24/7 via the nightly autonomous loop.`

  const tier = modelsForTier(tierName)

  // Real multimodal content (#741): resolve any attachments on THIS turn into
  // Anthropic content blocks — images become real base64 image blocks (Cody
  // actually sees them), documents become an honest text mention (name/type
  // only, no content). Only ever resolves the CURRENT turn's attachments —
  // history turns stay plain text (see buildMessagesWithHistory's docblock).
  const attachmentBlocks = attachments.length > 0
    ? await resolveAttachmentBlocks(attachments, resolveImageBase64)
    : []

  // Conversation window: prior turns + the current question, so follow-ups
  // ("make it cheaper", "and add auth") resolve against real context (#52).
  const messages = buildMessagesWithHistory(history, question, undefined, attachmentBlocks)

  /**
   * Persist the completed exchange. Real bug found live (#608 investigation):
   * this used to fire saveExchange with `void` (never awaited) immediately
   * before `return Response.json(...)` — with almost no wall-clock time
   * between the call firing and the handler function returning, the save
   * was silently lost on every single real request (confirmed live: 0 rows
   * ever landed in build_chat despite dozens of real POST /api/build/ask
   * calls, all returning 200 with a real answer). AWAIT the save itself —
   * it's a single fast ZeroDB POST, and correctness of the founder's own
   * conversation history matters enough to spend the extra latency on.
   * processConversation (builder#686, cross-turn fact extraction) stays
   * fire-and-forget — it's a genuinely optional enrichment, not required
   * for the exchange itself to be durably saved.
   */
  // appendChatTurn requires non-empty text — a founder who sends ONLY an
  // attachment (no typed question) still needs a persisted user turn, so fall
  // back to a short honest placeholder rather than silently dropping the turn.
  const persistedQuestion = question || (attachments.length > 0 ? '[Sent an attachment]' : question)

  const persist = async (answer: string) => {
    if (scopeKey && answer) {
      // saveExchange/appendChatTurn already catch their own errors internally
      // and resolve to false rather than reject — this catch is defense in
      // depth, so a truly unexpected throw still can't break the chat reply.
      await saveExchange(scopeKey, persistedQuestion, answer, companyProjectId, attachments).catch(() => {})
      // processConversation (fact extraction) expects plain-text message
      // content — flatten any multimodal blocks from this turn to their text
      // portion (image bytes carry nothing extractable as a durable memory).
      const textMessages = messages.map((m) => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
          : m.content,
      }))
      void processConversation(
        [...textMessages, { role: 'assistant', content: answer }],
        scopeKey,
      )
    }
  }

  const claude = getClaudeCompletion()
  if (claude) {
    const model = claude.provider === 'bedrock' ? tier.bedrockModel : claude.model
    try {
      const res = await claude.client.messages.create({
        model, max_tokens: 600, temperature: 0.7, system,
        messages,
      })
      const answer = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
      if (answer) { await persist(answer); return { answer, provider: claude.provider, model } }
    } catch (e: any) {
      console.warn(`[build/ask] ${claude.provider} failed: ${e?.message?.slice(0, 80)}`)
    }
  }

  // Fallback: AINative chat-completions. This path uses OpenAI's
  // chat-completions message shape, not Anthropic's — an Anthropic
  // `{type: 'image', source: {...}}` block would be meaningless here, so
  // multimodal turns degrade to their text content only (the question text +
  // an honest mention that an image was attached) rather than sending a
  // malformed request. Real image content only ever reaches the primary
  // Claude path above; this fallback firing on a multimodal turn is already a
  // degraded path (the primary provider failed), so losing image vision here
  // (while keeping the text/mentions) is an acceptable, honest trade-off.
  const fallbackMessages = messages.map((m) => ({
    role: m.role,
    content: Array.isArray(m.content)
      ? m.content
          .map((b) => (b.type === 'text' ? b.text : '[an image was attached — not visible on this fallback path]'))
          .join('\n')
          .trim() || '[an image was attached — not visible on this fallback path]'
      : m.content,
  }))
  try {
    const res = await ainative.chat.completions.create({
      model: tier.ainativeModel, max_tokens: 600, temperature: 0.7,
      messages: [{ role: 'system', content: system }, ...fallbackMessages],
    })
    const answer = res.choices?.[0]?.message?.content?.trim()
    if (answer) { await persist(answer); return { answer, provider: 'ainative', model: tier.ainativeModel } }
  } catch (e: any) {
    console.warn(`[build/ask] ainative failed: ${e?.message?.slice(0, 80)}`)
  }

  return { error: 'unavailable', status: 503 }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const question = String(body?.question || '').trim()
  const attachments: ChatAttachment[] = Array.isArray(body?.attachments)
    ? body.attachments
        .filter((a: any) => a && a.fileId && a.url && a.contentType && a.fileName)
        .slice(0, 5)
        .map((a: any) => ({
          fileId: String(a.fileId).slice(0, 200),
          url: String(a.url).slice(0, 500),
          contentType: String(a.contentType).slice(0, 100),
          fileName: String(a.fileName).slice(0, 200),
        }))
    : []
  if (!question && attachments.length === 0) return Response.json({ error: 'question required' }, { status: 400 })

  const idea = String(body?.idea || '').slice(0, 3000)
  const companyName = String(body?.companyName || 'the company').slice(0, 120)
  const track = body?.track === 'app' ? 'app' : 'company'
  // chatId wins over companyId as the scope identifier when present (#52) so a
  // company with multiple build threads keeps them distinct; falls back to slug.
  const companyId = String(body?.chatId || body?.companyId || '').slice(0, 80)

  const scopeKey = await resolveScopeKey(companyId)
  const tier = await resolveTier()
  // request.url is only actually read when an edit gets dispatched
  // (editTriggered inside askCody) — a real NextRequest always has a valid
  // absolute url, but resolve it defensively so a malformed/mocked request
  // can never crash a plain Q&A turn that was never going to use it.
  let baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  if (!baseUrl) {
    try {
      baseUrl = new URL(request.url).origin
    } catch {
      baseUrl = ''
    }
  }

  const result = await askCody({ question, attachments, idea, companyName, track, companyId, scopeKey, tier, baseUrl })
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json(result)
}

/**
 * GET /api/build/ask?companyId=…&chatId=… (#52) — rehydrate the persisted Cody
 * conversation for the current owner + company, oldest-first. Returns an honest
 * empty list for a brand-new company (no fabricated history). Never 500s: on any
 * failure it yields an empty thread so the dashboard still renders.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const companyId = String(params.get('chatId') || params.get('companyId') || '').slice(0, 80)
  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ turns: [] })
  const companyProjectId = await resolveCompanyProjectId(companyId)
  const turns = await loadChatWithFallback(scopeKey, undefined, companyProjectId).catch(() => [])

  // Chat handoff summary (#608): "where we left off" for a returning founder,
  // regenerated only when enough new turns warrant it (ensureChatSummary is
  // internally best-effort — never throws, never blocks the thread load).
  const companyName = String(params.get('companyName') || 'the company').slice(0, 120)
  const idea = String(params.get('idea') || '').slice(0, 3000)
  const summaryResult = await ensureChatSummary(scopeKey, companyName, idea, turns).catch(() => null)

  // "What Cody has learned" (#693): a synthesized profile of real founder-Cody
  // memories, reflected only when enough new ones have accumulated
  // (ensureCompanyProfile is internally best-effort — never throws, never
  // blocks the thread load). Independent of the chat summary above — this
  // reads from ZeroMemory's own synthesis, not the raw turn history.
  const profileResult = await ensureCompanyProfile(scopeKey).catch(() => null)

  return Response.json({ turns, summary: summaryResult?.summary || null, profile: profileResult })
}
