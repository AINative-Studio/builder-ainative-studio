'use client'

/**
 * Generic artifact frame (#220) — H1 + status pill + meta scaffold every
 * artifact screen shares. Rich per-artifact bodies (#223/#224/#225) render as
 * children; this provides the consistent chrome + Next/keep-going controls.
 *
 * #283: SHARED_LATE_VIEWS ('conflict', 'graph', 'rescope-intent') are not in
 * the navigable track sequence (COMPANY_VIEWS / APP_VIEWS), so the generic
 * prev/next pager is always empty for them. Replace the dead pager with
 * explicit escape CTAs so no screen can trap the user.
 *
 * GR-16 (#329): every GENERATED artifact is reviewable — a Regenerate action
 * (with an optional "What should change?" feedback box, appended to the
 * generation prompt) and an inline Edit action (textarea over the raw content,
 * Save updates the generated map and persists via the same #284 mechanism).
 * Pure logic lives in lib/build/artifact-edit.ts.
 */

import { useBuild } from '@/contexts/build-context'
import { SHARED_LATE_VIEWS } from '@/lib/build/state'
import { collectPrior, serializeArtifact, applyEdit } from '@/lib/build/artifact-edit'
import { CompanyNameEdit } from '@/components/build/CompanyNameEdit'
import { useState, type ReactNode } from 'react'

/** Stable artifact IDs per 04-SCREENS (PB-01, PRD-01, …). */
const ARTIFACT_ID: Record<string, string> = {
  brief: 'PB-01', prd: 'PRD-01', comp: 'CP-01', dataModel: 'DM-01', memoryPolicy: 'MP-01',
  agentDef: 'AD-01', codingStandards: 'ES-01', apiSpec: 'API-01', backlog: 'BL-01', sprintPlan: 'SPR-01', swarm: 'SW-01', infra: 'IN-01', preview: 'PV-01',
  thesis: 'VT-01', wedge: 'WD-01', businessModel: 'BM-01', positioning: 'POS-01', landing: 'LP-01', plan30: 'OP-01',
  pipeline: 'SP-01', 'rescope-intent': 'RI-01', conflict: 'CF-01', graph: 'GR-01',
}

function statusClass(status: string): string {
  if (/build|run|generat|accret/i.test(status)) return 'is-running'
  if (/need|input/i.test(status)) return 'is-needs'
  if (/done|approv|connect|ship|deploy|provision|live|ready|assigned|edited/i.test(status)) return 'is-done'
  return ''
}

/** Returns true when `view` lives in SHARED_LATE_VIEWS and is not part of the
 *  track sequence — these views need explicit CTA nav instead of the pager. */
function isSharedLateView(view: string): boolean {
  return (SHARED_LATE_VIEWS as readonly string[]).includes(view)
}

