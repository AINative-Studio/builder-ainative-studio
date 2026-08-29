'use client'

/**
 * Autoplay engine (#207 · Act 2) — the driver that makes the workspace actually
 * BUILD, end to end, with no dead-ends.
 *
 * It walks the active track's FULL sequence in order. For each view:
 *   - prose artifacts (thesis/prd/dataModel/…) → POST /api/build/artifact
 *     (real Claude generation from the idea), with a "forming" overlay.
 *   - swarm → a "swarm" overlay that runs timed build phases + ribbon narration.
 *   - infra → a "provisioning" overlay that ticks the infra checklist.
 *   - preview → deploy narration, then the running preview (real app wired in B1).
 * It pauses ONCE on the App track for the data-privacy decision (real product
 * call), resumes on answer, and at the end of the App track fires MVP_DONE so
 * "Make it real →" appears. The Company track ends at plan30 (its CTA → live).
 *
 * "Take the wheel" (auto=false) suspends the engine; "keep going" resumes it.
 * A ref guards against overlapping async steps across re-renders/StrictMode.
 */

import { useEffect, useRef, useState } from 'react'
import { trackViews, type BuildState, type BuildAction, type ArtifactView } from '@/lib/build/state'
import { GENERATED_VIEWS } from '@/lib/build/artifact-prompts'

type Dispatch = React.Dispatch<BuildAction>

// Views that are "built" over time (overlay + ribbon) rather than text-generated.
const BUILD_VIEWS = new Set(['swarm', 'infra', 'preview'])

// Views that INTERRUPT autoplay for a user choice (Cody hands the wheel over):
// the Wedge challenge (Company track). The user's pick resumes the flow via the
// component's own dispatch (PICK_WEDGE → goView). Autoplay must not auto-run them.
const INTERRUPT_VIEWS = new Set(['wedge'])

// Ribbon narration per build view — infra-level lines that scroll in the terminal.
const RIBBON_LINES: Record<string, string[]> = {
  swarm: [
    'orchestrator ▸ decomposing PRD into shippable issues',
    'agent:architect ▸ mapped services → zerodb, zeromemory, agent-cloud',
    'agent:backend ▸ scaffolding /ask endpoint',
    'agent:frontend ▸ building citation renderer',
    'agent:security ▸ wiring source-access guard',
    'orchestrator ▸ issues shipped, merging to main',
  ],
  infra: [
    'provision ▸ zerodb project (vectors + tables + embeddings)',
    'provision ▸ zeromemory namespace (per-workspace isolation)',
    'provision ▸ agent-cloud deploy (answer agent, auto-scale)',
    'provision ▸ identity (oauth 2.1 + pkce)',
    'provision ▸ all primitives live',
  ],
  preview: [
    'deploy ▸ building container',
    'deploy ▸ pushing to sandbox',
    'deploy ▸ health check ok',
    'deploy ▸ live at staging',
  ],
}

const STEP_MS = 850          // per ribbon line
const FORMING_MS = 500       // brief "forming" beat before prose lands
const HANDOFF_MS = 550       // pause between views so the user can register progress

