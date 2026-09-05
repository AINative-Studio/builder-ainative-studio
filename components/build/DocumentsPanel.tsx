'use client'

/**
 * DocumentsPanel (#64) — the company's persistent Documents library on the Live
 * dashboard.
 *
 * A listable library of the company's generated docs with Documents vs Reports
 * tabs:
 *   - Documents = durable artifacts (Research / Product Roadmap / Mission / Market
 *     Research), each with title, type chip, date and a VIEW action.
 *   - Reports   = time-series operational outputs (the daily/nightly report — what
 *     the swarm did, metrics, next actions), appended by the nightly loop.
 *
 * Data comes from /api/build/documents:
 *   GET ?companyId=…&tab=…   → { documents: DocumentSummary[], counts, kinds }
 *   GET ?companyId=…&id=…    → { document }   (VIEW loads full markdown content)
 *   POST { companyId, generate, type, idea, companyName, track }  → { document }
 *
 * VIEW renders the structured markdown (Executive Summary → Key Findings → Sources)
 * with react-markdown + remark-gfm. Chrome: reuses the `.modernist` `.m-live-card`,
 * `.st` pills, `.m-chip`, `.m-task-*` classes already used by the Tasks (#55) and
 * Versions (#62) panels, so it matches the #67 systems grid without a new visual
 * language. Honest empty state: a brand-new company shows a clear "no documents yet"
 * message with a way to generate the starter set — never fabricated entries.
 *
 * This is a NEW, distinct section — it does NOT touch the #67 systems grid, #52 chat,
 * #55 Tasks, #62 Versions or #65 masthead sections.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DOCUMENT_UPLOAD_ACCEPT_ATTR } from '@/lib/build/document-upload'

/** A library entry as returned by /api/build/documents (mirrors DocumentSummary). */
interface DocumentSummary {
  id: string
  kind: 'document' | 'report'
  type: string
  typeLabel: string
  title: string
  createdAt: string
}

/** A full document (with content) as returned by GET ?id=. */
interface FullDocument extends DocumentSummary {
  content: string
}

type Tab = 'all' | 'document' | 'report'

/** The four durable starter documents a new company can generate on demand. */
const STARTER_DOCS: { type: string; label: string }[] = [
  { type: 'research', label: 'Research' },
  { type: 'roadmap', label: 'Product Roadmap' },
  { type: 'mission', label: 'Mission' },
  { type: 'market', label: 'Market Research' },
]