export function ArtifactFrame({
  title, status, view, meta, children,
}: {
  title: string
  status: string
  view: string
  meta?: string
  children?: ReactNode
}) {
  const { state, views, goView, dispatch } = useBuild()
  const idx = views.indexOf(view)
  const next = idx >= 0 && idx < views.length - 1 ? views[idx + 1] : null
  const prev = idx > 0 ? views[idx - 1] : null

  const artifactId = ARTIFACT_ID[view]
  const isLate = isSharedLateView(view)
  const companyLabel = state.companyName || 'company'

  // ── Per-artifact review actions (GR-16 #329) ──────────────────────────────
  // Shown on every artifact that has GENERATED content (prose views after
  // GEN_DONE). Build views (swarm/infra/preview) and late shared views have no
  // generated text, so they get no actions.
  const genContent = state.generated[view]
  const hasGen = genContent !== undefined && genContent !== null && !isLate
  const [mode, setMode] = useState<'none' | 'feedback' | 'edit'>('none')
  const [feedback, setFeedback] = useState('')
  const [draft, setDraft] = useState('')
  const [editError, setEditError] = useState('')
  const [regenerating, setRegenerating] = useState(false)

  // Re-run generation for THIS view only, with the founder's feedback appended
  // to the generation prompt (server side). Shows the existing forming overlay;
  // success replaces the content via GEN_DONE, failure surfaces via GEN_FAIL.
  const runRegenerate = async () => {
    if (regenerating || !state.idea) return
    const fb = feedback.trim()
    setMode('none')
    setRegenerating(true)
    dispatch({ type: 'SET_OVERLAY', overlay: { kind: 'forming', view } })
    try {
      const res = await fetch('/api/build/artifact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          view,
          idea: state.idea,
          track: state.track,
          companyName: state.companyName || undefined,
          prior: collectPrior(views, state.generated, view),
          feedback: fb || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.content) {
        dispatch({ type: 'GEN_DONE', view, content: data.content })
        setFeedback('')
      } else {
        dispatch({ type: 'GEN_FAIL', view, error: data?.error || `HTTP ${res.status}` })
      }
    } catch (e: unknown) {
      dispatch({ type: 'GEN_FAIL', view, error: e instanceof Error ? e.message : String(e) })
    } finally {
      dispatch({ type: 'SET_OVERLAY', overlay: { kind: 'none' } })
      setRegenerating(false)
    }
  }

  const startEdit = () => {
    setDraft(serializeArtifact(genContent))
    setEditError('')
    setMode('edit')
  }

  const saveEdit = () => {
    const result = applyEdit(genContent, draft)
    if (!result.ok) {
      setEditError(result.error)
      return
    }
    // EDIT_ARTIFACT updates state.generated, which the build-context #284
    // effect persists to localStorage under the company slug automatically.
    dispatch({ type: 'EDIT_ARTIFACT', view, content: result.content })
    setMode('none')
    setEditError('')
  }

  // For SHARED_LATE_VIEWS: after conflict is resolved the forward CTA is the
  // graph. For the graph itself the forward CTA returns to Live. This keeps
  // every late view's forward/back chain explicit and never dead (#283).
  const lateBack = () => {
    if (view === 'graph' || view === 'conflict') {
      dispatch({ type: 'GOTO_SCREEN', screen: 'live' })
    } else {
      // 'rescope-intent' or 'pipeline' — go to the last track view
      goView(views[views.length - 1] as never)
    }
  }
  const lateDone = () => {
    if (view === 'conflict' && state.conflictResolved) {
      goView('graph' as never)
    } else {
      dispatch({ type: 'GOTO_SCREEN', screen: 'live' })
    }
  }

  return (
    <article className="m-artifact-frame">
      <div className="m-artifact-status">
        <span className={`st ${statusClass(status)}`}>{status}</span>
        {artifactId && <span className="m-artifact-id m-mono">{artifactId}</span>}
      </div>
      <h1 className="m-artifact m-artifact-h1">{title}</h1>
      {/* #396: editable company name, Company-track only (App-track has no
          wedge/naming concept — APP_VIEWS never includes 'wedge'). Rendered
          on every Company-track artifact from thesis onward — the wedge
          interrupt itself is a full-bleed takeover with no frame chrome, so
          it can't render DURING wedge, but this satisfies "before that
          step" (thesis) and "after" (businessModel onward). Regenerate is
          plan30-only per the issue's exact ask. */}
      {state.track === 'company' && !isLate && (
        <CompanyNameEdit
          companyName={state.companyName}
          idea={state.idea}
          track={state.track}
          showRegenerate={view === 'plan30'}
          onChange={(name) => dispatch({ type: 'SET_COMPANY_NAME', companyName: name })}
          chatId={state.appChatId}
        />
      )}
      {(meta || hasGen) && (
        <div className="m-artifact-meta-row">
          {meta && <p className="m-artifact-meta m-mono">{meta}</p>}
          {hasGen && (
            <div className="m-artifact-actions">
              <button
                className="btn-ghost m-artifact-action"
                disabled={regenerating}
                onClick={() => setMode(mode === 'feedback' ? 'none' : 'feedback')}
              >
                Regenerate
              </button>
              <button
                className="btn-ghost m-artifact-action"
                disabled={regenerating}
                onClick={() => (mode === 'edit' ? setMode('none') : startEdit())}
              >
                {mode === 'edit' ? 'Cancel edit' : 'Edit'}
              </button>
            </div>
          )}
        </div>
      )}
      {mode === 'feedback' && hasGen && (
        <div className="m-artifact-feedback">
          <label className="m-field-l" htmlFor={`m-feedback-${view}`}>What should change?</label>
          <textarea
            id={`m-feedback-${view}`}
            className="m-artifact-textarea"
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional — leave blank and I take a fresh pass."
          />
          <div className="m-artifact-action-cta">
            <button className="btn-secondary" disabled={regenerating} onClick={runRegenerate}>
              Regenerate →
            </button>
            <button className="btn-ghost" disabled={regenerating} onClick={() => setMode('none')}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="m-artifact-body">
        {mode === 'edit' && hasGen ? (
          <div className="m-artifact-edit">
            <textarea
              className="m-artifact-textarea is-edit"
              rows={16}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`Edit ${title}`}
            />
            {editError && <p className="m-field-err m-mono">{editError}</p>}
            <div className="m-artifact-action-cta">
              <button className="btn-secondary" onClick={saveEdit}>Save →</button>
              <button className="btn-ghost" onClick={() => { setMode('none'); setEditError('') }}>Cancel</button>
            </div>
          </div>
        ) : (
          children ?? <p className="m-sub">Cody is composing this artifact from AINative primitives.</p>
        )}
      </div>

      {/* SHARED_LATE_VIEWS: replace the generic pager with explicit escape CTAs
          so the user is never trapped on conflict / graph / rescope-intent (#283). */}
      {isLate ? (
        <div className="m-artifact-nav">
          <button className="btn-ghost" onClick={lateBack}>
            ‹ Back to {companyLabel}
          </button>
          {view === 'conflict' && !state.conflictResolved ? null : (
            <button className="btn-secondary" onClick={lateDone}>
              {view === 'conflict' && state.conflictResolved ? 'See the graph →' : 'Done →'}
            </button>
          )}
        </div>
      ) : !state.auto ? (
        <div className="m-artifact-nav">
          <button className="btn-ghost" disabled={!prev} onClick={() => prev && goView(prev as never)}>‹ Back</button>
          {/* On the LAST artifact (e.g. preview) there is no next artifact, so the
              pager 'Next' used to be a disabled dead-end — users clicked it and
              nothing happened. Instead, advance to the pricing/pay-gate (the real
              forward path, same as the 'Make it real →' CTA) so Next is never dead. */}
          {next ? (
            <button className="btn-secondary" onClick={() => goView(next as never)}>Next ›</button>
          ) : (
            /* Forward-to-pricing only AFTER the founder has actually seen the
               rendered preview (sawPreview) — navigating away mid-generation
               unmounts Preview and aborts the in-flight app build. */
            <button
              className="btn-secondary"
              disabled={!state.sawPreview}
              title={state.sawPreview ? undefined : 'Your app preview is still building'}
              onClick={() => state.sawPreview && dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}
            >Next ›</button>
          )}
        </div>
      ) : (
        <div className="m-artifact-nav">
          <button className="btn-ghost" onClick={() => dispatch({ type: 'TAKE_THE_WHEEL' })}>Take the wheel</button>
        </div>
      )}
    </article>
  )
}
