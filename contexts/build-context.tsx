'use client'

/**
 * Builder pivot — React context (#220). Wraps the reducer state machine and
 * exposes helpers (autoplay, woven counter, track views) to every workspace
 * screen. Ported from the prototype's logic layer.
 */

import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import {
  buildReducer, initialBuildState, trackViews, countWoven,
  type BuildState, type BuildAction, type ArtifactView, type Track,
  SHARED_LATE_VIEWS,
} from '@/lib/build/state'
import { PRIMITIVE_MAP, TOTAL_PRIMITIVES } from '@/lib/build/primitives'
import { useAutoplay } from '@/lib/build/useAutoplay'
import { trackEvent } from '@/components/analytics/google-analytics'
import { captureAttribution } from '@/lib/build/attribution'

interface BuildContextValue {
  state: BuildState
  dispatch: React.Dispatch<BuildAction>
  views: readonly string[]
  woven: number
  totalPrimitives: number
  goView: (view: ArtifactView) => void
  pickTrack: (track: Track) => void
}

const BuildContext = createContext<BuildContextValue | null>(null)

// localStorage key prefix for build state persistence (#284).
const LS_PREFIX = 'ainative_build_'

/** Fields we persist to localStorage for a given company slug. */
type PersistedBuildState = Pick<
  BuildState,
  'generated' | 'done' | 'genError' | 'builtCompany' | 'builtMVP'
  | 'wedgePicked' | 'answers' | 'companyName' | 'idea' | 'appSub'
  | 'brandTagline' | 'brandColor' | 'appChatId' | 'activePlan' | 'enrolled' | 'track'
>

function lsKey(slug: string) {
  return `${LS_PREFIX}${slug}`
}

function loadBuildState(slug: string): Partial<PersistedBuildState> | null {
  try {
    const raw = window.localStorage.getItem(lsKey(slug))
    if (!raw) return null
    return JSON.parse(raw) as Partial<PersistedBuildState>
  } catch {
    return null
  }
}

function saveBuildState(slug: string, state: BuildState) {
  try {
    const persisted: PersistedBuildState = {
      generated: state.generated,
      done: state.done,
      genError: state.genError,
      builtCompany: state.builtCompany,
      builtMVP: state.builtMVP,
      wedgePicked: state.wedgePicked,
      answers: state.answers,
      companyName: state.companyName,
      idea: state.idea,
      appSub: state.appSub,
      brandTagline: state.brandTagline,
      brandColor: state.brandColor,
      appChatId: state.appChatId,
      activePlan: state.activePlan,
      enrolled: state.enrolled,
      track: state.track,
    }
    window.localStorage.setItem(lsKey(slug), JSON.stringify(persisted))
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

/** Valid view values that can be encoded in the URL (#285). */
const VALID_VIEWS = new Set<string>([
  'brief', 'prd', 'comp', 'dataModel', 'memoryPolicy',
  'agentDef', 'apiSpec', 'backlog', 'swarm', 'infra', 'preview',
  'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30',
  'pipeline', 'rescope-intent', 'conflict', 'graph',
])

export function BuildProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(buildReducer, initialBuildState)

  // Tablet breakpoint flag (collapses Cody feed, stacks Live grid) — spec's `tablet`.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)')
    const on = () => dispatch({ type: 'SET_TABLET', tablet: mq.matches })
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // Deep-link hook (?screen=&company=&view=) — lets Playwright/QA jump straight to a
  // screen (e.g. the Live upgrade path) without driving a full codegen build.
  // Also restores persisted artifact state for a returning founder (#284).
  // Also restores the view position so a refresh doesn't lose workspace place (#285).
  // Capture the ad-click gclid + utm on landing (#207) so a conversion can be tied
  // back to the Google Ads click that drove it. Runs once, first thing.
  useEffect(() => { captureAttribution() }, [])

  // Harmless in normal use; only a known screen is honored.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const scr = q.get('screen')
    const known = ['fork', 'intake', 'ws', 'pricing', 'live', 'login', 'signup', 'account']
    if (scr && known.includes(scr)) {
      const company = q.get('company')
      if (company) {
        // Attempt to restore persisted build state for this company BEFORE
        // START_BUILD fires (so isNewBuild check sees a matching appSub first).
        const saved = loadBuildState(company)
        if (saved) {
          dispatch({ type: 'RESTORE_BUILD', partial: saved })
        }
        dispatch({ type: 'PICK_TRACK', track: 'company' })
        dispatch({ type: 'START_BUILD', idea: company, appSub: company, companyName: company })

        // Restore view position within workspace if one was encoded (#285).
        const viewParam = q.get('view')
        if (scr === 'ws' && viewParam && VALID_VIEWS.has(viewParam)) {
          dispatch({ type: 'GOTO_VIEW', view: viewParam as ArtifactView })
        }
      }
      dispatch({ type: 'GOTO_SCREEN', screen: scr as any })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist build state to localStorage whenever meaningful fields change (#284).
  // Guard: only write when there's an actual company slug to key on.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const slug = state.appSub
    if (!slug) return
    saveBuildState(slug, state)
  }, [
    state.appSub, state.generated, state.done, state.genError,
    state.builtCompany, state.builtMVP, state.wedgePicked, state.answers,
    state.companyName, state.idea, state.brandTagline, state.brandColor,
    state.appChatId, state.activePlan, state.enrolled, state.track,
  ])

  // Encode current workspace view in the URL so a refresh restores position (#285).
  // Only encode when on the workspace screen to avoid cluttering other screens.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (state.screen !== 'ws') return
    const url = new URL(window.location.href)
    const currentView = url.searchParams.get('view')
    if (currentView !== state.view) {
      url.searchParams.set('view', state.view)
      window.history.replaceState({}, '', url.toString())
    }
  }, [state.screen, state.view])

  // GA4 funnel steps 2 & 3 — build_started (entered the workspace/build) and
  // build_completed (landed on Live). Keyed on the transition so each fires once.
  useEffect(() => {
    if (state.screen === 'ws' && state.building) {
      trackEvent('build_started', 'funnel', state.track)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.screen === 'ws' && state.building])
  useEffect(() => {
    if (state.builtCompany) {
      trackEvent('build_completed', 'funnel', state.track)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.builtCompany])

  const views = useMemo(() => trackViews(state.track), [state.track])
  const woven = useMemo(() => countWoven(state, PRIMITIVE_MAP), [state])

  const goView = useCallback((view: ArtifactView) => dispatch({ type: 'GOTO_VIEW', view }), [])
  const pickTrack = useCallback((track: Track) => dispatch({ type: 'PICK_TRACK', track }), [])

  // The full Act-2 autoplay engine (prose gen + swarm/infra/preview build phases
  // + overlays + ribbon + the privacy decision + MVP completion) lives in
  // useAutoplay so the context stays a thin state/helpers wrapper. This is what
  // drives the whole build end-to-end with no dead-ends.
  useAutoplay(state, dispatch)

  const value = useMemo<BuildContextValue>(
    () => ({ state, dispatch, views, woven, totalPrimitives: TOTAL_PRIMITIVES, goView, pickTrack }),
    [state, views, woven, goView, pickTrack],
  )

  return <BuildContext.Provider value={value}>{children}</BuildContext.Provider>
}

export function useBuild(): BuildContextValue {
  const ctx = useContext(BuildContext)
  if (!ctx) throw new Error('useBuild must be used within a BuildProvider')
  return ctx
}