/** Compact "x ago" / date for the card meta. */
function fmtDate(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function DocumentsPanel({
  companyId,
  idea,
  companyName,
  track,
  brandTagline,
  brandColor,
  canExportDeck = false,
  onExportUpgrade,
}: {
  companyId: string
  idea?: string
  companyName?: string
  track?: 'app' | 'company'
  /** Company brand tagline (#69) — themes the exported pitch deck's cover. */
  brandTagline?: string
  /** Company brand color as #RRGGBB (#69) — themes the exported pitch deck. */
  brandColor?: string
  /** True when the company is on a PAID plan, so the pitch-deck export is unlocked (#69). */
  canExportDeck?: boolean
  /** Called when a non-paid founder clicks Export — the parent opens the upgrade flow (#69). */
  onExportUpgrade?: () => void
}) {
  const [tab, setTab] = useState<Tab>('all')
  const [docs, setDocs] = useState<DocumentSummary[]>([])
  const [counts, setCounts] = useState<Record<Tab, number>>({ all: 0, document: 0, report: 0 })
  const [loaded, setLoaded] = useState(false)
  const [viewing, setViewing] = useState<FullDocument | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  // Pitch-deck export (#69) — a PAID deliverable generated from the company's artifacts.
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // Document upload (#399) — a founder drops a real reference file (PDF/TXT/MD/
  // DOC/DOCX/CSV) into the workspace; Cody's own chat responses reference this
  // being possible, but no upload path existed until now.
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    let alive = true
    fetch(`/api/build/documents?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setDocs(Array.isArray(d?.documents) ? d.documents : [])
        if (d?.counts) setCounts({ all: d.counts.all || 0, document: d.counts.document || 0, report: d.counts.report || 0 })
        setLoaded(true)
      })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [companyId])

  // Hydrate on mount / company change — an honest empty library for a brand-new
  // company, the real accumulated docs otherwise. Never fabricated.
  useEffect(() => load(), [load])

  // VIEW — load the full document content on demand.
  //
  // Real bug: this used to fail SILENTLY. When the fetch 404'd (or returned a
  // shape without `document`), the code did nothing at all — `viewing` stayed
  // null, the loading spinner appeared then vanished, and the user was left with
  // no dialog, no error, no feedback whatsoever. Clicking VIEW looked exactly
  // like "does nothing" because, from the user's side, it WAS doing nothing
  // visible on failure. Every failure path now sets a real, visible error.
  const view = async (id: string) => {
    setViewLoading(true)
    setViewing(null)
    setViewError(null)
    try {
      const res = await fetch(`/api/build/documents?companyId=${encodeURIComponent(companyId)}&id=${encodeURIComponent(id)}`)
      const d = await res.json().catch(() => null)
      if (res.ok && d?.document) {
        setViewing(d.document as FullDocument)
      } else if (res.status === 404) {
        setViewError('That document could not be found — it may have been removed.')
      } else {
        setViewError('Could not load that document — try again shortly.')
      }
    } catch {
      setViewError('Connection hiccup — try viewing that document again.')
    } finally {
      setViewLoading(false)
    }
  }

  // Generate one durable starter document from the company idea (quality-bar
  // structured markdown), then refresh the library.
  const generate = async (type: string) => {
    setGenError(null)
    setGenerating(type)
    try {
      const res = await fetch('/api/build/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, generate: true, type, idea, companyName, track }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.document) {
        setGenError(d?.error === 'generation_unavailable'
          ? 'Generation is unavailable right now — try again shortly.'
          : d?.error || 'Could not generate that document.')
        return
      }
      load()
    } catch {
      setGenError('Connection hiccup — try generating again.')
    } finally {
      setGenerating(null)
    }
  }

  // Upload a reference document (#399) — POST the real file bytes, then refresh
  // the library so the upload appears next to Cody's generated docs.
  const uploadDocument = async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('companyId', companyId)
      const res = await fetch('/api/build/documents/upload', { method: 'POST', body: form })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        setUploadError(d?.message || d?.error || 'Could not upload that file.')
        return
      }
      load()
    } catch {
      setUploadError('Connection hiccup — try uploading again.')
    } finally {
      setUploading(false)
    }
  }

  // Export the founder pitch deck (#69) — POST the company + brand, receive a real
  // .pptx file, and trigger a browser download. Paid-gated: a non-paid founder is
  // routed to the upgrade flow instead (the server also enforces the gate → 402).
  const exportDeck = async () => {
    if (!canExportDeck) {
      onExportUpgrade?.()
      return
    }
    setExportError(null)
    setExporting(true)
    try {
      const res = await fetch('/api/build/deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          idea,
          companyName,
          tagline: brandTagline,
          color: brandColor,
          track,
          format: 'pptx',
        }),
      })
      if (res.status === 402) {
        setExportError('Pitch-deck export is a paid deliverable.')
        onExportUpgrade?.()
        return
      }
      if (!res.ok) {
        setExportError('Could not export the deck right now — try again shortly.')
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const nameMatch = cd.match(/filename="([^"]+)"/)
      const fileName = nameMatch?.[1] || 'pitch-deck.pptx'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('Connection hiccup — try exporting again.')
    } finally {
      setExporting(false)
    }
  }

  // Which starter docs have not been generated yet (by type), for the empty/build state.
  const existingTypes = new Set(docs.map((d) => d.type))
  const missingStarters = STARTER_DOCS.filter((s) => !existingTypes.has(s.type))

  const visible = tab === 'all' ? docs : docs.filter((d) => d.kind === tab)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'document', label: 'Documents' },
    { key: 'report', label: 'Reports' },
  ]

  return (
    <div className="m-live-card" data-testid="documents-panel">
      <div className="m-mono m-live-card-h">
        <span className="m-glyph">◇</span> Documents
      </div>

      {/* Export founder pitch deck (#69) — a PAID deliverable composed from the
          company's artifacts (thesis, roadmap, mission, market) into a standard-VC,
          on-brand .pptx. Non-paid founders see an "Upgrade to export" affordance. */}
      <div className="m-infra-btns" data-testid="deck-export">
        <button
          className="btn-secondary"
          data-testid="deck-export-btn"
          disabled={exporting}
          aria-label={canExportDeck ? 'Export pitch deck' : 'Upgrade to export pitch deck'}
          onClick={exportDeck}
        >
          {exporting
            ? 'Building deck…'
            : canExportDeck
              ? 'Export pitch deck'
              : 'Export pitch deck (paid)'}
        </button>
        {!canExportDeck && (
          <span className="m-mono m-task-meta" data-testid="deck-export-locked">
            Paid — a slick VC deck from your company.
          </span>
        )}
      </div>
      {exportError && (
        <p className="m-mono m-ver-status is-error" data-testid="deck-export-error">{exportError}</p>
      )}

      {/* Upload a reference document (#399) — the real capability behind Cody's
          own chat references to dropping docs into the workspace. */}
      <div className="m-infra-btns" data-testid="document-upload">
        <input
          ref={fileInputRef}
          type="file"
          accept={DOCUMENT_UPLOAD_ACCEPT_ATTR}
          style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
          data-testid="document-upload-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void uploadDocument(file)
          }}
        />
        <button
          className="btn-secondary"
          data-testid="document-upload-btn"
          disabled={uploading}
          aria-label="Upload a reference document"
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload a document'}
        </button>
      </div>
      {uploadError && (
        <p className="m-mono m-ver-status is-error" data-testid="document-upload-error">{uploadError}</p>
      )}

      {/* Documents vs Reports tabs (#64 req 2). */}
      <div className="m-doc-tabs" data-testid="documents-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`m-chip m-doc-tab${tab === t.key ? ' is-active' : ''}`}
            data-testid={`documents-tab-${t.key}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="m-doc-tab-count">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {genError && (
        <p className="m-mono m-ver-status is-error" data-testid="documents-gen-error">{genError}</p>
      )}

      {/* Body: loading → honest empty / list. */}
      {!loaded ? (
        <p className="m-mono m-task-empty" data-testid="documents-loading">loading documents…</p>
      ) : visible.length === 0 ? (
        <div data-testid="documents-empty">
          <p className="m-mono m-task-empty">
            {tab === 'report'
              ? `No reports yet. Each night Cody appends a dated operational report for ${companyName || 'your company'} — what the swarm did, metrics, and next actions.`
              : `No documents yet. As ${companyName || 'your company'} evolves, Cody builds a library — Research, Product Roadmap, Mission and Market Research — each grounded in your idea.`}
          </p>
          {/* Offer to generate the durable starter docs (never auto-faked). */}
          {tab !== 'report' && missingStarters.length > 0 && idea && (
            <div className="m-infra-btns" data-testid="documents-generate">
              {missingStarters.map((s) => (
                <button
                  key={s.type}
                  className="btn-secondary"
                  data-testid={`documents-generate-${s.type}`}
                  disabled={generating != null}
                  onClick={() => generate(s.type)}
                >
                  {generating === s.type ? 'Generating…' : `Generate ${s.label}`}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <ul className="m-task-list" data-testid="documents-list">
            {visible.map((d) => (
              <li key={d.id} className="m-task-card" data-testid="document-card" data-kind={d.kind} data-type={d.type}>
                <div className="m-task-card-top">
                  <span className={`st ${d.kind === 'report' ? 'is-running' : 'is-done'}`} data-testid="document-kind-badge">
                    {d.kind === 'report' ? 'REPORT' : 'DOC'}
                  </span>
                  <span className="m-chip m-doc-type" data-testid="document-type">{d.typeLabel}</span>
                </div>
                <p className="m-task-title" data-testid="document-title">{d.title}</p>
                <div className="m-task-card-foot m-mono">
                  <span className="m-task-meta" data-testid="document-date">{fmtDate(d.createdAt)}</span>
                  <button
                    className="btn-ghost m-task-view"
                    data-testid="document-view"
                    onClick={() => view(d.id)}
                  >
                    VIEW →
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {/* Generate any still-missing starter docs from below the list too. */}
          {tab !== 'report' && missingStarters.length > 0 && idea && (
            <div className="m-infra-btns" data-testid="documents-generate-more">
              {missingStarters.map((s) => (
                <button
                  key={s.type}
                  className="btn-secondary"
                  data-testid={`documents-generate-${s.type}`}
                  disabled={generating != null}
                  onClick={() => generate(s.type)}
                >
                  {generating === s.type ? 'Generating…' : `Generate ${s.label}`}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* VIEW failure — a real, visible error instead of the click silently doing
          nothing (the exact "View goes nowhere" bug report). */}
      {viewError && !viewing && !viewLoading && (
        <p className="m-mono m-ver-status is-error" data-testid="document-view-error">
          {viewError}{' '}
          <button className="btn-ghost" data-testid="document-view-error-dismiss" onClick={() => setViewError(null)}>
            dismiss
          </button>
        </p>
      )}

      {/* VIEW — full structured markdown, rendered in-app (#64 req 5). */}
      {(viewing || viewLoading) && (
        <div className="m-task-detail" role="dialog" aria-label="Document" data-testid="document-detail">
          <div className="m-task-detail-head">
            <span className="st is-done">{viewing?.typeLabel || 'Document'}</span>
            <button
              className="btn-ghost m-task-detail-close"
              data-testid="document-detail-close"
              onClick={() => setViewing(null)}
            >
              close ✕
            </button>
          </div>
          {viewLoading ? (
            <p className="m-mono m-task-empty">loading…</p>
          ) : viewing ? (
            <div className="m-doc-body" data-testid="document-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{viewing.content}</ReactMarkdown>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
