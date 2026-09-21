'use client'

/**
 * Builder pivot — React context (#220). Wraps the reducer state machine and
 * exposes helpers (autoplay, woven counter, track views) to every workspace
 * screen. Ported from the prototype's logic layer.
 */

import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import {
  buildReducer, initialBuildState, trackViews, countWoven,
  type BuildState, type BuildAction, type ArtifactView, type Track, type CompanyRole, type Screen,
  APP_VIEWS, COMPANY_VIEWS, SHARED_LATE_VIEWS,
} from '@/lib/build/state'
import { PRIMITIVE_MAP, TOTAL_PRIMITIVES } from '@/lib/build/primitives'
import { useAutoplay } from '@/lib/build/useAutoplay'
import { trackEvent } from '@/components/analytics/google-analytics'
import { captureAttribution } from '@/lib/build/attribution'
import { savePendingBuild, loadPendingBuild, clearPendingBuild } from '@/lib/build/pending-build'
import { saveActiveBuild, loadActiveBuild, clearActiveBuild } from '@/lib/build/active-build'

interface BuildContextValue {
  state: BuildState
  dispatch: React.Dispatch<BuildAction>
  views: readonly string[]
  woven: number
  totalPrimitives: number
  goView: (view: ArtifactView) => void
  pickTrack: (track: Track, role?: CompanyRole) => void
}

const BuildContext = createContext<BuildContextValue | null>(null)

// localStorage key prefix for build state persistence (#284).
const LS_PREFIX = 'ainative_build_'

/** Fields we persist to localStorage for a given company slug. */
type PersistedBuildState = Pick<
  BuildState,
  'generated' | 'done' | 'genError' | 'builtCompany' | 'builtMVP'
  | 'wedgePicked' | 'answers' | 'companyName' | 'idea' | 'appSub'
  | 'brandTagline' | 'brandColor' | 'appChatId' | 'productChatId' | 'activePlan' | 'enrolled' | 'track'
  | 'sawPreview' | 'designSystemId' | 'designStepDone'
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
      productChatId: state.productChatId,
      activePlan: state.activePlan,
      enrolled: state.enrolled,
      track: state.track,
      sawPreview: state.sawPreview,
      designSystemId: state.designSystemId,
      designStepDone: state.designStepDone,
    }
    window.localStorage.setItem(lsKey(slug), JSON.stringify(persisted))
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

/** Valid view values that can be encoded in the URL (#285). */
// Derived from the canonical track constants so new artifacts (e.g. #71's
// codingStandards + sprintPlan) are deep-linkable without a second edit here.
const VALID_VIEWS = new Set<string>([
  ...APP_VIEWS, ...COMPANY_VIEWS, ...SHARED_LATE_VIEWS,
])

/** Screens with no per-company build context — the URL-sync effect (#648)
 *  clears any stale `company`/`view` params when landing on one of these, so
 *  the deep-link-restore effect never re-triggers a stale company's
 *  START_BUILD on a later reload from an unrelated screen like My Portfolio. */
const SCREENS_WITHOUT_COMPANY_CONTEXT = new Set(['landing', 'start', 'login', 'signup', 'forgot', 'reset', 'account', 'companies', 'refer'])

/**
 * Pure decision for the #648 URL-sync effect: given the current URL and the
 * screen the app is actually on, what should the URL become? Returns null
 * when no change is needed (avoids a needless history.replaceState call).
 * Exported so the actual bug (a stale ?screen=/?company= surviving a client-
 * side navigation) is unit-testable without mounting the full BuildProvider.
 */
export function computeSyncedUrl(currentUrl: string, screen: string): string | null {
  const url = new URL(currentUrl)
  let changed = false
  if (url.searchParams.get('screen') !== screen) {
    url.searchParams.set('screen', screen)
    changed = true
  }
  if (SCREENS_WITHOUT_COMPANY_CONTEXT.has(screen)) {
    if (url.searchParams.has('company')) { url.searchParams.delete('company'); changed = true }
    if (url.searchParams.has('view')) { url.searchParams.delete('view'); changed = true }
  }
  return changed ? url.toString() : null
}

/**
 * Screens the deep-link (?screen=) restore effect will honor. A screen
 * missing here silently no-ops on a direct URL load — found live (#651
 * follow-up) for 'forgot'/'reset': the Auth screen's own in-app
 * GOTO_SCREEN('forgot') navigation worked fine, but a bookmarked or shared
 * ?screen=forgot URL always landed on 'landing' instead, since this
 * allowlist (not the reducer) is what gates deep-link restoration.
 */
