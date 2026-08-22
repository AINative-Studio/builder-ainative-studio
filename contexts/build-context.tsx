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
} from '@/lib/build/state'
import { PRIMITIVE_MAP, TOTAL_PRIMITIVES } from '@/lib/build/primitives'
import { useAutoplay } from '@/lib/build/useAutoplay'
import { trackEvent } from '@/components/analytics/google-analytics'

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

  // Deep-link hook (?screen=&company=) — lets Playwright/QA jump straight to a
  // screen (e.g. the Live upgrade path) without driving a full codegen build.
  // Harmless in normal use; only a known screen is honored.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const scr = q.get('screen')
    const known = ['fork', 'intake', 'ws', 'pricing', 'live', 'login', 'signup', 'account']
    if (scr && known.includes(scr)) {
      const company = q.get('company')
      if (company) {
        dispatch({ type: 'PICK_TRACK', track: 'company' })
        dispatch({ type: 'START_BUILD', idea: company, appSub: company, companyName: company })
      }
      dispatch({ type: 'GOTO_SCREEN', screen: scr as any })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
