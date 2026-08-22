/**
 * Builder pivot — state machine (#220).
 *
 * Ported from design_handoff_builder/06-IMPLEMENTATION-NOTES.md. Names match the
 * prototype 1:1 so the spec and code stay legible to each other. The prototype
 * is vanilla JS; this is the React port (reducer + context in build-context.tsx).
 */

export type Screen =
  | 'fork' | 'intake' | 'ws' | 'pricing' | 'live'
  | 'login' | 'signup' | 'forgot' | 'reset' | 'account'
  | 'companies'   // "my companies" index (#253) — a founder's built companies

export type Track = 'app' | 'company'
export type Plan = '' | 'launch' | 'company'

/**
 * Active PAID subscription tier (#241), distinct from `Plan` (the in-flow
 * pricing-picker choice). Set after Stripe checkout is verified server-side;
 * screens gate unlocks off it (Pro → custom domain, Business → nightly-loop
 * enrollment, Enterprise → swarm). '' = no active subscription.
 */
export type ActivePlan = '' | 'pro' | 'business' | 'enterprise' | 'cody_vcto'

/** Artifact ids (the `view` values), in composition order per track. */
export const APP_VIEWS = [
  'brief', 'prd', 'comp', 'dataModel', 'memoryPolicy',
  'agentDef', 'apiSpec', 'backlog', 'swarm', 'infra', 'preview',
] as const
export const COMPANY_VIEWS = [
  'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30',
] as const
export const SHARED_LATE_VIEWS = ['pipeline', 'rescope-intent', 'conflict', 'graph'] as const

export type ArtifactView =
  | (typeof APP_VIEWS)[number]
  | (typeof COMPANY_VIEWS)[number]
  | (typeof SHARED_LATE_VIEWS)[number]

export type WedgeChoice = '' | 'support' | 'eng' | 'sales'
export type PrivacyAnswer = 'raw' | 'embeddings-only'

export interface PendingQuestion {
  q: string
  sub: string
  opts: Array<{ v: string; t: string }>
}

export interface BuildState {
  screen: Screen
  track: Track
  view: ArtifactView
  plan: Plan
  auto: boolean            // Cody autoplaying vs user manual nav
  building: boolean        // an artifact/swarm/infra overlay is active
  paused: boolean          // a decision modal is blocking (overrides auto)
  pendingQ: PendingQuestion | null
  done: Record<string, string>   // artifactId -> status string; drives breadcrumb/rail
  nudgeState: Record<string, 'accepted' | 'dismissed' | undefined>
  wedgePicked: WedgeChoice
  builtMVP: boolean
  builtCompany: boolean
  propagating: boolean
  conflictResolved: boolean
  conflictView: string     // the upstream artifact whose edit triggered the conflict ('' = none)
  answers: { privacy?: PrivacyAnswer; [k: string]: string | undefined }
  companyName: string
  appSub: string           // staging subdomain, e.g. {appSub}.ainative.studio
  tablet: boolean
  idea: string             // the founder's raw idea (from intake) — drives all generation
  brandTagline: string     // generated brand tagline (FIX-1)
  brandColor: string       // generated brand accent color hex (FIX-1)
  appChatId: string        // the generated running app's chatId (served at /build/{slug}) (FIX-2)
  generated: Record<string, unknown>  // view -> generated artifact content (from /api/build/artifact)
  genError: Record<string, string>     // view -> error message when generation failed
  overlay: Overlay         // full-bleed build overlay currently showing (Act-2 "watch Cody build")
  ribbon: string[]         // terminal-ribbon lines (infra-level narration), newest last
  askedPrivacy: boolean    // has the one App-track decision modal (privacy posture) been shown yet
  railOpen: boolean        // the Artifacts rail drawer is open
  indexOpen: boolean       // the Index (jump-to-any-screen) panel is open
  activePlan: ActivePlan   // verified PAID subscription tier (#241); '' = none. Drives feature gates.
  enrolled: boolean        // Business+ auto-enrolled into the nightly loop (#241; cron is #243)
}

/** Full-bleed build overlays that can cover the workspace during autoplay (04-SCREENS §3). */
export type Overlay =
  | { kind: 'none' }
  | { kind: 'forming'; view: string }        // an artifact is being written
  | { kind: 'swarm' }                        // the swarm is building the MVP
  | { kind: 'provisioning' }                 // infra is being provisioned

export const initialBuildState: BuildState = {
  screen: 'fork',
  track: 'app',
  view: 'brief',
  plan: '',
  auto: true,
  building: false,
  paused: false,
  pendingQ: null,
  done: {},
  nudgeState: {},
  wedgePicked: '',
  builtMVP: false,
  builtCompany: false,
  propagating: false,
  conflictResolved: false,
  conflictView: '',
  answers: {},
  companyName: '',
  appSub: '',
  tablet: false,
  idea: '',
  brandTagline: '',
  brandColor: '#2f6d86',
  appChatId: '',
  generated: {},
  genError: {},
  overlay: { kind: 'none' },
  ribbon: [],
  askedPrivacy: false,
  railOpen: false,
  indexOpen: false,
  activePlan: '',
  enrolled: false,
}

