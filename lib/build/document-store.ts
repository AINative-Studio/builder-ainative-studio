/**
 * Persistent Documents library (#64) — the company's durable, listable library of
 * generated documents (Documents) and time-series operational Reports, owned by
 * the company and surviving sessions.
 *
 * WHY: Builder generates artifacts in-flow (Brief, Mission, PRD, …) but had no
 * persistent, listable Documents library with a Reports distinction, and no
 * daily-report concept. Polsia's "Documents" modal is the company's auto-generated
 * document library (tabs ALL / DOCUMENTS / REPORTS) — entries like "Research:
 * Audit top 5 competing platforms", "Product Roadmap", "Mission", "Market
 * Research", each dated with a VIEW action, accumulating over time. This module
 * backs a first-class Documents library with our own primitive — a ZeroDB
 * `build_documents` table — so docs are durable and owned, mirroring the
 * `build_chat` (chat-store.ts), `build_tasks` (task-store.ts) and `build_versions`
 * (version-store.ts) stores already on main.
 *
 * SCOPE KEY: each document is keyed by {ownerKey}::{companySlug}, exactly like the
 * chat/task/version stores — the authenticated user's email when signed in, else a
 * stable guest key. So a guest's library survives reload; once they log in the
 * migrate flow re-owns their companies and future docs key by email.
 *
 * KIND: a document is either a durable ARTIFACT ('document' — mission/roadmap/
 * research/market) or a time-series 'report' (the daily/nightly operational
 * report — what the swarm did, metrics, next actions). The `kind` drives the
 * Documents vs Reports tabs.
 *
 * The heavy I/O (ZeroDB) is isolated from the pure logic (scope key, kind/type
 * normalization, tab filtering, sort, coercion) so the pure core is unit-testable
 * without a network — same split as the sibling stores.
 */

import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'build_documents'

/**
 * The two kinds of library entry, driving the Documents vs Reports tabs (#64 req 2).
 *  - document: a durable artifact (mission, roadmap, research, market research).
 *  - report:   a time-series operational output (daily/nightly report).
 */
export const DOC_KINDS = ['document', 'report'] as const
export type DocKind = (typeof DOC_KINDS)[number]

/** The tab a user can select: 'all' spans both kinds. */
export type DocTab = 'all' | DocKind

/**
 * Document types (the human category shown as a chip on each card). Durable docs
 * are the four Polsia-style artifacts + a generic 'note'; reports are 'daily'.
 */
export const DOC_TYPES = [
  'research',
  'roadmap',
  'mission',
  'market',
  'note',
  'daily',
] as const
export type DocType = (typeof DOC_TYPES)[number]

/** Human labels for each document type (chip text). */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  research: 'Research',
  roadmap: 'Product Roadmap',
  mission: 'Mission',
  market: 'Market Research',
  note: 'Note',
  daily: 'Daily Report',
}

/** Which document types are durable artifacts (kind='document'). */
const DOCUMENT_TYPES: DocType[] = ['research', 'roadmap', 'mission', 'market', 'note']

/** A single persisted library document. */
export interface BuildDocument {
  /** Stable id (client/server-generated). */
  id: string
  /** Owner+company scope key this document belongs to. */
  scopeKey: string
  /** 'document' (durable artifact) | 'report' (time-series). */
  kind: DocKind
  /** Category chip (research/roadmap/mission/market/note/daily). */
  type: DocType
  /** Short human title. */
  title: string
  /** Full structured markdown body (shown in VIEW). */
  content: string
  /** ISO timestamp created (the "date" column + sort key). */
  createdAt: string
}

/** A library entry as shown in the list (no heavy `content` — VIEW loads it inline). */
export interface DocumentSummary {
  id: string
  kind: DocKind
  type: DocType
  typeLabel: string
  title: string
  createdAt: string
}

/** Hard cap on how many documents a single load returns (defends payload size). */
export const MAX_LOAD_DOCUMENTS = 200

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

// ---------------------------------------------------------------------------
// PURE LOGIC (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

/**
 * Resolve the durable scope key for a documents library from a session + company
 * slug. Reuses the chat store's owner-key derivation + scope composition so a
 * founder's documents, chat, tasks and versions all key identically (same owner,
 * same company). Pure.
 */