export const KNOWN_DEEP_LINK_SCREENS = [
  'landing', 'start', 'build', 'fork', 'intake', 'ws', 'pricing', 'live',
  'login', 'signup', 'forgot', 'reset', 'account', 'companies', 'refer',
]

/**
 * Pure decision for the deep-link existence check: given /api/build/resolve-app's
 * response for a ?company= slug, does this slug actually resolve to a real,
 * registered company? Exported so the actual bug (a stale/typo'd/renamed slug
 * being trusted blindly, surfacing later as an opaque "company not found" deep
 * inside an unrelated feature like connect-domain) is unit-testable without
 * mounting the full BuildProvider (which OOMs jsdom via useAutoplay, see
 * build-context-url-sync-mount-race.test.ts's own note on this).
 *
 * `chatId: null` is resolve-app's own established "never registered" signal
 * (see its doc comment) — but a company can legitimately have no `idea` yet
 * either (mid-registration), so both must be absent to call it not-found;
 * a real company with a chatId but no idea saved yet must NOT false-positive.
 */
export function isDeepLinkCompanyNotFound(resolveAppResponse: { chatId?: string | null; idea?: string | null } | null): boolean {
  if (!resolveAppResponse) return false // network/parse failure — fail open, don't flag a real company as missing
  return resolveAppResponse.chatId === null && !resolveAppResponse.idea
}

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
    if (scr && KNOWN_DEEP_LINK_SCREENS.includes(scr)) {
      const company = q.get('company')
      if (company) {
        // Attempt to restore persisted build state for this company BEFORE
        // START_BUILD fires (so isNewBuild check sees a matching appSub first).
        const saved = loadBuildState(company)
        if (saved) {
          dispatch({ type: 'RESTORE_BUILD', partial: saved })
        }
        // Track defaults to company (back-compat); ?track=app lets QA jump into
        // App-track artifacts (e.g. #71's codingStandards / sprintPlan).
        const track: Track = q.get('track') === 'app' ? 'app' : 'company'
        dispatch({ type: 'PICK_TRACK', track })
        dispatch({ type: 'START_BUILD', idea: company, appSub: company, companyName: company })

        // Real bug fixed: a ?company= slug that doesn't match any registered
        // company (a stale bookmark, a typo, a renamed/deleted company) used
        // to be trusted blindly — START_BUILD sets state.idea to the raw
        // company string itself, which then defeats Live.tsx's own
        // idea-hydration effect (it only runs `if (!state.idea)`, so it never
        // gets a chance to notice the slug is fake). Nothing ever independently
        // confirmed the company was real until some OTHER slug-scoped call
        // (e.g. /api/build/connect-domain) 404'd deep inside a feature, with
        // no context for the founder about why. Skip this check when a local
        // cache already exists (`saved`, above) — that's strong evidence the
        // company is real from a prior successful session on this device;
        // only bother the network for the case that actually needs it.
        if (!saved) {
          fetch(`/api/build/resolve-app?slug=${encodeURIComponent(company)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (isDeepLinkCompanyNotFound(d)) {
                dispatch({ type: 'RESTORE_BUILD', partial: { deepLinkNotFound: company } })
                dispatch({ type: 'GOTO_SCREEN', screen: 'companies' })
              }
            })
            .catch(() => {})
        }

        // Restore view position within workspace if one was encoded (#285).
        const viewParam = q.get('view')
        if (scr === 'ws' && viewParam && VALID_VIEWS.has(viewParam)) {
          // Suspend autoplay so the requested view isn't immediately overridden
          // by the build driver — QA/E2E lands exactly on the encoded artifact.
          dispatch({ type: 'TAKE_THE_WHEEL' })
          dispatch({ type: 'GOTO_VIEW', view: viewParam as ArtifactView })
        }
      }
      dispatch({ type: 'GOTO_SCREEN', screen: scr as any })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auth wall (#dashboard-ux): restore a deferred build stashed before the founder
  // left to verify their email, so logging back in still fires it. Runs once on
  // mount, only when there's no in-memory pending build already (a fresh load).
  useEffect(() => {
    if (state.pendingBuild) return
    const pb = loadPendingBuild()
    if (pb) dispatch({ type: 'RESTORE_PENDING_BUILD', ...pb })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist / clear the pending build so it survives the email-verify round-trip.
  useEffect(() => {
    if (state.pendingBuild) savePendingBuild(state.pendingBuild)
    else clearPendingBuild()
  }, [state.pendingBuild])

  // Resume an in-progress build with no URL params at all (#669) — the deep-link
  // restore below only fires with ?screen=&company= already in the URL, which a
  // bare reload/new-tab of /build never has. Unconditional, once on mount: if a
  // pointer says a build was in flight, hydrate its full per-slug state (same
  // loadBuildState this file already persists via saveBuildState) and jump
  // straight back to where the founder left off, skipping the landing screen.
  useEffect(() => {
    if (state.screen !== 'landing') return
    const pointer = loadActiveBuild()
    if (!pointer) return
    const saved = loadBuildState(pointer.slug)
    if (!saved) { clearActiveBuild(); return }
    dispatch({ type: 'RESTORE_BUILD', partial: saved })
    dispatch({ type: 'GOTO_SCREEN', screen: pointer.screen as Screen })
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
    state.sawPreview,
  ])

  // Maintain the #669 resume pointer alongside the per-slug persist above: while
  // a build is genuinely in flight (a slug exists, not yet on the landing/auth
  // screens), keep the pointer fresh so an unconditional reload/new-tab can find
  // it. Once the build reaches its terminal 'live' screen, registerApp() has
  // already run and my-companies covers the founder from here on — clear it so
  // a finished build doesn't keep yanking a later, deliberate visit to a fresh
  // landing/new-company flow back into the old one.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const slug = state.appSub
    const noResumeScreens = new Set(['landing', 'login', 'signup', 'forgot', 'reset', 'live'])
    if (!slug || noResumeScreens.has(state.screen)) {
      clearActiveBuild()
      return
    }
    saveActiveBuild({ slug, screen: state.screen })
  }, [state.appSub, state.screen])

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

  // Keep ?screen= in sync with the CURRENT screen (#648) — this used to only
  // ever be set once, whatever screen was in the URL at the very first
  // navigation (e.g. the auth redirect's own ?screen=login), and never
  // updated again as the founder moved through the app client-side (My
  // Portfolio, Live, etc. all navigate via GOTO_SCREEN, never touching the
  // URL). A reload re-ran the one-shot deep-link-restore effect above against
  // that stale, ORIGINAL screen — so a founder who had long since moved to My
  // Portfolio got bounced back to whatever screen they'd first landed on
  // (confirmed live: reload from My Portfolio landed back on the login
  // screen).
  //
  // Also clears the stale `company` (+ `view`) params when the current
  // screen doesn't need them: the deep-link-restore effect above
  // unconditionally calls START_BUILD whenever `?company=` is present,
  // REGARDLESS of `?screen=`'s value — so a leftover `?company={slug}` from
  // an earlier Live/workspace visit would silently re-trigger that company's
  // build restore on a reload from an unrelated screen like My Portfolio.
  //
  // #761: this effect and the deep-link-restore effect above both run in the
  // SAME first-commit effect flush, but this one closes over `state.screen`
  // from the render that was just committed — which is always the reducer's
  // `initialBuildState.screen` ('landing') on a fresh mount, because the
  // restore effect's dispatches (RESTORE_BUILD/PICK_TRACK/START_BUILD/
  // GOTO_SCREEN) haven't been applied to `state` yet; they only land in the
  // NEXT commit. Since 'landing' is in SCREENS_WITHOUT_COMPANY_CONTEXT,
  // computeSyncedUrl stripped `?company=`/`?view=` from the URL on that very
  // first pass — before the real screen ('live') was ever reflected in
  // `state` — and once gone, the second pass (which correctly sees
  // screen==='live') has no way to put `company` back, since this effect
  // only removes/sets `screen`, never restores a dropped param. A founder's
  // deep link would render correctly for that session (the reducer dispatches
  // still landed in `state` — Live.tsx never saw the wrong company) but a
  // SUBSEQUENT hard reload had nothing left in the URL to restore from, so it
  // silently fell back to the default company. Skip this effect's first-ever
  // run entirely: the deep-link-restore effect above is the sole authority on
  // what the URL should look like on initial mount, and this one's job is
  // only to react to screen changes that happen AFTER hydration.
  const urlSyncMounted = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!urlSyncMounted.current) {
      urlSyncMounted.current = true
      return
    }
    const next = computeSyncedUrl(window.location.href, state.screen)
    if (next) window.history.replaceState({}, '', next)
  }, [state.screen])

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
  const pickTrack = useCallback((track: Track, role?: CompanyRole) => dispatch({ type: 'PICK_TRACK', track, role }), [])

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
