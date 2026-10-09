'use client'

/**
 * Cody chat panel (#BLD-06.1) — the persistent right-hand panel replacing
 * the old Artifacts rail drawer. BLD-06.1 shipped the panel SHELL only,
 * with a visible-but-permanently-disabled text input as an honest
 * placeholder for a guided conversation that didn't exist yet.
 *
 * BLD-06.2 through BLD-06.9 (and #987) then shipped that guided
 * conversation for real: per-step summaries, tap-to-answer + free-text
 * Q&A that drives a real regenerate, save/version history, and the
 * explain-before-build gate. The founder's real way to talk to Cody about
 * the CURRENT artifact is this panel's Q&A block below (for the views with
 * a question set) plus ArtifactFrame's "What should change?" feedback box
 * (every view, once the artifact has content) — both call the same
 * /api/build/artifact feedback mechanism. The original disabled input was
 * leftover BLD-06.1 scaffolding nothing ever retired once those real paths
 * shipped; removed rather than left as a dead affordance that visually
 * promised a chat box that could never work.
 */

import { useEffect, useRef, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { getQuestionsForView, composeFeedbackFromAnswers } from '@/lib/build/cody-questions'
import { collectPrior } from '@/lib/build/artifact-edit'

// #BLD-06.9 — the real build-stage views (confirmed APP_VIEWS entries) this
// gate covers. Never the same views BLD-06.2's lighter per-step summary
// targets — the two must not collide.
const BUILD_STAGE_VIEWS = ['swarm', 'infra', 'preview']

export function CodyChatPanel() {
  const { state, views, dispatch } = useBuild()
  // #BLD-06.3 — per-step Q&A answers, component state only (not persisted —
  // the regenerate call is the durable side effect once submitted).
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [regenerating, setRegenerating] = useState(false)
  const questions = getQuestionsForView(state.view)

  // #BLD-06.9 — explain before building, reusing the SAME nudgeState/NUDGE
  // state this codebase already uses for CodyNudge's accept/dismiss pattern,
  // keyed by view, so an accepted gate never reappears for that view.
  const isBuildStage = BUILD_STAGE_VIEWS.includes(state.view)
  const explainAccepted = state.nudgeState?.[state.view] === 'accepted'
  const [explanation, setExplanation] = useState<string | null>(null)
  useEffect(() => {
    if (!isBuildStage || explainAccepted) { setExplanation(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/build/cody-explain', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view: state.view, track: state.track, idea: state.idea }),
        })
        const d = await res.json().catch(() => null)
        if (!cancelled && d?.ok && d?.explanation) setExplanation(d.explanation)
      } catch { /* no gate text if the call fails — never blocks autoplay silently stuck */ }
    })()
    return () => { cancelled = true }
  }, [state.view, isBuildStage, explainAccepted, state.track, state.idea])

  const submitAnswers = async () => {
    const feedback = composeFeedbackFromAnswers(questions, answers)
    setAnswers({})
    if (!feedback) return
    setRegenerating(true)
    try {
      const res = await fetch('/api/build/artifact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          view: state.view,
          idea: state.idea,
          track: state.track,
          companyName: state.companyName || undefined,
          prior: collectPrior(views, state.generated, state.view),
          feedback,
          companyId: state.appChatId || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.content) {
        dispatch({ type: 'GEN_DONE', view: state.view, content: data.content })
      } else {
        dispatch({ type: 'GEN_FAIL', view: state.view, error: data?.error || `HTTP ${res.status}` })
      }
    } catch (e: unknown) {
      dispatch({ type: 'GEN_FAIL', view: state.view, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setRegenerating(false)
    }
  }
  // #BLD-06.4 — save/version tracking. isDraftUnsaved flips true whenever
  // this view's generated content changes after the last save; never blocks
  // navigation — Cody only ASKS, per the story's own scenario.
  const lastSavedContent = useRef<Record<string, unknown>>({})
  const [isDraftUnsaved, setIsDraftUnsaved] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const current = state.generated?.[state.view]
    const saved = lastSavedContent.current[state.view]
    setIsDraftUnsaved(current !== undefined && current !== saved)
  }, [state.view, state.generated])

  const saveVersion = async () => {
    setSaving(true)
    try {
      await fetch('/api/build/artifact-version', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: state.appChatId, view: state.view, content: state.generated?.[state.view] }),
      })
      lastSavedContent.current[state.view] = state.generated?.[state.view]
      setIsDraftUnsaved(false)
    } catch { /* best-effort — the live artifact itself is unaffected */ }
    finally { setSaving(false) }
  }

  // #BLD-06.2 — real, LLM-generated step summaries, cached per-view for this
  // component's lifetime only (no persistence — a reload re-summarizing is
  // cheap and avoids a new persistence surface for throwaway text).
  const summaryCache = useRef<Map<string, string>>(new Map())
  const [summary, setSummary] = useState<string | null>(summaryCache.current.get(state.view) || null)

  useEffect(() => {
    const cached = summaryCache.current.get(state.view)
    if (cached) { setSummary(cached); return }
    setSummary(null)
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/build/cody-summary', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view: state.view, track: state.track, content: state.generated?.[state.view] }),
        })
        const d = await res.json().catch(() => null)
        if (!cancelled && d?.ok && d?.summary) {
          summaryCache.current.set(state.view, d.summary)
          setSummary(d.summary)
        }
      } catch { /* keep the static fallback line — never block the panel on this */ }
    })()
    return () => { cancelled = true }
  }, [state.view, state.track, state.generated])

  return (
    <div className="m-cody-chat-panel" data-testid="cody-chat-panel" aria-label="Cody chat">
      <div className="m-cody-chat-header m-mono">
        <span className="m-glyph">◇</span> Cody
      </div>
      <div className="m-cody-chat-log">
        <p className="m-cody-chat-line">
          {summary || (<>You&apos;re on <span className="m-mono">{state.view}</span>.</>)}
        </p>
        {isBuildStage && !explainAccepted && explanation && (
          <div className="m-cody-explain-gate" data-testid="cody-explain-gate">
            <p className="m-cody-chat-line">{explanation}</p>
            <button
              type="button"
              data-testid="cody-explain-go-ahead"
              className="btn-primary"
              onClick={() => dispatch({ type: 'NUDGE', view: state.view, state: 'accepted' })}
            >
              Go ahead
            </button>
          </div>
        )}
        {state.generated?.[state.view] !== undefined && (
          <div className="m-cody-save-row">
            {isDraftUnsaved && (
              <p className="m-cody-chat-line m-muted" data-testid="cody-unsaved-draft-note">
                Save this version, or keep the last saved one?
              </p>
            )}
            <button
              type="button"
              data-testid="cody-save-version"
              className="btn-ghost"
              disabled={saving}
              onClick={saveVersion}
            >
              {saving ? 'Saving…' : 'Save this'}
            </button>
          </div>
        )}
      </div>
      {questions.length > 0 && (
        <div className="m-cody-questions" data-testid="cody-questions">
          {questions.map((q) => (
            <div key={q.id} className="m-cody-question">
              <p className="m-cody-question-text">{q.text}</p>
              <div className="m-cody-question-suggestions">
                {q.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-testid="cody-question-suggestion"
                    className={`btn-ghost m-cody-suggestion ${answers[q.id] === s ? 'is-selected' : ''}`}
                    disabled={regenerating}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: s }))}
                  >
                    {s}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="cody-question-not-sure"
                  className={`btn-ghost m-cody-suggestion ${answers[q.id] === 'Not sure yet' ? 'is-selected' : ''}`}
                  disabled={regenerating}
                  onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: 'Not sure yet' }))}
                >
                  Not sure yet
                </button>
              </div>
              <input
                type="text"
                className="m-cody-question-freetext"
                placeholder="Or type your own answer…"
                value={answers[q.id] && !q.suggestions.includes(answers[q.id]) && answers[q.id] !== 'Not sure yet' ? answers[q.id] : ''}
                disabled={regenerating}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              />
            </div>
          ))}
          <div className="m-cody-questions-actions">
            <button
              type="button"
              data-testid="cody-questions-keep"
              className="btn-ghost"
              disabled={regenerating}
              onClick={() => setAnswers({})}
            >
              Keep as is
            </button>
            <button
              type="button"
              data-testid="cody-questions-submit"
              className="btn-primary"
              disabled={regenerating}
              onClick={submitAnswers}
            >
              {regenerating ? 'Revising…' : 'Update from my answers'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
