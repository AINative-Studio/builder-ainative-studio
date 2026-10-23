'use client'

/**
 * Kickoff questions (#E3.2/#E3.3) — inserted between Intake's brand-naming
 * step and the real START_BUILD/DEFER_BUILD decision. One question per
 * message, tap-to-answer suggestions plus free text plus "Not sure yet" on
 * every question, matching the backlog doc's exact UI contract. Answering
 * (or skipping) all 3 always proceeds to generation — kickoff is never a
 * hard gate.
 *
 * #1196 — "coach" team recommendation. After the 3rd question, a free Cody
 * turn recommends a small starting agent team (recommendTeam(), reusing the
 * SAME idea→primitive scoring selectPrimitives() already drives for codegen
 * and "Powering this" — so the advice and what actually gets built can never
 * diverge) before the real auth-wall/credits/START_BUILD decision in
 * proceed(). Purely a chat turn with one CTA: no new paywall, no LLM call.
 * "Add more agents" routes to the EXISTING pricing screen — the real paid-
 * tier gate this repo already has, not a second parallel one. An idea that
 * matches no team-eligible primitive shows no coach turn at all and proceeds
 * straight through, so kickoff is never a dead end.
 *
 * #1306 — a growth-intent founder's last kickoff question (site-url) is
 * answered with a real URL: a light, honest fetch+parse pass
 * (lib/build/site-assessment.ts) runs and its summary is shown back to the
 * founder right here, before moving on. A failed fetch shows a clear, honest
 * message — never a silent crash or a faked "all good".
 *
 * #1311 — after the main questions (and any site assessment), 5 short
 * founder-type questions classify the founder's working style
 * (lib/build/founder-type.ts, a deterministic mapping — no LLM call). The
 * one bounded behavioral hook: an 'architect' classification shows one
 * extra review/confirm step before the real build decision in proceed();
 * 'hustler'/'operator' skip straight through.
 *
 * Phase order: main questions -> site assessment (growth only, if answered)
 * -> founder-type questions -> architect review (architect only) -> coach
 * team turn -> proceed().
 */

import { useState } from 'react'
import { useSession, getSession } from 'next-auth/react'
import { useBuild } from '@/contexts/build-context'
import { trackEvent } from '@/components/analytics/google-analytics'
import { decideLimitAction } from '@/lib/build/value-moment'
import { getKickoffQuestions, SITE_URL_QUESTION_ID } from '@/lib/build/kickoff-questions'
import { getOrCreateAnonDraftToken } from '@/lib/build/anon-draft-token'
import { recommendTeam, type RecommendedTeamMember } from '@/lib/build/primitive-catalog'
import { fetchAndAssessSite } from '@/lib/build/site-assessment'
import { FOUNDER_TYPE_QUESTIONS, classifyFounderType, type FounderTypeAnswers } from '@/lib/build/founder-type'

const NOT_SURE = 'Not sure yet'

type Phase = 'questions' | 'founder-type' | 'founder-review' | 'coach'

