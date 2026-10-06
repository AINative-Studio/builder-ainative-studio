'use client'

/**
 * Cody chat panel (#BLD-06.1) — the persistent right-hand panel replacing
 * the old Artifacts rail drawer. This story ships the panel SHELL only: a
 * real, visible, always-on chat surface that reacts to the current
 * artifact. The guided conversation itself (step summaries, Q&A, revise,
 * save/restore) is BLD-06.2 through BLD-06.4's scope, not this one's —
 * the input below is honestly disabled rather than wired to fake behavior
 * that doesn't exist yet.
 */

import { useEffect, useRef, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { getQuestionsForView, composeFeedbackFromAnswers } from '@/lib/build/cody-questions'
import { collectPrior } from '@/lib/build/artifact-edit'

export function CodyChatPanel() {
  const { state, views, dispatch } = useBuild()
  // #BLD-06.3 — per-step Q&A answers, component state only (not persisted —
  // the regenerate call is the durable side effect once submitted).
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [regenerating, setRegenerating] = useState(false)
  const questions = getQuestionsForView(state.view)

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
      <div className="m-cody-chat-input-row">
        <input
          className="m-cody-chat-input"
          data-testid="cody-chat-input"
          type="text"
          placeholder="Guided Q&A coming soon"
          disabled
        />
      </div>
    </div>
  )
}