export type BuildAction =
  | { type: 'GOTO_SCREEN'; screen: Screen }
  | { type: 'PICK_TRACK'; track: Track }
  | { type: 'START_BUILD'; idea: string; appSub: string; companyName?: string; brandTagline?: string; brandColor?: string }
  | { type: 'GEN_DONE'; view: string; content: unknown }
  | { type: 'GEN_FAIL'; view: string; error: string }
  | { type: 'GOTO_VIEW'; view: ArtifactView }
  | { type: 'SET_BUILDING'; building: boolean }
  | { type: 'COMPLETE_ARTIFACT'; view: string; status?: string }
  | { type: 'PAUSE'; pendingQ: PendingQuestion }
  | { type: 'ANSWER_Q'; key: string; value: string }
  | { type: 'TAKE_THE_WHEEL' }
  | { type: 'KEEP_GOING' }
  | { type: 'NUDGE'; view: string; state: 'accepted' | 'dismissed' }
  | { type: 'PICK_WEDGE'; choice: WedgeChoice }
  | { type: 'MVP_DONE' }
  | { type: 'COMPANY_DONE' }
  | { type: 'PICK_PLAN'; plan: Plan }
  | { type: 'SET_PROPAGATING'; propagating: boolean }
  | { type: 'RESOLVE_CONFLICT' }
  | { type: 'SET_TABLET'; tablet: boolean }
  | { type: 'SET_OVERLAY'; overlay: Overlay }
  | { type: 'RIBBON'; line: string }
  | { type: 'ASK_PRIVACY' }
  | { type: 'TRIGGER_CONFLICT'; changedView: string; fromRescopeIntent?: boolean }
  /** Restore persisted build state from localStorage without clearing artifacts (#284). */
  | { type: 'RESTORE_BUILD'; partial: Partial<Pick<BuildState, 'generated' | 'done' | 'genError' | 'builtCompany' | 'builtMVP' | 'wedgePicked' | 'answers' | 'companyName' | 'idea' | 'appSub' | 'brandTagline' | 'brandColor' | 'appChatId' | 'activePlan' | 'enrolled' | 'track'>> }
  | { type: 'TOGGLE_RAIL' }
  | { type: 'TOGGLE_INDEX' }
  | { type: 'SET_APP_CHATID'; chatId: string }
  | { type: 'SET_ACTIVE_PLAN'; plan: ActivePlan; enrolled?: boolean }

