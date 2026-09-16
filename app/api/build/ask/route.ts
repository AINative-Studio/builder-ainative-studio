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
import { getClaudeCompletion } from '@/lib/build/claude-completion'
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
import { detectEditIntent } from '@/lib/build/edit-intent'
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
 *  covers it) — the conversion-gate line is only included for free accounts. */
async function fetchBacklogSummary(companyId: string, idea: string, companyName: string, track: string, paid: boolean): Promise<string> {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
    const url = new URL('/api/build/backlog', base)
    url.searchParams.set('companyId', companyId)
    url.searchParams.set('idea', idea)
    url.searchParams.set('companyName', companyName)
    url.searchParams.set('track', track)
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return ''
    const d = await r.json().catch(() => null)
    if (!d) return ''

    const builtNames = d.built?.map((b: any) => b.title).join('; ') || ''
    const queuedNames = (d.queued || []).slice(0, 5).map((q: any) => q.title).join('; ')
    return (
      `COMPANY BACKLOG:\n` +
      `Built & live now: ${builtNames}\n` +
      (paid
        ? `In the queue (covered by the founder's plan — next runs pick these up): ${queuedNames}`
        : `Queued (part of the paid build-out): ${queuedNames}\n` +
          `Conversion gate: ${d.gate || ''}`)
    )
  } catch {
    return ''
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
  const { plan: activePlan } = await resolveActivePlan().catch(() => ({ plan: '' as const }))
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

  // #748: whether this company has been REALLY provisioned (a real ZeroDB
  // project exists) — the single source of truth the honest-status system-
  // prompt block below reasons from. A brand-new company with only an
  // idea-generation registry row (no zerodbProjectId/gitOrg/plan set) reads
  // as unprovisioned here, same as the real "Clearpath" row that triggered
  // this issue.
  const isProvisioned = Boolean(app?.zerodbProjectId)

  // Fetch backlog so Cody can cite real items (not invented ones)
  const backlogBlock = companyId
    ? await fetchBacklogSummary(companyId, idea, companyName, track, paid)
    : ''

  // Build the catalog block for context
  const catalogBlock = catalogPromptBlock(idea, track)

  // Cody was scripted to pitch "buy a domain + subscription" to EVERY founder —
  // including paying Enterprise accounts, and including free founders who still
  // have build credits and CAN iterate right now. A paying founder is never
  // pitched; a free founder is told what they can do NOW for free first.
  const gateInstructions = paid
    ? `- The founder is on a PAID AINative plan (${activePlan}) — their plan already covers the build-out. ` +
      `NEVER pitch a subscription, plan, or purchase, and never say work is "gated". ` +
      `When they ask for a change or feature: confirm you're on it in first person ` +
      `("I'll wire that next — it's in the queue for tonight's run"), name the concrete backlog items ` +
      `it maps to, and point at the real levers they already have (Auto Mode, the nightly loop, ` +
      `regenerating the app from the workspace). A custom domain is OPTIONAL — mention it only if ` +
      `they ask about domains.\n`
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
    gateInstructions +
    provisioningInstructions +
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
