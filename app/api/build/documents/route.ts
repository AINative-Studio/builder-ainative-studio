/**
 * /api/build/documents (#64) — the company's persistent Documents library
 * (Documents + Reports), the machine surface for the DocumentsPanel on the Live
 * dashboard AND for a founder's own agent (AX, #64 req 6).
 *
 * Documents = durable artifacts (mission/roadmap/research/market). Reports =
 * time-series operational outputs (the daily/nightly report). Both persist per
 * {owner, company} in ZeroDB (`build_documents`), scoped exactly like the chat
 * (#52), tasks (#55) and versions (#62) stores. Docs survive reload + re-login
 * and accumulate over time.
 *
 *   GET  ?companyId=…&tab=all|document|report   → { documents: DocumentSummary[], counts, kinds }
 *   GET  ?companyId=…&id=…                       → { document: BuildDocument }   (VIEW / agent get)
 *   POST { companyId, type, generate? }          → { document }   (generate + persist a durable doc)
 *   POST { companyId, title, content, type? }    → { document }   (persist a caller-authored doc/report)
 *
 * Generation reuses the SAME Claude completion stack as the artifact generator
 * (Bedrock/Anthropic → AINative fallback) and enforces the quality bar: structured
 * markdown (Executive Summary → Key Findings → Sources) grounded in the real idea,
 * never lorem. The owner half of the scope is ALWAYS taken from the server session —
 * never trusted from the body — so one founder can't read/write another's library.
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { completeText } from '@/lib/build/claude-completion'
import {
  createDocument,
  listDocuments,
  getDocument,
  countByKind,
  filterByTab,
  toSummary,
  normalizeType,
  isDocTab,
  DOC_KINDS,
  type DocType,
} from '@/lib/build/document-store'
import { DOCUMENT_PROMPTS, isGeneratableDocType, type DocGenContext } from '@/lib/build/document-prompts'

export const runtime = 'nodejs'

const ainative = new OpenAI({
  apiKey: process.env.AINATIVE_API_KEY || process.env.API_Key || process.env.ZERODB_API_KEY || '',
  baseURL: (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1',
})
const AINATIVE_MODEL = process.env.BUILD_DOC_MODEL || 'claude-sonnet-4.5'
const AINATIVE_FALLBACK = 'nous-coder'

/** Resolve the durable documents scope key from the SERVER session + company slug. */
async function resolveScopeKey(companyId: string): Promise<string> {
  const slug = String(companyId || '').trim()
  if (!slug) return ''
  const session = await auth().catch(() => null)
  return chatScopeKey(deriveOwnerKey(session as any), slug)
}

/** The kind vocabulary, so a client/agent can render tabs generically. */
const KIND_META = [
  { kind: 'all', label: 'All' },
  ...DOC_KINDS.map((k) => ({ kind: k, label: k === 'document' ? 'Documents' : 'Reports' })),
]

/**
 * Generate a durable document's structured markdown via the shared Claude stack,
 * falling back to AINative chat-completions. Returns null when no provider can
 * produce grounded content (the caller surfaces an honest failure — never lorem).
 */
async function generateDocMarkdown(spec: { system: string; user: string }): Promise<string | null> {
  // 1) Primary: Bedrock / direct Anthropic (same stack as the artifact generator).
  try {
    const { text } = await completeText({ system: spec.system, user: spec.user, maxTokens: 1800, temperature: 0.5 })
    if (text && text.trim().length > 40) return text.trim()
  } catch (e: any) {
    console.warn('[build/documents] claude generation failed, falling back:', e?.message?.slice(0, 80))
  }
  // 2) Fallback: AINative chat-completions.
  for (const model of [AINATIVE_MODEL, AINATIVE_FALLBACK]) {
    try {
      const res = await ainative.chat.completions.create({
        model,
        max_tokens: 1800,
        temperature: 0.5,
        messages: [
          { role: 'system', content: spec.system },
          { role: 'user', content: spec.user },
        ],
      })
      const text = res.choices?.[0]?.message?.content || ''
      if (text && text.trim().length > 40) return text.trim()
    } catch (e: any) {
      console.warn(`[build/documents] ainative ${model} failed:`, e?.message?.slice(0, 80))
    }
  }
  return null
}

/**
 * GET — list the company's documents (optionally filtered by ?tab=), OR fetch one
 * full document by ?id= (VIEW / agent get). Returns an honest empty list for a
 * brand-new company. Never 500s: on any failure it yields an empty library so the
 * dashboard still renders.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const companyId = String(params.get('companyId') || params.get('chatId') || '').slice(0, 80)
  const id = params.get('id')
  const tab = params.get('tab')
  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ documents: [], counts: countByKind([]), kinds: KIND_META })

  // Single-document fetch (VIEW / agent get) — full content.
  if (id) {
    const document = await getDocument(scopeKey, String(id).slice(0, 120)).catch(() => null)
    if (!document) return Response.json({ error: 'not found' }, { status: 404 })
    return Response.json({ document })
  }

  // List (summaries — VIEW loads content on demand).
  const all = await listDocuments(scopeKey).catch(() => [])
  const visible = filterByTab(all, tab)
  return Response.json({
    documents: visible.map(toSummary),
    counts: countByKind(all),
    kinds: KIND_META,
  })
}

/**
 * POST — persist a document. Two modes:
 *  A) { generate: true, type } → generate a durable doc (research/roadmap/mission/
 *     market) from the company idea via Claude, enforcing the structured quality
 *     bar, then persist it.
 *  B) { title, content, type? } → persist a caller-authored document or report
 *     (used by the nightly loop to append the daily operational report, and by an
 *     agent that already has content).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.chatId || '').slice(0, 80)
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 })

  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ error: 'no scope' }, { status: 400 })

  // Mode A — generate a durable document from the idea.
  if (body?.generate) {
    const type = normalizeType(body?.type) as DocType
    if (!isGeneratableDocType(type)) {
      return Response.json({ error: `type "${type}" is not generatable` }, { status: 400 })
    }
    const idea = String(body?.idea || '').trim()
    if (idea.length < 3) return Response.json({ error: 'idea required to generate' }, { status: 400 })
    const ctx: DocGenContext = {
      idea: idea.slice(0, 4000),
      companyName: String(body?.companyName || companyId).slice(0, 120),
      track: body?.track === 'company' ? 'company' : 'app',
    }
    const spec = DOCUMENT_PROMPTS[type]!
    const content = await generateDocMarkdown({ system: spec.system, user: spec.user(ctx) })
    if (!content) return Response.json({ error: 'generation_unavailable' }, { status: 503 })
    const title = String(body?.title || spec.title(ctx)).slice(0, 300)
    const document = await createDocument(scopeKey, { title, content, type })
    if (!document) return Response.json({ error: 'could not persist document' }, { status: 502 })
    return Response.json({ document })
  }

  // Mode B — persist a caller-authored document / report.
  const title = String(body?.title || '').trim()
  const content = String(body?.content || '').trim()
  if (!title) return Response.json({ error: 'title required' }, { status: 400 })
  if (!content) return Response.json({ error: 'content required' }, { status: 400 })
  const document = await createDocument(scopeKey, {
    title,
    content,
    type: body?.type,
    kind: isDocTab(body?.kind) && body?.kind !== 'all' ? body.kind : undefined,
  })
  if (!document) return Response.json({ error: 'could not persist document' }, { status: 502 })
  return Response.json({ document })
}