export function KickoffQuestions() {
  const { state, dispatch } = useBuild()
  const { status: sessionStatus } = useSession()
  const [index, setIndex] = useState(0)
  const [freeText, setFreeText] = useState('')
  const [proceeding, setProceeding] = useState(false)
  // #1196 — null = coach turn not reached yet; [] = reached but nothing to
  // recommend (skip straight through); non-empty = show the coach turn.
  const [team, setTeam] = useState<RecommendedTeamMember[] | null>(null)
  const questions = getKickoffQuestions(state.track, state.growthIntent ?? false, state.ecommerceIntent ?? false)
  const question = questions[index]

  // #1306 — honest, founder-facing summary line of the last assessment
  // attempt (success or failure). '' = nothing to show yet.
  const [siteAssessmentLine, setSiteAssessmentLine] = useState('')
  const [assessingSite, setAssessingSite] = useState(false)

  // #1311 — phase state machine driving what's shown after the main
  // questions are done.
  const [phase, setPhase] = useState<Phase>('questions')
  const [founderTypeIndex, setFounderTypeIndex] = useState(0)
  const [founderTypeAnswers, setFounderTypeAnswers] = useState<FounderTypeAnswers>({})

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

    const advance = () => {
      if (index < questions.length - 1) {
        setIndex(index + 1)
      } else {
        // #1311 — move to the founder-type phase instead of going straight
        // to the coach/proceed decision.
        setPhase('founder-type')
      }
    }

    // #1306 — a real URL was given for the existing-site question: run the
    // light fetch+assess pass and show the honest result BEFORE moving on
    // (so the founder sees the result on the question screen, not a blank
    // flash through to the next phase). Skipping ("Not sure yet" -> trimmed
    // undefined) never attempts a fetch and advances immediately.
    if (question.id === SITE_URL_QUESTION_ID && trimmed) {
      setAssessingSite(true)
      fetchAndAssessSite(trimmed).then((result) => {
        setAssessingSite(false)
        if (result.ok) {
          dispatch({ type: 'SET_SITE_ASSESSMENT', url: trimmed, assessment: result.assessment })
          setSiteAssessmentLine(result.assessment.summary)
        } else {
          dispatch({ type: 'SITE_ASSESSMENT_FAIL', url: trimmed, error: result.error })
          setSiteAssessmentLine(result.error)
        }
      })
      return
    }

    advance()
  }

  // #1306 — once the site-assessment result is shown, the founder taps
  // through to continue (mirrors every other kickoff question's own
  // explicit "move on" action rather than auto-advancing out from under
  // them while they're still reading the summary).
  const continueAfterSiteAssessment = () => {
    setSiteAssessmentLine('')
    if (index < questions.length - 1) {
      setIndex(index + 1)
    } else {
      setPhase('founder-type')
    }
  }

  // #1311 — one founder-type question answered: record it, advance, or (on
  // the last one) classify and either show the architect review step or go
  // straight on to the coach/proceed decision.
  const answerFounderType = (value: 'architect' | 'hustler' | 'operator') => {
    const q = FOUNDER_TYPE_QUESTIONS[founderTypeIndex]
    const next = { ...founderTypeAnswers, [q.id]: value }
    setFounderTypeAnswers(next)
    if (founderTypeIndex < FOUNDER_TYPE_QUESTIONS.length - 1) {
      setFounderTypeIndex(founderTypeIndex + 1)
      return
    }
    const classification = classifyFounderType(next)
    dispatch({ type: 'SET_FOUNDER_TYPE', founderType: classification })
    if (classification === 'architect') {
      setPhase('founder-review')
    } else {
      goToCoachOrProceed()
    }
  }

  // #1311 — the architect founder confirmed the extra review step; clear the
  // pending flag and continue exactly like any other classification would.
  const confirmFounderReview = () => {
    dispatch({ type: 'CLEAR_FOUNDER_REVIEW' })
    goToCoachOrProceed()
  }

  // #1196 — shared tail of the flow: show the coach recommendation if the
  // idea matches a team-eligible primitive, otherwise go straight to
  // proceed(). Deterministic, no network/LLM call — safe to compute inline.
  const goToCoachOrProceed = () => {
    const recommended = recommendTeam(state.idea, state.track, state.role || undefined)
    if (recommended.length > 0) {
      setTeam(recommended)
      setPhase('coach')
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

  // #1196 — the coach turn: shown once, after the real kickoff + founder-type
  // questions, before proceed(). "Looks good, build it" is the SAME
  // proceed() the no-recommendation path already calls — the coach adds a
  // chat turn, not a new decision branch. "Add more agents" routes to the
  // existing pricing screen (the real paid-tier gate) rather than inventing
  // a second one.
  if (phase === 'coach' && team && team.length > 0) {
    return (
      <div className="modernist m-intake" data-track={state.track} data-testid="kickoff-coach">
        <div className="m-chat-log">
          <p className="m-chat-cody"><span className="m-glyph">◇</span> Cody · your co-founder</p>
          <p className="m-chat-cody-turn" data-testid="kickoff-coach-intro">
            Based on what you've told me, here's a starting team — free to try, grow it whenever you're ready:
          </p>
        </div>
        <div className="m-kickoff-coach-team" data-testid="kickoff-coach-team">
          {team.map((member) => (
            <div key={member.primitive} className="m-kickoff-coach-member" data-testid="kickoff-coach-member">
              <p className="m-kickoff-coach-role"><strong>{member.role}</strong> — {member.primitive}</p>
              <p className="m-kickoff-coach-purpose">{member.purpose}</p>
            </div>
          ))}
        </div>
        <div className="m-kickoff-suggestions">
          <button
            type="button"
            data-testid="kickoff-coach-accept"
            className="btn-primary"
            disabled={proceeding}
            onClick={() => proceed()}
          >
            Looks good, build it →
          </button>
          <button
            type="button"
            data-testid="kickoff-coach-add-more"
            className="btn-ghost"
            disabled={proceeding}
            onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}
          >
            Add more agents to the team
          </button>
        </div>
      </div>
    )
  }

  // #1311 — the architect-only extra review step: a brief, honest recap
  // before the real build decision fires. One click continues exactly where
  // any other founder-type classification would (goToCoachOrProceed).
  if (phase === 'founder-review') {
    return (
      <div className="modernist m-intake" data-track={state.track} data-testid="founder-review-step">
        <div className="m-chat-log">
          <p className="m-chat-cody"><span className="m-glyph">◇</span> Cody · your co-founder</p>
          <p className="m-chat-cody-turn">
            You said you'd like to review things before I run with them — so before I start building,
            here's what I've got: <strong>{state.idea || 'your idea'}</strong>. Want me to go ahead?
          </p>
        </div>
        <div className="m-kickoff-suggestions">
          <button
            type="button"
            data-testid="founder-review-confirm"
            className="btn-primary"
            disabled={proceeding}
            onClick={() => confirmFounderReview()}
          >
            Yes, go ahead →
          </button>
        </div>
      </div>
    )
  }

  // #1311 — the 5 founder-type questions, shown after the main kickoff
  // questions. Single-choice (no free text / skip — this classification is
  // a quick multiple-choice, not an open question) via FOUNDER_TYPE_QUESTIONS.
  if (phase === 'founder-type') {
    const ftQuestion = FOUNDER_TYPE_QUESTIONS[founderTypeIndex]
    if (!ftQuestion) return null
    return (
      <div className="modernist m-intake" data-track={state.track} data-testid="founder-type-question">
        <div className="m-chat-log">
          <p className="m-chat-cody"><span className="m-glyph">◇</span> Cody · your co-founder</p>
          <p className="m-chat-cody-turn">{ftQuestion.text}</p>
        </div>
        <div className="m-kickoff-suggestions">
          {ftQuestion.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid="founder-type-option"
              data-value={opt.value}
              className="btn-ghost"
              disabled={proceeding}
              onClick={() => answerFounderType(opt.type)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (!question) return null

  // #1306 — the site-assessment result is showing: give the founder an
  // explicit way to continue instead of the normal question UI (there's
  // nothing left to answer on this question once a result/error is in).
  if (siteAssessmentLine) {
    return (
      <div className="modernist m-intake" data-track={state.track}>
        <div className="m-chat-log">
          <p className="m-chat-cody"><span className="m-glyph">◇</span> Cody · your co-founder</p>
          <p className="m-chat-cody-turn" data-testid="kickoff-site-assessment-result">{siteAssessmentLine}</p>
        </div>
        <div className="m-kickoff-suggestions">
          <button
            type="button"
            data-testid="kickoff-site-assessment-continue"
            className="btn-primary"
            onClick={() => continueAfterSiteAssessment()}
          >
            Continue →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="modernist m-intake" data-track={state.track}>
      <div className="m-chat-log">
        <p className="m-chat-cody"><span className="m-glyph">◇</span> Cody · your co-founder</p>
        <p className="m-chat-cody-turn">{question.text}</p>
      </div>
      {/* #1306 — "checking" placeholder shown while the fetch is in flight;
          the result itself renders via the early return above once ready. */}
      {assessingSite && (
        <p className="m-kickoff-site-assessment m-mono" data-testid="kickoff-site-assessing">
          Checking that site…
        </p>
      )}
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
      <p className="m-kickoff-not-sure-hint m-mono" data-testid="kickoff-not-sure-hint">
        Cody will infer a reasonable answer either way — skipping won&apos;t hurt your Product Brief.
      </p>
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
