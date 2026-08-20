'use client'

/**
 * Builder pivot — React context (#220). Wraps the reducer state machine and
 * exposes helpers (autoplay, woven counter, track views) to every workspace
 * screen. Ported from the prototype's logic layer.
 */

import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import {
  buildReducer, initialBuildState, trackViews, countWoven,
  type BuildState, type BuildAction, type ArtifactView, type Track,
} from '@/lib/build/state'
import { PRIMITIVE_MAP, TOTAL_PRIMITIVES } from '@/lib/build/primitives'
import { GENERATED_VIEWS } from '@/lib/build/artifact-prompts'

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

  const views = useMemo(() => trackViews(state.track), [state.track])
  const woven = useMemo(() => countWoven(state, PRIMITIVE_MAP), [state])

  const goView = useCallback((view: ArtifactView) => dispatch({ type: 'GOTO_VIEW', view }), [])
  const pickTrack = useCallback((track: Track) => dispatch({ type: 'PICK_TRACK', track }), [])

  // ── Autoplay generation driver (#207) ─────────────────────────────────────
  // This is what makes the workspace actually MOVE. When the workspace is open,
  // Cody is in auto mode, and there's an idea, walk the track's artifact
  // sequence: for the current view, if it has a real prompt and hasn't been
  // generated, POST /api/build/artifact (real Claude generation from the idea),
  // store the result, then advance to the next view. Loops until every generated
  // artifact in the track is done. A ref guards against overlapping in-flight
  // calls (React StrictMode double-invoke / re-renders).
  const inFlight = useRef<string | null>(null)
  useEffect(() => {
    if (state.screen !== 'ws' || !state.auto || !state.idea) return

    const seq = trackViews(state.track)
    // find the first view in order that still needs generation
    const next = seq.find(
      (v) => GENERATED_VIEWS.has(v) && !state.done[v] && !state.genError[v],
    )

    // Nothing left to generate → the track's prose artifacts are complete.
    if (!next) return
    if (inFlight.current === next) return

    // Make sure the user is looking at the artifact being generated.
    if (state.view !== next) {
      dispatch({ type: 'GOTO_VIEW', view: next as ArtifactView })
      return
    }

    inFlight.current = next
    const ac = new AbortController()
    // prior = already-generated artifacts, so later ones build on earlier ones
    const prior: Record<string, unknown> = {}
    for (const v of seq) if (state.generated[v]) prior[v] = state.generated[v]

    fetch('/api/build/artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        view: next,
        idea: state.idea,
        track: state.track,
        companyName: state.companyName || undefined,
        prior,
      }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok || !data?.content) {
          throw new Error(data?.error || `HTTP ${r.status}`)
        }
        dispatch({ type: 'GEN_DONE', view: next, content: data.content })
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        dispatch({ type: 'GEN_FAIL', view: next, error: String(err?.message || err) })
      })
      .finally(() => {
        if (inFlight.current === next) inFlight.current = null
      })

    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.screen, state.auto, state.idea, state.track, state.view, state.done, state.generated, state.genError])

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