export function useAutoplay(state: BuildState, dispatch: Dispatch) {
  const busy = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  // A tick counter that we bump whenever a step finishes. Because `busy` is a
  // ref (no re-render), resetting it alone would NOT re-run the effect to pick
  // up the next view — bumping this state does. `tick` is in the dep array.
  const [tick, setTick] = useState(0)
  const done = () => { busy.current = false; setTick((t) => t + 1) }

  useEffect(() => {
    // Only drive while in the workspace, in auto mode, not paused on a decision.
    if (state.screen !== 'ws' || !state.auto || state.paused || !state.idea) return
    if (busy.current) return

    const seq = trackViews(state.track)
    const next = seq.find((v) => !state.done[v] && !state.genError[v])

    // ── Track complete ──────────────────────────────────────────────────────
    if (!next) {
      if (state.track === 'app' && !state.builtMVP) {
        dispatch({ type: 'SET_OVERLAY', overlay: { kind: 'none' } })
        dispatch({ type: 'MVP_DONE' })
        dispatch({ type: 'GOTO_VIEW', view: 'preview' as ArtifactView })
      }
      // Company track: plan30's own "See it live →" CTA fires COMPANY_DONE.
      return
    }

    // ── Privacy decision (App track, once, right before the Data Model) ──────
    if (state.track === 'app' && next === 'dataModel' && !state.askedPrivacy) {
      dispatch({ type: 'SET_OVERLAY', overlay: { kind: 'none' } })
      dispatch({ type: 'ASK_PRIVACY' })
      return
    }

    // ── Interrupt view (Wedge): show it and HAND THE WHEEL to the user. The
    // Wedge component resumes the flow when they pick (PICK_WEDGE → businessModel).
    // We mark it done so autoplay doesn't loop on it, but don't advance past it —
    // the user's pick does that.
    if (INTERRUPT_VIEWS.has(next)) {
      dispatch({ type: 'SET_OVERLAY', overlay: { kind: 'none' } })
      if (state.view !== next) dispatch({ type: 'GOTO_VIEW', view: next as ArtifactView })
      if (next === 'wedge' && !state.wedgePicked) return // wait for the user
      dispatch({ type: 'COMPLETE_ARTIFACT', view: next })
      done()
      return
    }

    // Make sure the user is looking at the view being built.
    if (state.view !== next) {
      dispatch({ type: 'GOTO_VIEW', view: next as ArtifactView })
      return
    }

    const schedule = (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      timers.current.push(t)
    }

    busy.current = true

    // ── Build view (swarm / infra / preview): overlay + timed ribbon ────────
    if (BUILD_VIEWS.has(next)) {
      const overlay =
        next === 'swarm' ? ({ kind: 'swarm' } as const)
        : next === 'infra' ? ({ kind: 'provisioning' } as const)
        : ({ kind: 'none' } as const) // preview shows the real frame, not an overlay
      dispatch({ type: 'SET_OVERLAY', overlay })

      const lines = RIBBON_LINES[next] || []
      lines.forEach((line, i) => schedule(() => dispatch({ type: 'RIBBON', line }), i * STEP_MS))

      schedule(() => {
        dispatch({ type: 'SET_OVERLAY', overlay: { kind: 'none' } })
        dispatch({ type: 'COMPLETE_ARTIFACT', view: next, status: next === 'preview' ? 'deployed' : 'done' })
        done()
      }, lines.length * STEP_MS + HANDOFF_MS)
      return
    }

    // ── Prose view: forming overlay → real generation → done ────────────────
    if (GENERATED_VIEWS.has(next)) {
      dispatch({ type: 'SET_OVERLAY', overlay: { kind: 'forming', view: next } })
      const ac = new AbortController()
      const prior: Record<string, unknown> = {}
      for (const v of seq) if (state.generated[v]) prior[v] = state.generated[v]

      schedule(() => {
        // Artifact generation can hit a TRANSIENT provider blip: /api/build/artifact
        // returns 503 'generation_unavailable' only when EVERY provider (Bedrock/
        // Anthropic + both AINative fallbacks, each now with a JSON-repair pass —
        // see app/api/build/artifact/route.ts) fails at once. A single blip used to
        // fail the artifact permanently and stall the whole build with no recovery
        // (this is what left coastal/nXl2rNA1f6FuavVJ_X0kF half-built, and what left
        // Dwellow's landing page silently showing placeholder copy). Retry such
        // transient failures with backoff before giving up; only a genuine, repeated
        // failure surfaces GEN_FAIL. 4xx (bad request) is NOT retried — it won't heal.
        // 5 attempts (up from 3) because the server-side repair pass means a single
        // client attempt now represents up to 6 underlying model calls — worth a
        // couple more client rounds before asking the user to intervene at all.
        const MAX_ATTEMPTS = 5
        const isTransient = (status: number, error?: string) =>
          status === 503 || status === 502 || status === 500 || status === 504 || status === 429 || status === 0 ||
          error === 'generation_unavailable'

        const backoff = (n: number) =>
          new Promise((res) => setTimeout(res, Math.min(800 * Math.pow(2, n - 1), 6400))) // 0.8s,1.6s,3.2s,6.4s…capped

        // Bound EACH attempt so a hung request (server never responds, no
        // network-level error) can't stall the whole build forever in
        // "Generating…" — it now times out and retries like any other
        // transient failure instead of leaving the view stuck indefinitely.
        const ATTEMPT_TIMEOUT_MS = 25_000

        const attempt = async (n: number): Promise<void> => {
          let response: Response
          try {
            response = await fetch('/api/build/artifact', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.any([ac.signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
              body: JSON.stringify({
                view: next, idea: state.idea, track: state.track,
                companyName: state.companyName || undefined, prior,
              }),
            })
          } catch (e: unknown) {
            // ac.signal.aborted (teardown/unmount) is terminal — everything else,
            // including our own per-attempt timeout firing, is transient → retry.
            if (ac.signal.aborted) return
            if (n < MAX_ATTEMPTS) { await backoff(n); if (ac.signal.aborted) return; return attempt(n + 1) }
            dispatch({ type: 'GEN_FAIL', view: next, error: e instanceof Error ? e.message : String(e) })
            return
          }
          const data = await response.json().catch(() => null)
          if (response.ok && data?.content) {
            dispatch({ type: 'GEN_DONE', view: next, content: data.content })
            return
          }
          const err = data?.error || `HTTP ${response.status}`
          // Retry only TRANSIENT failures (503/502/429/generation_unavailable).
          // A 4xx is a bad request that won't heal — fail it immediately.
          if (n < MAX_ATTEMPTS && isTransient(response.status, data?.error)) {
            await backoff(n)
            if (ac.signal.aborted) return
            return attempt(n + 1)
          }
          if (!ac.signal.aborted) dispatch({ type: 'GEN_FAIL', view: next, error: err })
        }

        attempt(1).finally(() => {
          schedule(() => {
            dispatch({ type: 'SET_OVERLAY', overlay: { kind: 'none' } })
            done()
          }, HANDOFF_MS)
        })
      }, FORMING_MS)
      return
    }

    // Any other view (shouldn't happen in a track sequence) — just mark done.
    dispatch({ type: 'COMPLETE_ARTIFACT', view: next })
    done()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tick,
    state.screen, state.auto, state.paused, state.idea, state.track, state.view,
    state.done, state.generated, state.genError, state.askedPrivacy, state.builtMVP,
    state.wedgePicked,
  ])

  // Clear pending timers on unmount so a torn-down workspace doesn't dispatch.
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current = [] }, [])
}