export function documentScopeKey(
  session: Parameters<typeof deriveOwnerKey>[0],
  companySlug: string,
): string {
  return chatScopeKey(deriveOwnerKey(session), companySlug)
}

/**
 * Normalize an arbitrary type-ish value to a valid DocType. Accepts common
 * aliases so external callers (and the artifact generator) can use loose
 * vocabulary. Unknown values fall back to 'note'. Pure.
 */
export function normalizeType(value: unknown): DocType {
  const s = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if ((DOC_TYPES as readonly string[]).includes(s)) return s as DocType
  switch (s) {
    case 'audit':
    case 'competitive':
    case 'competitor':
    case 'competitors':
    case 'analysis':
      return 'research'
    case 'product_roadmap':
    case 'roadmap_doc':
    case 'plan':
      return 'roadmap'
    case 'vision':
    case 'company_mission':
    case 'manifesto':
      return 'mission'
    case 'market_research':
    case 'tam':
    case 'sizing':
      return 'market'
    case 'daily_report':
    case 'nightly':
    case 'nightly_report':
    case 'operational':
    case 'ops':
      return 'daily'
    default:
      return 'note'
  }
}

/**
 * Derive the kind (document vs report) from a type. The 'daily' type is the only
 * report today; everything else is a durable document. Pure — so the generator
 * and the store agree on which tab an entry lands in.
 */
export function kindForType(type: DocType): DocKind {
  return type === 'daily' ? 'report' : 'document'
}

/** Normalize a kind-ish value to a valid DocKind, defaulting to 'document'. Pure. */
export function normalizeKind(value: unknown): DocKind {
  const s = String(value || '').trim().toLowerCase()
  return s === 'report' ? 'report' : 'document'
}

/** Is `value` a valid tab ('all' | 'document' | 'report')? Pure. Validates filter input. */
export function isDocTab(value: unknown): value is DocTab {
  const s = String(value)
  return s === 'all' || (DOC_KINDS as readonly string[]).includes(s)
}

/**
 * Filter a document list by tab. 'all' (or falsy) returns everything; a kind tab
 * returns only that kind. An unknown tab returns []. Pure.
 */
export function filterByTab<T extends { kind: DocKind }>(docs: T[], tab?: string | null): T[] {
  const list = Array.isArray(docs) ? docs : []
  if (!tab || tab === 'all') return list
  if (!isDocTab(tab)) return []
  return list.filter((d) => d.kind === tab)
}

/**
 * Count documents per kind (for the tab badges), always returning a full record so
 * every tab shows a number (0 when empty). Pure.
 */
export function countByKind(docs: { kind: DocKind }[]): Record<DocTab, number> {
  const counts: Record<DocTab, number> = { all: 0, document: 0, report: 0 }
  for (const d of Array.isArray(docs) ? docs : []) {
    if (d?.kind === 'document' || d?.kind === 'report') {
      counts[d.kind] += 1
      counts.all += 1
    }
  }
  return counts
}

/**
 * Coerce a raw ZeroDB row (or a partial input) into a valid BuildDocument, filling
 * defaults and normalizing kind/type. Returns null when the row has no usable
 * title or content (so garbage rows are dropped). Pure.
 */
export function coerceDocument(raw: any, scopeKey = ''): BuildDocument | null {
  const rd = raw?.row_data || raw
  if (!rd) return null
  const title = String(rd.title || '').trim()
  const content = String(rd.content || '').trim()
  if (!title || !content) return null
  const createdAt = String(rd.created_at || rd.createdAt || new Date().toISOString())
  const type = normalizeType(rd.type)
  // Persisted kind wins if valid; else derive from the type (keeps old rows sane).
  const kind = rd.kind ? normalizeKind(rd.kind) : kindForType(type)
  return {
    id: String(rd.id || `d_${createdAt}_${title.slice(0, 12)}`),
    scopeKey: String(rd.scope_key || rd.scopeKey || scopeKey),
    kind,
    type,
    title: title.slice(0, 300),
    content: content.slice(0, 40000),
    createdAt,
  }
}

