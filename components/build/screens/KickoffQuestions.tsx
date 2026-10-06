'use client'

/**
 * Kickoff questions (#E3.2/#E3.3) — inserted between Intake's brand-naming
 * step and the real START_BUILD/DEFER_BUILD decision. One question per
 * message, tap-to-answer suggestions plus free text plus "Not sure yet" on
 * every question, matching the backlog doc's exact UI contract. Answering
 * (or skipping) all 3 always proceeds to generation — kickoff is never a
 * hard gate.
 */

import { useState } from 'react'
import { useSession, getSession } from 'next-auth/react'
import { useBuild } from '@/contexts/build-context'
import { trackEvent } from '@/components/analytics/google-analytics'
import { decideLimitAction } from '@/lib/build/value-moment'
import { getKickoffQuestions } from '@/lib/build/kickoff-questions'
import { getOrCreateAnonDraftToken } from '@/lib/build/anon-draft-token'

const NOT_SURE = 'Not sure yet'

export function KickoffQuestions() {
  const { state, dispatch } = useBuild()
  const { status: sessionStatus } = useSession()
  const [index, setIndex] = useState(0)
  const [freeText, setFreeText] = useState('')
  const [proceeding, setProceeding] = useState(false)
  const questions = getKickoffQuestions(state.track, false)
  const question = questions[index]

  const answer = (value: string) => {
    const trimmed = value.trim() && value !== NOT_SURE ? value.trim() : undefined
    if (trimmed) {
      dispatch({ type: 'SET_ANSWER', key: question.id, value: trimmed })
    }
    trackEvent('kickoff_answered', 'funnel', state.track, undefined)
    setFreeText('')
    const nextStep = index < questions.length - 1 ? index + 1 : questions.length
    // #E3.4 — autosave the draft so an abandoned kickoff can be resumed.
    // Best-effort, fire-and-forget — never blocks the real UI flow.
    const token = getOrCreateAnonDraftToken()
    fetch('/api/build/anon-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token, idea: state.idea, track: state.track,
        answers: trimmed ? { ...state.answers, [question.id]: trimmed } : state.answers,
        step: `kickoff-${nextStep}`,
      }),
    }).catch(() => {})
    if (index < questions.length - 1) {
      setIndex(index + 1)
    } else {
      proceed()
    }
  }

  // Mirrors Intake.tsx's start() auth-wall + freemium decision exactly, now
  // running after kickoff instead of directly from idea submission.
  const proceed = async () => {
    if (proceeding) return
    setProceeding(true)
    let authed = sessionStatus === 'authenticated'
    if (!authed) {
      const s = await getSession().catch(() => null)
      authed = Boolean(s?.user)
    }
    if (!authed) {
      trackEvent('idea_gated_signup', 'funnel', state.track, undefined)
      dispatch({
        type: 'DEFER_BUILD', idea: state.idea,
        appSub: state.appSub, companyName: state.companyName,
        brandTagline: state.brandTagline, brandColor: state.brandColor,
      })
      return
    }

    let runwayNote = ''
    try {
      const res = await fetch('/api/build/credits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: state.appSub, idea: state.idea, track: state.track, role: state.role || undefined }),
      })
      if (res.status === 402) {
        trackEvent('build_limit_reached', 'funnel', state.track, undefined)
        if (decideLimitAction({ limitReached: true, sawPreview: state.sawPreview }) === 'pricing') {
          dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })
          setProceeding(false)
          return
        }
      }
      const d = await res.json().catch(() => null)
      if (typeof d?.ecosystem?.message === 'string') runwayNote = d.ecosystem.message
    } catch { /* fail open — proceed with the build */ }

    dispatch({
      type: 'START_BUILD', idea: state.idea,
      appSub: state.appSub, companyName: state.companyName,
      brandTagline: state.brandTagline, brandColor: state.brandColor,
    })
    dispatch({ type: 'SET_RUNWAY_NOTE', note: runwayNote })
  }

  if (!question) return null

  return (
    <div className="modernist m-intake" data-track={state.track}>
      <div className="m-chat-log">
        <p className="m-chat-cody"><span className="m-glyph">◇</span> Cody · your co-founder</p>
        <p className="m-chat-cody-turn">{question.text}</p>
      </div>
      <div className="m-kickoff-suggestions">
        {question.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            data-testid="kickoff-suggestion"
            className="btn-ghost"
            disabled={proceeding}
            onClick={() => answer(s)}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          data-testid="kickoff-not-sure"
          className="btn-ghost"
          disabled={proceeding}
          onClick={() => answer(NOT_SURE)}
        >
          {NOT_SURE}
        </button>
      </div>
      <div className="m-kickoff-freetext-row">
        <input
          type="text"
          placeholder="Or type your own answer…"
          value={freeText}
          disabled={proceeding}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && freeText.trim() && answer(freeText)}
        />
        <button
          type="button"
          data-testid="kickoff-submit-freetext"
          className="btn-primary"
          disabled={proceeding || !freeText.trim()}
          onClick={() => answer(freeText)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