export function buildReducer(state: BuildState, action: BuildAction): BuildState {
  switch (action.type) {
    case 'GOTO_SCREEN':
      return { ...state, screen: action.screen }
    case 'PICK_TRACK':
      return {
        ...state,
        track: action.track,
        view: action.track === 'app' ? 'brief' : 'thesis',
        screen: 'intake',
      }
    case 'START_BUILD': {
      // Only wipe generated/done when this is genuinely a NEW build (different slug).
      // Re-entering an existing company (same appSub) must NOT reset artifacts (#284).
      const isNewBuild = action.appSub !== state.appSub || !state.appSub
      return {
        ...state,
        screen: 'ws',
        idea: action.idea,
        appSub: action.appSub,
        companyName: action.companyName ?? state.companyName,
        brandTagline: action.brandTagline ?? state.brandTagline,
        brandColor: action.brandColor ?? state.brandColor,
        building: true,
        auto: true,
        // Only clear prior generation on a genuinely new build (#284).
        generated: isNewBuild ? {} : state.generated,
        genError: isNewBuild ? {} : state.genError,
        done: isNewBuild ? {} : state.done,
        view: state.track === 'app' ? 'brief' : 'thesis',
      }
    }
    case 'GEN_DONE':
      return {
        ...state,
        generated: { ...state.generated, [action.view]: action.content },
        genError: { ...state.genError, [action.view]: '' },
        done: { ...state.done, [action.view]: 'done' },
      }
    case 'GEN_FAIL':
      return {
        ...state,
        genError: { ...state.genError, [action.view]: action.error },
      }
    case 'GOTO_VIEW':
      return { ...state, view: action.view }
    case 'SET_BUILDING':
      return { ...state, building: action.building }
    case 'COMPLETE_ARTIFACT':
      return {
        ...state,
        done: { ...state.done, [action.view]: action.status ?? 'done' },
      }
    case 'PAUSE':
      return { ...state, paused: true, pendingQ: action.pendingQ }
    case 'ANSWER_Q':
      return {
        ...state,
        paused: false,
        pendingQ: null,
        answers: { ...state.answers, [action.key]: action.value },
      }
    case 'TAKE_THE_WHEEL':
      return { ...state, auto: false }
    case 'KEEP_GOING':
      return { ...state, auto: true }
    case 'NUDGE':
      return { ...state, nudgeState: { ...state.nudgeState, [action.view]: action.state } }
    case 'PICK_WEDGE':
      return { ...state, wedgePicked: action.choice }
    case 'MVP_DONE':
      return { ...state, builtMVP: true, building: false }
    case 'COMPANY_DONE':
      return { ...state, builtCompany: true, building: false, screen: 'live' }
    case 'PICK_PLAN':
      return { ...state, plan: action.plan }
    case 'SET_PROPAGATING':
      return { ...state, propagating: action.propagating }
    case 'RESOLVE_CONFLICT':
      return { ...state, propagating: false, conflictResolved: true }
    case 'TRIGGER_CONFLICT':
      // An upstream edit with downstream impact routes to the blocking conflict
      // gate. auto=false so the user must resolve it before anything else runs.
      // When fromRescopeIntent=true, route to 'rescope-intent' first (#286) so
      // the user gets context before seeing the dependency graph.
      return {
        ...state,
        screen: 'ws',
        view: (action.fromRescopeIntent ? 'rescope-intent' : 'conflict') as ArtifactView,
        conflictView: action.changedView,
        conflictResolved: false,
        propagating: false,
        auto: false,
        overlay: { kind: 'none' },
      }
    case 'RESTORE_BUILD':
      // Hydrate persisted fields without disturbing live UI state (#284).
      return { ...state, ...action.partial }
    case 'SET_TABLET':
      return { ...state, tablet: action.tablet }
    case 'TOGGLE_RAIL':
      return { ...state, railOpen: !state.railOpen, indexOpen: false }
    case 'TOGGLE_INDEX':
      return { ...state, indexOpen: !state.indexOpen, railOpen: false }
    case 'SET_APP_CHATID':
      return { ...state, appChatId: action.chatId }
    case 'SET_ACTIVE_PLAN':
      return {
        ...state,
        activePlan: action.plan,
        // Business+ auto-enroll into the nightly loop; default from the tier when
        // the caller doesn't pass an explicit flag (#241; cron itself is #243).
        enrolled: action.enrolled ?? (action.plan === 'business' || action.plan === 'enterprise' || action.plan === 'cody_vcto'),
      }
    case 'SET_OVERLAY':
      return { ...state, overlay: action.overlay }
    case 'RIBBON':
      // keep the last ~40 lines so the ribbon scrolls without unbounded growth
      return { ...state, ribbon: [...state.ribbon, action.line].slice(-40) }
    case 'ASK_PRIVACY':
      return {
        ...state,
        paused: true,
        askedPrivacy: true,
        pendingQ: {
          q: 'How should your data be stored?',
          sub: 'This changes the Data Model and Memory Policy — a real product decision, so I want your call before I commit it.',
          opts: [
            { v: 'raw', t: 'Store raw content — richest answers, your data stays in your ZeroDB project.' },
            { v: 'embeddings-only', t: 'Embeddings only — store vectors, never raw text. Maximum privacy.' },
          ],
        },
      }
    default:
      return state
  }
}

/** Ordered artifact sequence for the active track (drives breadcrumb + act-bar). */
export function trackViews(track: Track): readonly string[] {
  return track === 'app' ? APP_VIEWS : COMPANY_VIEWS
}

/**
 * Plan-gated feature unlocks (#241). Screens read these off `state.activePlan`
 * to decide what a paid tier unlocks. Tiers are cumulative:
 *   Pro        → custom-domain eligibility
 *   Business   → nightly-loop enrollment (+ everything Pro)
 *   Enterprise → the agent swarm (+ everything Business)
 * cody_vcto is treated as the top tier (all unlocks). '' = no subscription.
 */
export function planUnlocks(plan: ActivePlan): {
  customDomain: boolean
  nightlyLoop: boolean
  swarm: boolean
} {
  const rank: Record<ActivePlan, number> = {
    '': 0, pro: 1, business: 2, enterprise: 3, cody_vcto: 4,
  }
  const r = rank[plan] ?? 0
  return {
    customDomain: r >= 1,   // Pro+
    nightlyLoop: r >= 2,    // Business+
    swarm: r >= 3,          // Enterprise+
  }
}

/**
 * "N woven" — count DISTINCT primitives referenced across completed artifacts'
 * `powered` lists + accepted nudges. Recomputed from done+nudgeState each render
 * (per spec, never stored, to avoid drift). primitiveMap injected to avoid a
 * circular import with the primitive-context map.
 */
export function countWoven(
  state: BuildState,
  primitiveMap: Record<string, { powered: string[]; nudge?: { prim: string } | null }>,
): number {
  const set = new Set<string>()
  for (const view of Object.keys(state.done)) {
    const entry = primitiveMap[view]
    if (entry) entry.powered.forEach((p) => set.add(p))
  }
  for (const [view, s] of Object.entries(state.nudgeState)) {
    if (s === 'accepted') {
      const nudge = primitiveMap[view]?.nudge
      if (nudge) set.add(nudge.prim)
    }
  }
  return set.size
}