/** Project a full document to a list summary (drops the heavy `content`). Pure. */
export function toSummary(doc: BuildDocument): DocumentSummary {
  return {
    id: doc.id,
    kind: doc.kind,
    type: doc.type,
    typeLabel: DOC_TYPE_LABELS[doc.type],
    title: doc.title,
    createdAt: doc.createdAt,
  }
}

/**
 * Sort documents newest-created first, so the freshest doc/report is on top. Pure
 * & non-mutating.
 */
export function sortDocuments<T extends { createdAt: string }>(docs: T[]): T[] {
  return [...(Array.isArray(docs) ? docs : [])].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''),
  )
}

/**
 * The canonical set of durable "starter" documents a company's library should
 * accumulate (the Polsia-style four). Used to decide which docs the nightly loop
 * should ensure exist / refresh. Pure.
 */
export function starterDocumentTypes(): DocType[] {
  return ['research', 'roadmap', 'mission', 'market']
}

// ---------------------------------------------------------------------------
// ZeroDB I/O — isolated from the pure logic above
// ---------------------------------------------------------------------------

async function zerodbRequest(
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<any> {
  const url = `${ZERODB_API}${path}`
  const timeoutMs = opts.timeoutMs ?? 12_000
  const retries = opts.retries ?? 0
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        if (attempt < retries && (res.status === 401 || res.status === 429 || res.status >= 500)) continue
        return null
      }
      return await res.json()
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) throw lastErr
  return null
}

/**
 * Persist a document for a scope. Best-effort: returns the created BuildDocument on
 * success, null on any failure (never throws) so a persistence hiccup can't break
 * the request. The type is normalized and the kind derived from it before write.
 */
export async function createDocument(
  scopeKey: string,
  input: { title: string; content: string; type?: string; kind?: string },
): Promise<BuildDocument | null> {
  const title = String(input?.title || '').trim()
  const content = String(input?.content || '').trim()
  if (!scopeKey || !title || !content) return null
  const now = new Date().toISOString()
  const id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const type = normalizeType(input.type)
  const kind = input.kind ? normalizeKind(input.kind) : kindForType(type)
  const row = {
    id,
    scope_key: scopeKey,
    kind,
    type,
    title: title.slice(0, 300),
    content: content.slice(0, 40000),
    created_at: now,
  }
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
      { row_data: row },
    )
    if (!result) return null
    return coerceDocument(row, scopeKey)
  } catch (e) {
    console.warn('[document-store] createDocument failed:', (e as Error)?.name || e)
    return null
  }
}

/**
 * List documents for a scope, newest-first, capped at `limit`. Returns [] on empty
 * / failure — an honest empty state for a new company, never fabricated.
 */
export async function listDocuments(
  scopeKey: string,
  limit: number = MAX_LOAD_DOCUMENTS,
): Promise<BuildDocument[]> {
  if (!scopeKey) return []
  const cap = Math.min(Math.max(1, limit), MAX_LOAD_DOCUMENTS)
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
      { filters: { scope_key: scopeKey }, limit: cap },
      { retries: 1 },
    )
    const rows: any[] = result?.data || []
    const docs = rows
      .map((r) => coerceDocument(r, scopeKey))
      .filter((d): d is BuildDocument => d !== null)
    return sortDocuments(docs).slice(0, cap)
  } catch (e) {
    console.warn('[document-store] listDocuments failed:', (e as Error)?.name || e)
    return []
  }
}

/**
 * Fetch a single document (with full `content`) by id within a scope. Returns null
 * when not found / on failure. The scope filter ensures one founder can't read
 * another company's document. Used by the VIEW action + agent get.
 */
export async function getDocument(scopeKey: string, id: string): Promise<BuildDocument | null> {
  if (!scopeKey || !id) return null
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
      { filters: { scope_key: scopeKey, id }, limit: 1 },
      { retries: 1 },
    )
    const rows: any[] = result?.data || []
    if (!rows.length) return null
    return coerceDocument(rows[0], scopeKey)
  } catch (e) {
    console.warn('[document-store] getDocument failed:', (e as Error)?.name || e)
    return null
  }
}
