'use client'

/**
 * Live operating dashboard (#226) — the destination. 04-SCREENS Live.
 * The founder supervises an AI-run company. The business-systems grid wires the
 * real AINative primitives (ZeroPipeline/ZeroInvoice/ServiceOS/ZeroVoice), and
 * Cody's nightly-run status is our real recursive loop pointed at the user's co.
 */

import { useState, useEffect, useRef } from 'react'
import { StreamingMessage } from '@ainative/ai-kit'
import { useBuild } from '@/contexts/build-context'
import { trackEvent } from '@/components/analytics/google-analytics'
import { trackMeta } from '@/components/analytics/meta-pixel'
import { useLiveProof } from '@/lib/build/useLiveProof'
import { useAutoRun } from '@/lib/build/useAutoRun'
import { activityState, ribbonLine, ACTIVITY_EMPTY_LINE } from '@/lib/build/auto-run-activity'
import { buildSystems, type BusinessSystem } from '@/lib/build/business-systems'
import { DomainModal } from '@/components/build/DomainModal'
import { MenuChip } from '@/components/build/MenuChip'
import { planUnlocks, type ActivePlan } from '@/lib/build/state'
import { useSession } from 'next-auth/react'
import { SystemStatusBadge } from '@/components/build/SystemStatusBadge'
import { SystemSaving } from '@/components/build/SystemSaving'
import { countSystemStatuses, planFramingLine } from '@/lib/build/live-vs-planned'
import { liveStatusLine } from '@/lib/build/front-door-value'
import { TasksPanel } from '@/components/build/TasksPanel'
import { VersionsPanel } from '@/components/build/VersionsPanel'
import { OnboardingVideo } from '@/components/build/OnboardingVideo'
import { DocumentsPanel } from '@/components/build/DocumentsPanel'
import { MediaPanel } from '@/components/build/MediaPanel'
import { AutoModePanel } from '@/components/build/AutoModePanel'
import { GrowthPanel } from '@/components/build/GrowthPanel'
import { WaitlistPanel } from '@/components/build/WaitlistPanel'
import { WebsitePanel } from '@/components/build/WebsitePanel'
import { FeedbackPulse } from '@/components/build/FeedbackPulse'
import { ZeroInvoiceConnect } from '@/components/build/ZeroInvoiceConnect'
import { ZeroVoiceConnect } from '@/components/build/ZeroVoiceConnect'
import { UPLOAD_ACCEPT_ATTR } from '@/lib/build/media-upload'
import { DOCUMENT_UPLOAD_ACCEPT_ATTR } from '@/lib/build/document-upload'
import { useHeaderHeightVar } from '@/lib/build/useHeaderHeightVar'
import { useEqualColumnHeight } from '@/lib/build/useEqualColumnHeight'
import { CollapsibleSection } from '@/components/build/CollapsibleSection'

/** Display label for an active paid tier (#241). */
const PLAN_LABEL: Record<ActivePlan, string> = {
  '': '', pro: 'Pro', business: 'Business', enterprise: 'Enterprise', cody_vcto: 'Cody · Virtual CTO',
}

// Monthly $ value per plan for the Meta Pixel Purchase event — mirrors PLAN_VALUE
// in app/api/build/subscription/verify/route.ts so browser and CAPI agree.
const PLAN_META_VALUE: Record<string, number> = {
  pro: 49, launch: 49, business: 149, company: 149, enterprise: 999, cody_vcto: 4999,
}

/** A file attached to a chat turn (#741) — mirrors lib/build/chat-store.ts's
 *  ChatAttachment shape (kept independent since this is a client component). */
interface ChatAttachment { fileId: string; url: string; contentType: string; fileName: string }
interface ChatLine { role: 'user' | 'cody'; text: string; attachments?: ChatAttachment[] }
/** An attachment mid-upload or ready-to-send in the composer, before the
 *  message is sent (#741). */
interface PendingAttachment extends ChatAttachment { uploading?: boolean; error?: string }

/**
 * Style overrides passed directly to `@ainative/ai-kit`'s StreamingMessage
 * (#760). StreamingMessage ships opinionated inline defaults — a tinted
 * background, 16px padding, a 4px role-colored left border, and an 8px
 * bottom margin (see node_modules/@ainative/ai-kit/dist/index.mjs) — all
 * meant for a standalone chat-bubble UI. Builder's `.m-chat-cody` look is
 * flat inline text with no card chrome, so those defaults are neutralized
 * here via the `style` prop (which the component spreads LAST, after its
 * own inline styles, so this wins) rather than fought with CSS specificity.
 * Defined once at module scope so the object identity is stable across
 * renders (StreamingMessage's own effects depend on `style` only implicitly
 * via re-render, but a stable reference avoids any needless prop churn).
 */
const AIKIT_MESSAGE_STYLE_OVERRIDE: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderLeft: 'none',
  padding: 0,
  margin: 0,
  gap: 0,
}

export function Live() {
  const { state, dispatch } = useBuild()
  const proof = useLiveProof()
  const [msg, setMsg] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  // Founder-facing comms cadence mode (#743): 'agile' (default — a morning
  // standup email) or 'pairProgramming' (a Gitea commit-activity digest).
  // Hydrated from the registry below; optimistic-then-persist on change,
  // same shape as enrollNightly().
  const [commsMode, setCommsMode] = useState<'agile' | 'pairProgramming'>('agile')
  const [commsModeSaving, setCommsModeSaving] = useState(false)
  const [chat, setChat] = useState<ChatLine[]>([])
  // Chat attachments (#741): files picked/uploaded in the composer, attached
  // to the NEXT sent message. Uploaded immediately on selection so the
  // founder sees a real preview/chip before hitting Send.
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [attachError, setAttachError] = useState('')
  const attachInputRef = useRef<HTMLInputElement>(null)
  // Whether the persisted conversation has been loaded yet (#52) — gates the
  // honest empty state so we don't flash "ask me anything" before hydration.
  const [chatLoaded, setChatLoaded] = useState(false)
  // #608: "where we left off" handoff summary for a returning founder.
  const [chatSummary, setChatSummary] = useState<string | null>(null)
  // #693: "what Cody has learned" — synthesized ZeroMemory profile.
  const [companyProfile, setCompanyProfile] = useState<{
    summary: string | null; preferences: string[]; behaviors: string[]; facts: string[]
  } | null>(null)
  const [asking, setAsking] = useState(false)
  // Real bug (customer-reported, 2026-09-08): the chat log now scrolls
  // internally (app/modernist.css .m-chat-log) instead of overflowing the
  // page, but with no auto-scroll a founder sending a new message would land
  // back at the TOP of a long conversation instead of seeing the new reply.
  const chatLogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight })
  }, [chat, asking])
  const [systems, setSystems] = useState<BusinessSystem[]>(buildSystems())
  const [nightshift, setNightshift] = useState<{ hasRun: boolean; summary?: string; lastRunAt?: string } | null>(null)
  // Early email capture (#207): an anonymous founder can save/share their company
  // by email BEFORE the upgrade wall — turning non-converters into a reachable lead.
  const [leadEmail, setLeadEmail] = useState('')
  const [leadSaved, setLeadSaved] = useState(false)
  const company = state.companyName || 'Your Company'
  const companyId = state.appSub || company.toLowerCase().replace(/\s+/g, '-')
  // Auto Mode run activity (#340): poll THIS company's run + its event trail so
  // the swarm card and the masthead ribbon show the founder's OWN agents at work.
  const auto = useAutoRun(companyId)
  const swarmActivity = activityState(auto.progress.running, auto.events)
  const runRibbon = ribbonLine(auto.progress.running, auto.events, company)
  // Real, working subdirectory URL — no dead subdomain. (FIX-2)
  const appPath = `/build/${state.appSub || companyId}`
  const url = `builder.ainative.studio${appPath}`
  // Persisted deploy URL for this company (#279): when AINATIVE_WILDCARD_HOST is
  // set, provisioning persists a REAL dedicated host at https://{slug}.ainative.studio
  // (deployPersistent → kind 'wildcard'). Absent that, provision persists the durable
  // preview subdirectory. We read it from the provision status and prefer it over the
  // hardcoded /build/{slug} path so a wildcarded company shows its own subdomain.
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const [zerovoiceE164, setZerovoiceE164] = useState<string | null>(null)
  const [appReady, setAppReady] = useState<boolean>(!!state.appChatId)
  const [domainOpen, setDomainOpen] = useState(false)
  // Purchased custom domain (#240), read from the app-registry entry. When set,
  // the masthead + infra section show "Live at {domain}" instead of the subdir URL.
  const [customDomain, setCustomDomain] = useState<string | null>(null)
  // Subdomain claim (#78): the {slug}.ainative.studio host must NOT surface until the
  // company is on a PAID plan AND has explicitly claimed it. Read from the registry
  // entry; drives whether we show the subdomain vs the /build/{slug} path everywhere.
  const [subdomainClaimed, setSubdomainClaimed] = useState(false)
  const [claiming, setClaiming] = useState(false)
  // Honest "founder clicked Connect ZeroInvoice" signal (#506, child of #418) —
  // read from the app-registry entry. Never a confirmed-connected state; see
  // ZeroInvoiceConnect's doc comment for why builder cannot verify more than this.
  const [zeroInvoiceClickedAt, setZeroInvoiceClickedAt] = useState<string | null>(null)
  // Real bug fix: the founder's own "I finished connecting" self-report — the
  // only way past "Connect requested" since builder structurally cannot
  // verify the OAuth completion server-side (see ZeroInvoiceConnect doc).
  const [zeroInvoiceConfirmedAt, setZeroInvoiceConfirmedAt] = useState<string | null>(null)
  // Persistent-cloud provisioning (#243): once a company is provisioned it has
  // its own real ZeroDB project + persistent deploy target, and the systems grid
  // reads real per-company data. `checked` (#748) distinguishes "we haven't
  // heard back from GET /api/build/provision yet" from "we asked, and it's
  // confirmed not provisioned" — needed so neither the auto-provision trigger
  // nor the 4th CTA state (below) fires/flashes before the real status is known.
  const [provision, setProvision] = useState<{ provisioned: boolean; busy: boolean; checked: boolean; projectId?: string }>({ provisioned: false, busy: false, checked: false })
  // #748: whether the most recent provision attempt (auto or manual) hit the
  // transient "not registered yet" state — this company's own landing-page
  // app (a detached background generation) hasn't finished registering, so
  // /api/build/provision genuinely has nothing to attach a cloud project to
  // yet. Distinct from a real failure: surfaced as "still finishing setup"
  // rather than implying anything is broken, since auto-provision is already
  // retrying with backoff in the background.
  const [provisionPending, setProvisionPending] = useState(false)
  // Real visitor count (#483/#563) — was a permanent, hardcoded 0 with the copy
  // "Cody grows these nightly," but nothing ever grew it. Now reads the real
  // count of pageview beacons the generated landing page fires on mount.
  const [visitors, setVisitors] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/build/visitors?slug=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setVisitors(typeof d?.visitors === 'number' ? d.visitors : 0) })
      .catch(() => { if (alive) setVisitors(0) })
    return () => { alive = false }
  }, [companyId])
  // Real waitlist count (#844) — was a permanent, hardcoded 0 even though the
  // hero form already correctly persisted every real signup; nothing ever
  // read it back. Mirrors the visitors fetch above verbatim.
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/build/waitlist?slug=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setWaitlistCount(Array.isArray(d?.entries) ? d.entries.length : 0) })
      .catch(() => { if (alive) setWaitlistCount(0) })
    return () => { alive = false }
  }, [companyId])
  const { status: sessionStatus } = useSession()
  const signedIn = sessionStatus === 'authenticated'
  const [planStatus, setPlanStatus] = useState<string | null>(null)
  // Active PAID subscription tier (#241) — drives the "On {plan}" banner + gates.
  const activePlan = state.activePlan
  const gates = planUnlocks(activePlan)
  // Existing-subscriber recognition (#251): if the signed-in user ALREADY has an
  // AINative paid plan, hydrate activePlan from it so we never ask them to pay
  // again. Runs once when signed in and no plan is set yet.
  useEffect(() => {
    if (!signedIn || activePlan) return
    fetch('/api/build/subscription/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.plan) dispatch({ type: 'SET_ACTIVE_PLAN', plan: d.plan }) })
      .catch(() => {})
  }, [signedIn, activePlan, dispatch])

  // Trial state (#207): an unpaid company runs on a 72h tmp_ project. We surface a
  // countdown + upgrade CTA so the founder has an obvious, intuitive path to pay.
  const [trial, setTrial] = useState<{ trial: boolean; trialExpiresAt?: string | null; trialExpired?: boolean } | null>(null)
  useEffect(() => {
    if (activePlan) return // already paid — no trial banner
    fetch(`/api/build/provision?slug=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setTrial({ trial: !!d.trial, trialExpiresAt: d.trialExpiresAt, trialExpired: !!d.trialExpired }) })
      .catch(() => {})
  }, [companyId, activePlan])
  // Hours left in the trial (null if not a trial / no expiry).
  const trialHoursLeft = trial?.trialExpiresAt
    ? Math.max(0, Math.round((new Date(trial.trialExpiresAt).getTime() - Date.now()) / 3.6e6))
    : null
  // The upgrade path: go to the Pricing screen (real Stripe checkout). Anonymous
  // users sign up first (they return to Live), then upgrade.
  const goUpgrade = () => {
    // GA4 funnel step 4 — the founder clicked upgrade (intent to pay).
    trackEvent('upgrade_clicked', 'funnel', signedIn ? 'signed_in' : 'anonymous')
    if (!signedIn) { dispatch({ type: 'GOTO_SCREEN', screen: 'signup' }); return }
    dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })
  }

  // Manage plan/billing (#251 · #253): open the real Stripe customer portal so a
  // paying founder can see/change/cancel their plan — not a dead /settings route.
  // Falls back to the my-companies index if the portal can't be opened.
  const manageBilling = async () => {
    try {
      const r = await fetch('/api/build/subscription/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: window.location.href }),
      })
      const d = await r.json().catch(() => null)
      if (d?.url) { window.location.href = d.url; return }
    } catch { /* fall through */ }
    dispatch({ type: 'GOTO_SCREEN', screen: 'companies' })
  }

  // Claim the {slug}.ainative.studio subdomain (#78) — paid-gated. Sends the claim,
  // and on success flips the UI so links begin using the real subdomain. Not-paid →
  // route the founder to upgrade (the claim is server-gated on the persisted plan).
  const claimSubdomainAction = async () => {
    if (claiming || subdomainClaimed) return
    if (!activePlan) { goUpgrade(); return }
    setClaiming(true)
    try {
      const r = await fetch('/api/build/claim-subdomain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId }),
      })
      if (r.ok) { setSubdomainClaimed(true); return }
      const d = await r.json().catch(() => null)
      if (d?.reason === 'not_paid') goUpgrade()
    } catch { /* leave state unchanged; button stays available to retry */ }
    finally { setClaiming(false) }
  }

  // Early email capture — save/share the company by email (no account needed) so an
  // anonymous non-converter becomes a reachable lead. Fires a GA4 lead event.
  const saveByEmail = async () => {
    const email = leadEmail.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || leadSaved) return
    setLeadSaved(true) // optimistic
    trackEvent('lead_captured', 'funnel', state.track)
    // Meta Pixel Lead (mirrors GA4). event_id matches the server CAPI Lead so Meta
    // dedups the browser/server pair. No-op if the pixel isn't configured.
    trackMeta('Lead', { value: 5, currency: 'USD', content_name: companyId }, `lead-${companyId || 'anon'}`)
    try {
      await fetch('/api/build/lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, slug: companyId, idea: state.idea, brand: company, track: state.track }),
      })
    } catch { /* optimistic UI already set */ }
  }

  // Post-checkout subscription fulfillment (#241): Stripe returns to
  // /build/{slug}?upgraded=1&session_id=…; verify it server-side (never trust the
  // URL alone), then unlock the plan. Runs once; strips the params so a refresh
  // doesn't re-verify.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('upgraded') !== '1') return
    const sess = params.get('session_id')
    const clean = new URL(window.location.href)
    clean.searchParams.delete('upgraded'); clean.searchParams.delete('session_id'); clean.searchParams.delete('plan')
    window.history.replaceState({}, '', clean.toString())
    if (!sess) return
    setPlanStatus('Activating your plan…')
    fetch('/api/build/subscription/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sess, slug: companyId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d?.plan) {
          dispatch({ type: 'SET_ACTIVE_PLAN', plan: d.plan as ActivePlan, enrolled: d.enrolled })
          if (d.enrolled) setEnrolled(true)
          setPlanStatus(`✓ You're on ${d.planName || d.plan}. Cody just unlocked it.`)
          // GA4 funnel step 6 — CONVERSION: subscription verified + unlocked. This
          // is the primary conversion event to import as a Google Ads conversion.
          trackEvent('subscribed', 'conversion', String(d.plan))
          // Meta Pixel Purchase (mirrors GA4). event_id matches the server CAPI
          // Purchase (`purchase-<slug>-<sessionId>`) so Meta dedups the pair.
          trackMeta(
            'Purchase',
            { value: PLAN_META_VALUE[String(d.plan)] ?? 49, currency: 'USD', content_name: String(d.plan) },
            `purchase-${companyId || 'anon'}-${sess}`,
          )
        } else {
          setPlanStatus(d?.error === 'not verified' ? 'Payment is still processing — refresh in a moment.' : (d?.error || 'Could not confirm your plan yet.'))
        }
      })
      .catch(() => setPlanStatus('Payment received — finishing plan setup shortly.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hydrate idea/appSub from the SERVER registry when a fresh mount has neither
  // (#660). A new tab, a bookmark, a page reload, or a returning founder days
  // later all arrive with state.idea/state.appSub empty — client-only reducer
  // state, never re-hydrated from anywhere before this. The effect below (real
  // landing-page + real-product generation triggers) gates on both fields
  // being non-empty, so on every one of those fresh-load cases it silently
  // never fired — confirmed live: 20/20 real companies on the account owner's
  // own account had never once had product generation run. resolveApp's
  // `idea` field (persisted at registration, see app-registry.ts) is the
  // durable source this hydrates from.
  useEffect(() => {
    if (state.idea || !companyId) return
    let alive = true
    fetch(`/api/build/resolve-app?slug=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.idea) return
        dispatch({ type: 'RESTORE_BUILD', partial: { idea: d.idea, appSub: d.slug || companyId } })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [companyId, state.idea, dispatch])

  // Hydrate the persisted comms-mode selection (#743) so a returning founder
  // sees their real saved choice, not always the default. Separate from the
  // idea-hydration effect above (that one gates on !state.idea; this needs to
  // run regardless, on every mount for this company).
  useEffect(() => {
    if (!companyId) return
    let alive = true
    fetch(`/api/build/resolve-app?slug=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        if (d?.commsMode === 'agile' || d?.commsMode === 'pairProgramming') setCommsMode(d.commsMode)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [companyId])

  // Real business-systems state for this company (honest zero-state for a fresh
  // company; real counts when its ZeroDB has data). Never fabricated.
  // idea is passed so the systems route can select primitives for this specific company (#288).
  useEffect(() => {
    let alive = true
    fetch(`/api/build/systems?companyId=${encodeURIComponent(companyId)}&idea=${encodeURIComponent(state.idea || '')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.systems) setSystems(d.systems) })
      .catch(() => { /* keep the zero-state default */ })
    // Provisioning status — does this company have a real per-company ZeroDB project yet? (#243)
    // Also carries the persisted deploy URL (#279): a real {slug}.ainative.studio host
    // when the wildcard is configured, else the durable preview subdir.
    fetch(`/api/build/provision?slug=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setProvision((p) => ({ ...p, provisioned: !!d?.provisioned, checked: true, projectId: d?.zerodbProjectId || undefined }))
        if (d?.deployUrl) setDeployUrl(String(d.deployUrl))
        if (d?.zerovoiceE164) setZerovoiceE164(String(d.zerovoiceE164))
      })
      .catch(() => { if (alive) setProvision((p) => ({ ...p, checked: true })) })
    // Company track has no /preview app — generate a REAL landing-page app for it
    // once, so the prod URL /build/{slug} actually shows something. Register it.
    //
    // Real bug fixed live (2026-09-13): company-app used to hold this HTTP
    // request open until the generation finished, bounded by its own 280s
    // timeout — but a real generation can now legitimately exceed that once
    // the cody-cli agent's own 240s wall-clock limit (#350) is spent on a
    // failing attempt before falling back. The abort fired before
    // registration ever ran, so appReady silently never flipped even though
    // the generation succeeded (confirmed live: real showcase entries with
    // no corresponding app-registry row). company-app now mirrors
    // company-product's own fix below exactly: detached background
    // generation, 'processing' returned immediately, poll resolve-app.
    if (!state.appChatId && state.idea && state.appSub) {
      const MAX_APP_POLL_ATTEMPTS = 60 // ~5 min at 5s apart — matches company-product's own budget
      const pollForApp = (n: number) => {
        fetch(`/api/build/resolve-app?slug=${encodeURIComponent(state.appSub)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!alive) return
            if (d?.chatId) { setAppReady(true); dispatch({ type: 'SET_APP_CHATID', chatId: d.chatId }); return }
            if (n < MAX_APP_POLL_ATTEMPTS) setTimeout(() => { if (alive) pollForApp(n + 1) }, 5000)
          })
          .catch(() => {
            if (n < MAX_APP_POLL_ATTEMPTS) setTimeout(() => { if (alive) pollForApp(n + 1) }, 5000)
          })
      }
      fetch('/api/build/company-app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: state.idea, slug: state.appSub, name: company,
          tagline: state.brandTagline, color: state.brandColor,
          // Real gap (customer-reported, Meridian, 2026-09-10): the Company
          // track's one real generated app never forwarded a chosen design
          // system at all — it silently fell back to plain Inter/Poppins
          // defaults regardless of what the founder picked on the (now
          // shared, see PICK_TRACK) Design step.
          designSystemId: state.designSystemId || undefined,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return
          // A cached/recovered hit resolves the chatId immediately, no polling.
          if (d?.chatId) { setAppReady(true); dispatch({ type: 'SET_APP_CHATID', chatId: d.chatId }); return }
          if (d?.status === 'processing') pollForApp(1)
        })
        .catch(() => { if (alive) pollForApp(1) })
    }
    // Real gap (customer-reported, Meridian, 2026-09-10, issue #620): the
    // landing page above is marketing copy — it was never the founder's
    // ACTUAL product. Build that separately, with primitive compliance
    // fully enforced (no landingPageOnly), registered under its own
    // {slug}-product entry so it never collides with the landing page.
    //
    // Real bug found live (issue #629/#631/#633): with primitive compliance
    // ON, a genuine product generation can trigger chat-ws's own obedience-
    // repair pass (a SECOND model call), and Railway's edge proxy sits in
    // FRONT of this container with its own hard request timeout around 300s
    // that no server-side maxDuration/AbortSignal tuning can control —
    // confirmed live: a generation that had genuinely SUCCEEDED server-side
    // (real /api/primitive/zeropipeline + /api/primitive/zerovoice calls in
    // the persisted code) still came back as a 502 at the 300s mark, because
    // the route used to hold one HTTP connection open the whole time.
    // company-product now kicks off generation as a detached background
    // task and returns 'processing' immediately; poll resolve-app instead of
    // racing a proxy timeout the client doesn't control.
    if (!state.productChatId && state.idea && state.appSub) {
      const productSlug = `${state.appSub}-product`
      const MAX_POLL_ATTEMPTS = 60 // ~5 min at 5s apart — a real generation + repair round-trip can take several minutes
      const pollForProduct = (n: number) => {
        fetch(`/api/build/resolve-app?slug=${encodeURIComponent(productSlug)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!alive) return
            if (d?.chatId) { dispatch({ type: 'SET_PRODUCT_CHATID', chatId: d.chatId }); return }
            if (n < MAX_POLL_ATTEMPTS) setTimeout(() => { if (alive) pollForProduct(n + 1) }, 5000)
          })
          .catch(() => {
            if (n < MAX_POLL_ATTEMPTS) setTimeout(() => { if (alive) pollForProduct(n + 1) }, 5000)
          })
      }
      fetch('/api/build/company-product', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: state.idea, slug: state.appSub, name: company,
          designSystemId: state.designSystemId || undefined,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return
          // A cached hit resolves the chatId immediately without any polling.
          if (d?.chatId) { dispatch({ type: 'SET_PRODUCT_CHATID', chatId: d.chatId }); return }
          if (d?.status === 'processing') pollForProduct(1)
        })
        .catch(() => { if (alive) pollForProduct(1) })
    }
    // The visible nightshift — the real last nightly run + morning summary.
    fetch(`/api/build/nightshift?companyId=${encodeURIComponent(companyId)}&idea=${encodeURIComponent(state.idea)}&companyName=${encodeURIComponent(company)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setNightshift(d) })
      .catch(() => { /* honest: no card if unavailable */ })
    return () => { alive = false }
    // #660: re-run once idea/appSub become known — either populated at mount
    // (the original build session) or hydrated moments later by the effect
    // above (a fresh page load/new tab/returning visit). Every fetch this
    // effect fires is a safe, idempotent GET or an already-guarded
    // (!state.appChatId / !state.productChatId) generation POST, so a
    // second fire once hydration lands is harmless, not wasteful churn.
  }, [companyId, state.idea, state.appSub])

  // Custom domain (#240): read the purchased domain off the app-registry entry so
  // the dashboard shows "Live at {domain}". If a fulfillment just completed
  // (?domain_session in the URL → DomainModal PUT persists it), re-check shortly
  // after so the new domain surfaces without a manual reload.
  useEffect(() => {
    let alive = true
    const readDomain = () =>
      fetch(`/api/build/register-app?slug=${encodeURIComponent(companyId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive || !d?.entry) return
          if (d.entry.domain) setCustomDomain(String(d.entry.domain))
          setSubdomainClaimed(d.entry.subdomainClaimed === true)
          if (d.entry.zeroinvoiceConnectClickedAt) setZeroInvoiceClickedAt(String(d.entry.zeroinvoiceConnectClickedAt))
          if (d.entry.zeroinvoiceConnectConfirmedAt) setZeroInvoiceConfirmedAt(String(d.entry.zeroinvoiceConnectConfirmedAt))
        })
        .catch(() => { /* honest: no custom-domain line if unavailable */ })
    readDomain()
    // A fulfillment redirect just landed — the PUT that persists the domain races
    // with this read, so poll a few times to pick it up once it lands.
    const justFulfilled = typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('domain_session')
    const timers: ReturnType<typeof setTimeout>[] = []
    if (justFulfilled) {
      for (const delay of [4000, 10000, 20000]) timers.push(setTimeout(readDomain, delay))
    }
    return () => { alive = false; timers.forEach(clearTimeout) }
  }, [companyId])

  // The persisted deploy URL is a REAL dedicated host (#279) only when it's a full
  // https:// URL that is NOT the durable preview subdirectory (…/build/{slug}). When
  // AINATIVE_WILDCARD_HOST is set, that's https://{slug}.ainative.studio; absent the
  // env, provision persists the preview subdir instead, which we must NOT surface as
  // a standalone host (it isn't CNAME-pointable and is the same as /build/{slug}).
  //
  // Product rule (#78): the {slug}.ainative.studio subdomain must NOT surface (and
  // does NOT resolve — the middleware 301s it to the path) until the company is on a
  // PAID plan AND has explicitly CLAIMED the subdomain. Until then we keep every link
  // on the /build/{slug} path form. A purchased custom domain (#240) is unaffected —
  // it has its own resolution path and still wins below.
  const subdomainReady = !!activePlan && subdomainClaimed
  const wildcardHost =
    subdomainReady && deployUrl && /^https?:\/\//i.test(deployUrl) && !/\/build\//.test(deployUrl)
      ? deployUrl.replace(/\/+$/, '')
      : null

  // The address the company is live at, in priority order (#279):
  //  1. purchased custom domain (#240) — always wins.
  //  2. a real {slug}.ainative.studio wildcard host, when provisioned.
  //  3. the durable /build/{slug} subdirectory fallback.
  const liveHref = customDomain
    ? `https://${customDomain}`
    : wildcardHost || appPath
  const liveLabel = customDomain
    ? customDomain
    : wildcardHost
      ? wildcardHost.replace(/^https?:\/\//i, '')
      : url
  // The AINative-hosted prod address label, independent of any purchased custom
  // domain (#279): the {slug}.ainative.studio wildcard host when provisioned, else
  // the durable /build/{slug} subdir. Shown on the infra "prod:" line so it's always
  // the real platform host (a custom domain, if any, gets its own "live at:" line).
  const prodLabel = wildcardHost ? wildcardHost.replace(/^https?:\/\//i, '') : url

  // Masthead status (#259): "Cody is on watch" is only true once the company is
  // actually claimed/enrolled or on a plan — otherwise it contradicts the funnel's
  // "Claim {company} free". Unclaimed companies get a neutral "Preview" status.
  const onWatch = signedIn && (enrolled || !!activePlan)

  // Reach the real artifact graph from Live (returns to the workspace on the graph view).
  const openGraph = () => {
    dispatch({ type: 'GOTO_VIEW', view: 'graph' })
    dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })
  }
  // Re-scoping the wedge is a real upstream edit with downstream impact → show
  // an intent-setting lead-in first (#286) so the founder understands what will
  // change before seeing the dependency conflict gate.
  const rescopeWedge = () => {
    dispatch({ type: 'TRIGGER_CONFLICT', changedView: state.track === 'company' ? 'wedge' : 'prd', fromRescopeIntent: true })
    dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })
  }

  // Hydrate the persisted Cody conversation on mount (#52) so reload/re-login
  // restores the thread exactly where the founder left off — not an empty box.
  // The GET scopes by the SERVER session (owner) + companyId; an honest empty
  // thread is returned for a brand-new company. Re-runs if the company changes.
  useEffect(() => {
    let alive = true
    setChatLoaded(false)
    const qs = new URLSearchParams({ companyId, companyName: company, idea: state.idea || '' })
    fetch(`/api/build/ask?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        const turns: { role: string; text: string }[] = Array.isArray(d?.turns) ? d.turns : []
        if (turns.length) {
          setChat(
            turns
              .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && t.text)
              .map((t) => ({ role: t.role === 'user' ? 'user' : 'cody', text: String(t.text) })),
          )
        }
        // #608: "where we left off" handoff summary — a returning founder sees
        // this instead of having to re-read/re-explain the raw chat history.
        if (d?.summary) setChatSummary(String(d.summary))
        // #693: "what Cody has learned" — a synthesized ZeroMemory profile.
        // Only set when there's something real to show (a summary, or at
        // least one preference/behavior/fact) — never render an all-empty
        // card while memories are still accumulating.
        if (d?.profile && (d.profile.summary || d.profile.preferences?.length || d.profile.behaviors?.length || d.profile.facts?.length)) {
          setCompanyProfile({
            summary: d.profile.summary || null,
            preferences: Array.isArray(d.profile.preferences) ? d.profile.preferences : [],
            behaviors: Array.isArray(d.profile.behaviors) ? d.profile.behaviors : [],
            facts: Array.isArray(d.profile.facts) ? d.profile.facts : [],
          })
        }
        setChatLoaded(true)
      })
      .catch(() => { if (alive) setChatLoaded(true) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // Attach a file to the chat (#741): upload IMMEDIATELY on selection (via the
  // real, auth-gated /api/build/ask/attachment route — same storage as the
  // Media/Documents panels) so the composer shows a real chip/preview before
  // Send, rather than deferring the upload to send-time.
  const onAttachChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setAttachError('')
    const tempId = `pending-${Date.now()}`
    setPendingAttachments((list) => [
      ...list,
      { fileId: tempId, url: '', contentType: file.type, fileName: file.name, uploading: true },
    ])
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('companyId', companyId)
      const res = await fetch('/api/build/ask/attachment', { method: 'POST', body: fd })
      const d = await res.json().catch(() => null)
      if (res.status === 401) {
        setAttachError('You’ll need to sign in before I can take attachments.')
        setPendingAttachments((list) => list.filter((a) => a.fileId !== tempId))
        return
      }
      if (!res.ok || !d?.fileId) {
        setAttachError(d?.message || 'I couldn’t attach that file — try again.')
        setPendingAttachments((list) => list.filter((a) => a.fileId !== tempId))
        return
      }
      setPendingAttachments((list) =>
        list.map((a) => (a.fileId === tempId ? { fileId: d.fileId, url: d.url, contentType: d.contentType, fileName: d.fileName } : a)),
      )
    } catch {
      setAttachError('Connection hiccup — try attaching again.')
      setPendingAttachments((list) => list.filter((a) => a.fileId !== tempId))
    }
  }

  const removeAttachment = (fileId: string) => {
    setPendingAttachments((list) => list.filter((a) => a.fileId !== fileId))
  }

  const ask = async () => {
    const q = msg.trim()
    const ready = pendingAttachments.filter((a) => !a.uploading && a.fileId && a.url)
    if ((!q && ready.length === 0) || asking) return
    if (pendingAttachments.some((a) => a.uploading)) return // still uploading — wait
    const attachmentsForTurn: ChatAttachment[] = ready.map(({ fileId, url, contentType, fileName }) => ({ fileId, url, contentType, fileName }))
    setChat((c) => [...c, { role: 'user', text: q, attachments: attachmentsForTurn.length > 0 ? attachmentsForTurn : undefined }])
    setMsg('')
    setPendingAttachments([])
    setAsking(true)
    try {
      const res = await fetch('/api/build/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          idea: state.idea,
          companyName: company,
          track: state.track,
          companyId,
          attachments: attachmentsForTurn.length > 0 ? attachmentsForTurn : undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      setChat((c) => [...c, { role: 'cody', text: data?.answer || "I couldn't reach my brain just now — try again in a moment." }])
    } catch {
      setChat((c) => [...c, { role: 'cody', text: 'Connection hiccup — ask me again.' }])
    } finally {
      setAsking(false)
    }
  }

  // Enroll the company into Cody's nightly loop (a paid capability). Called
  // automatically once a plan is active; not a standalone CTA anymore (the upgrade
  // path is goUpgrade → Pricing → Stripe).
  const enrollNightly = async () => {
    if (!signedIn || enrolled) return
    setEnrolled(true) // optimistic
    try {
      await fetch('/api/build/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: state.appSub || company.toLowerCase().replace(/\s+/g, '-'),
          companyName: company,
          track: state.track,
          goal: state.answers?.privacy,
        }),
      })
    } catch { /* optimistic UI already set */ }
  }
  // Auto-enroll into the nightly loop once on a plan that includes it.
  useEffect(() => {
    if (activePlan && gates.nightlyLoop && !enrolled) enrollNightly()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlan])

  // Persist a comms-mode change (#743) — optimistic-then-persist, same shape
  // as enrollNightly(). Requires sign-in (the route 401s for guest/anon).
  const changeCommsMode = async (mode: 'agile' | 'pairProgramming') => {
    if (!signedIn || mode === commsMode || commsModeSaving) return
    const previous = commsMode
    setCommsMode(mode) // optimistic
    setCommsModeSaving(true)
    try {
      const res = await fetch('/api/build/comms-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId, mode }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) setCommsMode(previous) // revert on a real failure
    } catch {
      setCommsMode(previous) // revert — the request never landed
    } finally {
      setCommsModeSaving(false)
    }
  }

  // Provision the persistent cloud for this company (#243): a real per-company
  // ZeroDB project + persistent deploy target. Requires an account (the project
  // is owned by the founder). Refreshes the systems grid to read real data after.
  //
  // #748 follow-up (found via real Playwright verification against prod, not
  // assumed): a BRAND-NEW company's registry row (builder_app_registry, keyed
  // by chatId) is written by the DETACHED background /api/build/company-app
  // generation this same screen kicks off — which can take real minutes (its
  // own poll budget is ~5 min). /api/build/provision 404s with reason
  // 'not_registered' until that lands. This is a TRANSIENT state, not a real
  // failure — the auto-provision effect below must retry through it rather
  // than giving up after one attempt, or a founder on a genuinely fresh
  // company falls back to a banner whose CTA also just silently fails.
  const provisionCompany = async (): Promise<'ok' | 'not_registered' | 'error'> => {
    if (provision.busy || provision.provisioned) return 'ok'
    if (!signedIn) { dispatch({ type: 'GOTO_SCREEN', screen: 'signup' }); return 'error' }
    setProvision((p) => ({ ...p, busy: true }))
    try {
      const res = await fetch('/api/build/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId, name: company, plan: state.plan }),
      })
      const d = await res.json().catch(() => null)
      if (d?.ok) {
        setProvision({ provisioned: true, busy: false, checked: true, projectId: d.zerodbProjectId })
        setProvisionPending(false)
        // Re-read systems now that they point at the real provisioned project.
        fetch(`/api/build/systems?companyId=${encodeURIComponent(companyId)}&idea=${encodeURIComponent(state.idea || '')}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => { if (s?.systems) setSystems(s.systems) })
          .catch(() => {})
        return 'ok'
      }
      setProvision((p) => ({ ...p, busy: false, checked: true }))
      const notRegistered = d?.reason === 'not_registered'
      setProvisionPending(notRegistered)
      return notRegistered ? 'not_registered' : 'error'
    } catch {
      setProvision((p) => ({ ...p, busy: false, checked: true }))
      return 'error'
    }
  }

  // #748: auto-provision on first real engagement, so a founder never needs to
  // find the "Provision cloud" button buried in the infrastructure card. Real
  // incident: an admin-created company ("Clearpath") had a live, reachable
  // dashboard but was NEVER provisioned — no owner, no ZeroDB project, no
  // primitives, no auth — because provisioning only ever happened via that one
  // manual button. Fires the first time we know for sure (via the GET above,
  // `checked: true`) that a SIGNED-IN founder's company is not yet
  // provisioned, and RETRIES with backoff on a 'not_registered' response
  // (real, live-observed race: a brand-new company's registry row is written
  // by the detached background company-app generation this screen kicks off,
  // which can take real minutes — the first auto-provision attempt landing
  // before that completes must not be treated as a permanent failure).
  // Idempotent by construction: provisionCompany() itself no-ops when
  // `provision.busy || provision.provisioned`, and /api/build/provision's own
  // handler short-circuits on `existing.zerodbProjectId` — so calling this
  // more than once (re-render, re-mount, StrictMode double-invoke, or a
  // retry) is safe.
  const autoProvisionAttemptsRef = useRef(0)
  const autoProvisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const MAX_AUTO_PROVISION_ATTEMPTS = 8 // ~1min + 2+3+4+5+6+7+8min backoff ≈ covers company-app's ~5min budget with margin
  useEffect(() => {
    if (!signedIn || !companyId) return
    if (!provision.checked || provision.provisioned || provision.busy) return
    if (autoProvisionTimerRef.current) return // a retry is already scheduled
    if (autoProvisionAttemptsRef.current >= MAX_AUTO_PROVISION_ATTEMPTS) return

    const attempt = async () => {
      autoProvisionAttemptsRef.current += 1
      const result = await provisionCompany()
      if (result === 'not_registered' && autoProvisionAttemptsRef.current < MAX_AUTO_PROVISION_ATTEMPTS) {
        // Linear backoff (1min, 2min, 3min, …) — company-app generation is a
        // real background LLM+deploy pipeline, not a fast operation.
        autoProvisionTimerRef.current = setTimeout(() => {
          autoProvisionTimerRef.current = null
          attempt()
        }, autoProvisionAttemptsRef.current * 60_000)
      }
    }
    attempt()

    return () => {
      if (autoProvisionTimerRef.current) { clearTimeout(autoProvisionTimerRef.current); autoProvisionTimerRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, companyId, provision.checked, provision.provisioned, provision.busy])

  // FIX-5: per-project brand color so every company's dashboard looks distinct,
  // not identical. Falls back to the track accent.
  const brandStyle = state.brandColor && /^#[0-9a-fA-F]{6}$/.test(state.brandColor)
    ? ({ ['--m-brand' as string]: state.brandColor } as React.CSSProperties)
    : undefined

  // #754: the chat rail below is `position: sticky` and needs to know the
  // REAL, dynamic height of everything rendered above `.m-live-grid`
  // (masthead + funnel/provisioning banner + product card + hero metrics —
  // several states, several real heights) rather than assume a hardcoded
  // constant. `headerRef` wraps that whole block; `containerRef` (the outer
  // `.m-live` element) receives the measured height as `--live-header-h`,
  // which the sticky CSS reads instead of a literal px value.
  const { headerRef, containerRef } = useHeaderHeightVar<HTMLDivElement, HTMLDivElement>()

  // #805 (4th recurrence of the grey-region-on-scroll bug, after #484/#754/
  // #803): the left and middle columns of .m-live-grid size independently
  // (align-items:start) and are never equal height, so whichever is shorter
  // exposes the grid's own grey divider background below it. Measures both
  // columns' real rendered height and forces them to a shared floor.
  // #842 (5th recurrence): pass `containerRef` (the outer `.m-live` element,
  // already used by useHeaderHeightVar above) as the write target so the
  // shared --live-col-min-h var reaches the chat column too, via normal
  // CSS custom-property inheritance from a real ancestor — writing it only
  // on the left/middle columns (siblings of the chat column) never reached
  // it. See useEqualColumnHeight's own comment for the full mechanism.
  const { leftColRef, middleColRef } = useEqualColumnHeight<HTMLDivElement>(undefined, containerRef)

  return (
    <div className="modernist m-live" data-track="company" style={brandStyle} ref={containerRef}>
      <div ref={headerRef}>
      <header className="m-live-masthead" style={brandStyle ? { background: 'var(--m-brand)' } : undefined}>
        <span className="m-mono m-live-tag">Company Track · shipped</span>
        <h1 className="m-artifact m-live-h">{company} is live.</h1>
        {/* One-line status (#65): plain "what you have / what's happening" so the view is not opaque. */}
        <p className="m-live-status-line" data-testid="live-status-line">
          {liveStatusLine(company, onWatch)}
        </p>
        {/* Per-company activity ribbon (#340): while an Auto Mode run is active,
            the latest run event in Cody's mono voice — THIS company's swarm, not
            the platform-wide proof (which stays, below the grid). */}
        {runRibbon && (
          <p className="m-mono m-live-status-line" data-testid="auto-run-ribbon" style={{ opacity: 0.85 }}>
            <span className="m-glyph">◇</span> {runRibbon}
          </p>
        )}
        <div className="m-live-masthead-right">
          <span className={`m-mono m-live-watch ${onWatch ? '' : 'is-preview'}`}>
            <span className="m-live-dot" /> {onWatch ? 'Cody is on watch' : 'Preview mode'}
          </span>
          <a className="m-mono m-live-url" href={liveHref} target="_blank" rel="noreferrer">
            {appReady ? `${customDomain ? 'Live at ' : ''}${liveLabel} ↗` : 'building your site…'}
          </a>
          {/* Polsia-parity account MENU on the operating dashboard. */}
          <MenuChip />
        </div>
      </header>

      {/* Upgrade path (#207 · #252 · #748). FOUR states, always giving an OBVIOUS
          next step (the gap the founder hit — "couldn't figure out how to pay",
          and later "never got provisioned at all"):
            1. On a paid plan → "On {plan}" + Manage plan.
            2. Signed in, unpaid, NOT YET PROVISIONED → honest "setting up" state
               (#748) — distinct from state 3 below, which wrongly assumed a
               trial (and therefore provisioning) already existed. Auto-
               provisioning (see the effect above) should clear this quickly for
               almost everyone; this is the defensive fallback for whatever
               window it takes, or for the rare case auto-provisioning itself
               fails, so the founder ALWAYS has a real next step instead of
               copy/a CTA built on a false assumption.
            3. Signed in, unpaid, provisioned → trial countdown + a real Upgrade
               button → Pricing (Stripe).
            4. Anonymous → claim/sign-up (then they return here and can upgrade). */}
      {activePlan ? (
        <div className="m-live-funnel is-plan">
          <span>
            <strong>On {PLAN_LABEL[activePlan] || activePlan}.</strong>{' '}
            {gates.swarm
              ? 'The full agent swarm is running your company.'
              : gates.nightlyLoop
                ? 'Cody runs the nightly loop on your company — enrolled.'
                : 'Cody is building and running your company. Custom domains unlocked.'}
          </span>
          <div className="m-live-funnel-cta">
            <span className="m-chip">✓ {PLAN_LABEL[activePlan] || activePlan}</span>
            {activePlan === 'enterprise' ? (
              // Real gap (customer-reported, 2026-09-09, Vamsi/Ledra+Pathlo+
              // Voya): Enterprise billing is a contract/invoice relationship
              // on the AINative dashboard, not a Builder-side Stripe
              // customer — Builder's own portal has nothing to open here.
              <a className="btn-ghost" data-testid="manage-plan-ainative" href="https://ainative.studio/billing" target="_blank" rel="noopener noreferrer">Manage on ainative.studio ↗</a>
            ) : (
              <button className="btn-ghost" data-testid="manage-plan" onClick={manageBilling}>Manage plan ↗</button>
            )}
          </div>
        </div>
      ) : signedIn && !provision.provisioned ? (
        <div className="m-live-funnel is-provisioning" data-testid="provisioning-banner">
          <span>
            <strong>{company} is yours — setting it up now.</strong>{' '}
            {provisionPending
              ? "Still finishing your company's initial build — cloud setup will pick up automatically the moment that's done. No action needed."
              : provision.busy || !provision.checked
                ? "Cody is provisioning your real cloud (database, primitives) — this happens automatically, no action needed."
                : "Nothing's been provisioned yet. Click below to set up your real database and primitives now — this normally happens automatically."}
          </span>
          <div className="m-live-funnel-cta">
            <button
              className="btn-primary"
              data-testid="provision-now-cta"
              onClick={provisionCompany}
              disabled={provision.busy}
            >
              {provision.busy ? 'Provisioning…' : provisionPending ? 'Try again →' : 'Provision cloud now →'}
            </button>
          </div>
        </div>
      ) : signedIn ? (
        <div className="m-live-funnel is-trial" data-testid="upgrade-banner">
          <span>
            {trial?.trialExpired ? (
              <><strong>Your free trial ended.</strong> Upgrade to bring {company} back online — you own 100%: real domain, real database, no revenue share.</>
            ) : trialHoursLeft != null ? (
              <><strong>Free trial: {trialHoursLeft}h left.</strong> Upgrade to keep {company} running for real — real domain, real database, you own 100% (no revenue share).</>
            ) : (
              <><strong>{company} is yours.</strong> Make it real — Cody runs it 24/7, on your own domain + database. You own 100%, no revenue share.</>
            )}
          </span>
          <div className="m-live-funnel-cta">
            <button className="btn-primary" data-testid="upgrade-cta" onClick={goUpgrade}>Upgrade {company} →</button>
          </div>
        </div>
      ) : (
        <div className="m-live-funnel" data-testid="signup-banner">
          <span>
            <strong>{company} is yours.</strong> {leadSaved ? "Saved — we'll email you a link to pick it back up." : 'Save it — get a link to your company and keep building. Cody runs it 24/7, and you own 100%.'}
          </span>
          <div className="m-live-funnel-cta">
            {leadSaved ? (
              <button className="btn-primary" data-testid="claim-cta" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}>Claim {company} free →</button>
            ) : (
              <>
                {/* Early email capture — save/share before the upgrade wall (#207). */}
                <input
                  className="m-lead-email"
                  type="email"
                  data-testid="lead-email"
                  placeholder="you@company.com"
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveByEmail()}
                  aria-label="Email to save your company"
                />
                <button className="btn-primary" data-testid="save-email" disabled={!leadEmail.trim()} onClick={saveByEmail}>Save {company} →</button>
              </>
            )}
            <button className="btn-ghost" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'login' })}>Log in</button>
          </div>
        </div>
      )}
      {planStatus && <p className="m-mono m-domain-status" style={{ padding: '0 var(--m-pad, 24px)' }}>{planStatus}</p>}

      {/* Real product card (issue #620, customer-reported, Meridian, 2026-09-10):
          the masthead link above is the marketing LANDING PAGE — this is the
          founder's ACTUAL, functional product (real primitives, real data),
          built separately via /api/build/company-product. Distinct, honestly
          labeled card so a founder never confuses the two, and never assumes
          "live" (the landing page) means their real idea is implemented. */}
      <div className="m-live-card" style={{ margin: '0 var(--m-pad, 24px) 16px' }} data-testid="product-card">
        <div className="m-mono m-live-card-h">Your product</div>
        <p className="m-live-card-body">
          {state.productChatId
            ? `${company}'s real, working product — built to actually do what your idea describes.`
            : 'Cody is building the real, working product behind your idea — not just the landing page above.'}
        </p>
        {state.productChatId ? (
          <a
            className="btn-primary"
            data-testid="product-live-link"
            href={`/build/${state.appSub}-product`}
            target="_blank"
            rel="noreferrer"
          >
            Open your product →
          </a>
        ) : (
          <span className="m-mono m-muted" data-testid="product-building">building your product…</span>
        )}
      </div>

      {/* RLHF pulse (#332): rate the built company once it's live. One rating
          per generation (keyed by chatId/slug), dismissible, never blocking. */}
      {state.builtCompany && (
        <div style={{ padding: '0 var(--m-pad, 24px)' }}>
          <FeedbackPulse surface="live" />
        </div>
      )}

      {/* Hero metrics row (#483): the one glanceable "is my company doing
          anything" signal — promoted out of column 1 into a full-width strip
          so it resolves first, above the 3-column grid, instead of being the
          second card down a side column at the same weight as everything
          else. Mobile gets this for free (full-width block stacks first,
          before any column content) — see #486. */}
      <div className="m-live-hero-metrics" data-testid="hero-metrics">
        <div className="m-metric-rows">
          {/* Real visitor + waitlist counts (#483/#563, #844) — the generated
              landing page's own pageview beacon and hero waitlist form, read
              back from this company's ZeroDB project. Revenue remains an
              honest zero-state — no capture mechanism exists yet (tracked
              separately). */}
          <div className="m-metric">
            <span className="m-metric-v m-artifact" data-testid="hero-metric-visitors">{visitors ?? '—'}</span>
            <span className="m-metric-l m-mono">visitors</span>
          </div>
          <div className="m-metric">
            <span className="m-metric-v m-artifact" data-testid="hero-metric-waitlist">{waitlistCount ?? '—'}</span>
            <span className="m-metric-l m-mono">waitlist</span>
          </div>
          <div className="m-metric"><span className="m-metric-v m-artifact">$0</span><span className="m-metric-l m-mono">revenue</span></div>
        </div>
        <p className="m-mono m-metric-note">Live from day one — Cody grows these nightly.</p>
      </div>
    </div>

      <div className={`m-live-grid ${state.tablet ? 'is-tablet' : ''}`}>
        {/* LEFT — Cody status + upsell */}
        <div className="m-live-col" ref={leftColRef}>
          {/* #485: primary weight — this is the one status card in column 1
              a founder should actually read first, vs onboarding/upsell below. */}
          <div className="m-live-card m-live-card--primary">
            <div className="m-mono m-live-card-h">
              <span className="m-glyph">◇</span> Cody · nightly run{' '}
              <span className={`st ${nightshift?.hasRun ? 'is-done' : 'is-running'}`}>
                {nightshift?.hasRun ? 'ran overnight' : enrolled ? 'scheduled tonight' : 'ready'}
              </span>
            </div>
            {nightshift?.hasRun && nightshift.summary ? (
              <p className="m-live-card-body"><strong>This morning:</strong> {nightshift.summary}</p>
            ) : (
              <p className="m-live-card-body">Nightly, I evaluate the company, pick the highest-leverage task, and run it. You&apos;ll get a morning summary.</p>
            )}
            {/* Comms cadence mode (#743): how Cody emails the founder every
                morning — "Agile standup" (yesterday/today/blockers, the
                default) or "Pair programming" (a Gitea commit digest). */}
            <div className="m-live-comms-mode" data-testid="comms-mode-selector">
              <label className="m-mono m-live-comms-mode-label" htmlFor="comms-mode-select">
                Morning email from Cody
              </label>
              <select
                id="comms-mode-select"
                data-testid="comms-mode-select"
                value={commsMode}
                disabled={!signedIn || commsModeSaving}
                onChange={(ev) => changeCommsMode(ev.target.value as 'agile' | 'pairProgramming')}
              >
                <option value="agile">Agile standup</option>
                <option value="pairProgramming">Pair programming</option>
              </select>
            </div>
            <div className="m-live-card-actions">
              <button className="btn-ghost" onClick={openGraph}>Open the artifact graph →</button>
              <button className="btn-ghost" onClick={rescopeWedge}>Re-scope the wedge ⚠</button>
            </div>
          </div>
          {/* Onboarding tutorial video (#51): replaces the raw black-box placeholder.
              Video source is configurable via NEXT_PUBLIC_ONBOARDING_VIDEO_SRC so
              swapping in the real clip is a one-line env change. */}
          <OnboardingVideo />
          <div className="m-live-card m-upsell">
            <div className="m-mono m-live-card-h">
              Hire the swarm
              {swarmActivity.mode !== 'hidden' && (
                <span className="st is-running" data-testid="swarm-live-status" style={{ marginLeft: 8 }}>
                  auto mode
                </span>
              )}
            </div>
            {/* Live run activity (#340): while an Auto Mode run is ACTIVE for this
                company the card shows the run's real event trail — agent-style rows
                (mono title + status glyph ● dispatched / ✓ shipped / · failed) in
                the workspace swarm grammar. Honest warm-up state (real pipeline
                stages) while the run has no events yet; hidden when no run. */}
            {swarmActivity.mode === 'empty' && (
              <p className="m-mono m-metric-note" data-testid="swarm-live-empty">
                {ACTIVITY_EMPTY_LINE}
              </p>
            )}
            {swarmActivity.mode === 'rows' && (
              <div data-testid="swarm-live-rows" style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                {swarmActivity.rows.map((row) => (
                  <div className="m-agent-head" key={`${row.ts}-${row.title}-${row.status}`}>
                    <span className="m-mono m-agent-name">{row.title}</span>
                    <span className={`m-agent-badge ${row.tone}`}>{row.glyph} {row.status}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="m-live-card-body">
              {activePlan
                ? `On ${PLAN_LABEL[activePlan] || activePlan}. ${gates.nightlyLoop ? 'Cody runs the nightly loop on your company.' : 'Cody is building and running your company.'}`
                : enrolled
                  ? 'Enrolled. Cody runs the nightly loop on your company.'
                  : 'Works while you sleep · $49/mo'}
            </p>
            <button className="btn-primary" data-testid="swarm-upgrade" disabled={!!activePlan} onClick={goUpgrade}>
              {activePlan ? `✓ On ${PLAN_LABEL[activePlan] || activePlan}` : 'Upgrade to hire the swarm →'}
            </button>
          </div>
          {/* Business systems (#803): moved here from the middle column, below
              the swarm card — the middle column's ever-growing height (as more
              sections were added over time, against the right column's fixed
              viewport-capped sticky height) was the real cause of a grey region
              appearing/growing as the founder scrolled, a bug that's recurred
              3x (#484, #754, and again) from different specific triggers. */}
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">Business systems</div>
            {/* Total savings vs stand-alone SaaS (#dashboard-ux): sum the comparable
                monthly cost of every system shown, so the founder sees what they'd
                pay to assemble this stack from separate providers — included here.
                #378: spell out "included at no extra cost" plainly — the old
                "included, usage-based" phrasing read as ambiguous (cost vs. value),
                per a real founder's feedback in a usability walkthrough. */}
            {(() => {
              const total = systems.reduce((sum, s) => sum + (s.savedMonthly || 0), 0)
              if (total <= 0) return null
              return (
                <p className="m-system-savings-total" data-testid="systems-savings-total">
                  <s className="m-system-savings-strike">${total}/mo</s> of stand-alone SaaS —{' '}
                  <strong>included at no extra cost</strong>
                </p>
              )
            })()}
            {/* Honest framing line (#67): one sentence on what's real now vs built on upgrade. */}
            {(() => {
              const counts = countSystemStatuses(systems)
              return (
                <p
                  className="m-mono m-system-framing"
                  data-testid="systems-framing-line"
                  style={{ fontSize: 11, color: 'var(--text-body-70)', marginBottom: 10, marginTop: 0 }}
                >
                  {planFramingLine(counts.live, counts.total)}
                </p>
              )
            })()}
            <div className="m-systems m-seams" data-testid="systems-grid">
              {systems.map((s) =>
                // #278: only link when the company has its own provisioned instance URL.
                // Never dump the founder on a primitive marketing site.
                s.url ? (
                  <a key={s.key} className="m-system" href={s.url} target="_blank" rel="noreferrer">
                    <span className="m-system-name">{s.name}</span>
                    <span className="m-system-stat m-mono">{s.stat}</span>
                    <span className="m-chip m-system-prim">{s.primitive}</span>
                    {/* Live/Planned badge (#67): unambiguous status for every system. */}
                    <SystemStatusBadge url={s.url} provisioned={s.provisioned} />
                    <SystemSaving vsProvider={s.vsProvider} savedMonthly={s.savedMonthly} />
                  </a>
                ) : (
                  // #378: this card has no click handler of its own (only the "docs ↗"
                  // link inside is real) — a founder's instinct was to click the
                  // highlighted name itself, since the shared .m-system class made it
                  // look identically clickable to the provisioned/linked card above.
                  // m-system-static drops the pointer cursor + hover affordance so an
                  // inert card no longer masquerades as one.
                  <div key={s.key} className="m-system m-system-static">
                    <span className="m-system-name">{s.name}</span>
                    <span className="m-system-stat m-mono">{s.stat}</span>
                    <span className="m-chip m-system-prim">{s.primitive}</span>
                    {/* Live/Planned badge (#67): replaces ● live / ○ sim text markers. */}
                    <SystemStatusBadge provisioned={s.provisioned} />
                    <SystemSaving vsProvider={s.vsProvider} savedMonthly={s.savedMonthly} />
                    <a className="m-system-learn m-mono" href={s.docUrl} target="_blank" rel="noreferrer">docs ↗</a>
                  </div>
                )
              )}
            </div>
            {/* Connect ZeroInvoice (#506, child of #418) — the real backend has
                existed and been live since #418; this was the only missing piece:
                a real, visible action wired to it. Rendered here (not as a system
                card in the grid above) since ZeroInvoice has no per-company
                provisioned instance URL to link to — it's an explicit one-time
                connect action, not a live-data system card. */}
            <ZeroInvoiceConnect
              companyId={companyId}
              signedIn={signedIn}
              clickedAt={zeroInvoiceClickedAt}
              confirmedAt={zeroInvoiceConfirmedAt}
              onRequireAuth={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}
            />
            {/* Get a phone number (2026-09-16) — the real backend
                (/api/build/zerovoice, correctly tier-gated to ANY paid plan)
                existed with no dashboard entry point at all until now. */}
            <ZeroVoiceConnect
              companyId={companyId}
              signedIn={signedIn}
              isPaidPlan={!!activePlan}
              e164={zerovoiceE164}
              onRequireAuth={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}
            />
          </div>
        </div>

        {/* MIDDLE — tonight + infra. Each section is a real, independently
            collapsible accordion (#803) so a founder can shrink this column's
            rendered height on demand. This alone did not end the recurring
            grey-region-on-scroll bug (#484, #754, #803, #805) — the middle
            and left columns are still sized independently (align-items:start)
            with no shared floor, so whichever is shorter exposes grey below
            it; useEqualColumnHeight (above) is the actual structural fix.
            Sections default OPEN; a founder's collapse choice persists per
            project (lib/build/live-section-prefs.ts). */}
        <div className="m-live-col" ref={middleColRef}>
          {/* Growth (#449, #822, #843) — everything that grows the company: a
              real, funded Meta ad-test campaign, Auto Mode (#58, the paid
              autonomous run), and auto-generated on-brand media (#54, Auto
              Image/Auto Video + founder photo uploads). Leads the middle
              column — a founder asked for Growth to be the FIRST accordion,
              not the last, since it's the primary lever for validating
              product/market fit (real signups/ad performance) rather than
              just continuing to build. These three previously sat split
              across two different accordion sections — Auto Image/Auto
              Video/Auto Mode were structurally trapped inside "Website &
              infrastructure" (behind a plain, non-collapsible "Growth" text
              label that only looked like a section boundary), while the real
              "Growth" CollapsibleSection held just the ad-campaign panel.
              Paid-gated per-panel (any paid plan for ad campaigns, Business+
              for Auto Mode) — does not touch #67 systems / #52 chat / #55
              Tasks / #62 Versions / #64 Documents / #65 masthead / #51 video. */}
          <CollapsibleSection slug={companyId} sectionId="growth" title="Growth">
            {/* #843: automated ad testing leads the section — it's the highest-
                leverage, most-actionable growth lever (a real, funded Meta
                ad-test campaign) and a founder asked for it first, not buried
                after media generation and Auto Mode. */}
            <GrowthPanel
              companyId={companyId}
              companyName={company}
              unlocked={gates.growth}
              onUpgrade={goUpgrade}
            />
            {/* #844: the real signal growth activity is FOR — a founder asked
                "where do I see who joined the waitlist" and there was no
                answer. The hero form already persisted every real signup;
                this is the missing read side. */}
            <WaitlistPanel companyId={companyId} />
            <AutoModePanel
              companyId={companyId}
              companyName={company}
              track={state.track}
              unlocked={gates.nightlyLoop}
              onUpgrade={goUpgrade}
            />
            <MediaPanel
              companyId={companyId}
              companyName={company}
              brandTagline={state.brandTagline}
              brandColor={state.brandColor}
              idea={state.idea}
            />
          </CollapsibleSection>
          {/* Real, stateful Tasks/Backlog (#55) — replaces the hardcoded tonight
              array. Persisted per {owner, company}; surfaces real swarm task_ids
              and the nightly loop's Recurring task. */}
          <CollapsibleSection slug={companyId} sectionId="tasks" title="Tonight">
            <TasksPanel companyId={companyId} />
          </CollapsibleSection>
          <CollapsibleSection slug={companyId} sectionId="infra" title="Website & infrastructure">
            <div className="m-live-card">
              <p className="m-mono m-infra-urls">
                {customDomain && (
                  <><strong>live at: <a href={liveHref} target="_blank" rel="noreferrer">{customDomain}</a></strong><br /></>
                )}
                prod: {prodLabel}
              </p>
              <div className="m-infra-btns">
                <a className="btn-secondary" href={liveHref} target="_blank" rel="noreferrer">View site ↗</a>
                <button className="btn-secondary" onClick={() => setDomainOpen(true)}>
                  {customDomain ? 'Add another domain' : 'Get a custom domain'}
                </button>
                {/* Claim the free {slug}.ainative.studio subdomain (#78) — paid-gated.
                    Until claimed the site is shared via the /build/{slug} path only, and
                    the subdomain does not resolve. Once claimed, links use the subdomain. */}
                {!subdomainClaimed && (
                  <button
                    className="btn-secondary"
                    onClick={claimSubdomainAction}
                    disabled={claiming}
                    data-testid="claim-subdomain-cta"
                    title={activePlan
                      ? `Claim ${companyId}.ainative.studio for this company`
                      : 'Upgrade to a paid plan to claim your subdomain'}
                  >
                    {claiming ? 'Claiming…' : activePlan ? 'Claim subdomain' : 'Claim subdomain (upgrade)'}
                  </button>
                )}
                {/* Provision the real per-company cloud (#243): own ZeroDB project + persistent host. */}
                <button
                  className="btn-secondary"
                  onClick={provisionCompany}
                  disabled={provision.busy || provision.provisioned}
                  title={provision.provisioned ? 'This company has its own ZeroDB project' : 'Create a real per-company ZeroDB project + persistent deploy'}
                >
                  {provision.provisioned ? '✓ Cloud provisioned' : provision.busy ? 'Provisioning…' : 'Provision cloud'}
                </button>
                {/* Redeploy moved into the Website & app panel (#63) — the disabled
                    "Redeploy · soon" placeholder is now a real, health-checked redeploy
                    of the current version. See <WebsitePanel /> below. */}
              </div>
              {provision.provisioned && (
                <p className="m-mono m-metric-note">
                  Own ZeroDB project · Pipeline & Invoices read live data.
                  {zerovoiceE164 ? ' Voice/SMS is real — see ZeroVoice below.' : ' Helpdesk & Voice still simulated.'}
                </p>
              )}
            </div>
            {/* Deploy version history + one-click rollback (#62) — each deploy of the
                company app is a version (message + SHA + timestamp, CURRENT badge on
                the live one); REVERT rolls the live site back via Railway with a
                confirmation + honest rolling-back → validating → live status. A new,
                distinct section — does not touch #67 systems / #55 Tasks / #52 chat. */}
            {/* #378: no visual grouping existed between the dev/build-ops panels below
                and the business-ops/growth panels further down — a founder said they
                visually "blend together." Section labels reuse the existing
                .m-website-section-h mono-caps treatment already used inside
                WebsitePanel, so this doesn't introduce a new visual language. */}
            <div className="m-mono m-website-section-h" data-testid="section-build-ops" style={{ marginTop: 4 }}>Build ops</div>
            <VersionsPanel companyId={companyId} />
            {/* Website / App management (#63) — Redeploy the current version
                (health-checked "redeploying → validating → live", finishing the old
                disabled "Redeploy · soon" placeholder), runtime Secrets (view/add/
                edit/delete masked env vars, owner-only), and Database Download (export
                the company's OWN ZeroDB data as JSON/CSV — "you own 100%"). Owner-only
                ops are gated on a paid plan. A NEW, distinct section — does not touch
                #67 systems / #52 chat / #55 Tasks / #62 Versions / #64 Documents / #65
                masthead / #51 video / #54 media / #58 auto-mode. Manage Domain (#53),
                Versions (#62) and Tasks (#55) keep their own panels — linked, not duplicated. */}
            <WebsitePanel
              companyId={companyId}
              canManage={signedIn && !!activePlan}
              onRequireUpgrade={goUpgrade}
            />
            {/* Persistent Documents library (#64) — the company's durable Documents
                (Research / Product Roadmap / Mission / Market Research) + time-series
                Reports (the daily/nightly operational report). Persisted per
                {owner, company}; VIEW renders structured markdown. A new, distinct
                section — does not touch #67 systems / #52 chat / #55 Tasks / #62
                Versions / #65 masthead. */}
            <div className="m-mono m-website-section-h" data-testid="section-business-ops" style={{ marginTop: 4 }}>Business ops</div>
            <DocumentsPanel
              companyId={companyId}
              idea={state.idea}
              companyName={company}
              track={state.track}
              brandTagline={state.brandTagline}
              brandColor={state.brandColor}
              canExportDeck={activePlan !== ''}
              onExportUpgrade={goUpgrade}
            />
          </CollapsibleSection>
        </div>

        {/* RIGHT — Ask Cody anything. #842 (5th recurrence of the grey-region-on-
            scroll bug): `.m-live-col-chat` used to be BOTH the grid item (which
            needs to span the full, tall grid-cell height so its background
            covers the cell — the #810/#812 mechanism) AND the sticky-positioned,
            viewport-capped box (which must stay SHORT and pinned near the top).
            One element can't be both: giving the short sticky box a background
            only paints its own shrunk box, not the full grid cell behind it, so
            .m-live-grid's own grey divider background always showed through the
            uncovered remainder — confirmed live (~2400px of exposed grey on a
            real account with a tall header stack). Splitting the two roles across
            two elements fixes this structurally: `.m-live-col-chat` (outer) is now
            a plain, non-sticky grid item that gets the SAME min-height + background
            treatment as the other two columns (#805/#810/#812) so it always covers
            its full cell; `.m-live-col-chat-sticky` (inner) carries the sticky
            positioning + viewport-relative height, so the chat card still stays
            pinned near the top as the founder scrolls the tall middle column. */}
        <div className="m-live-col m-live-col-chat">
          <div className="m-live-col-chat-sticky">
          <div className="m-live-card m-chat">
            <div className="m-mono m-live-card-h"><span className="m-glyph">◇</span> Ask Cody anything</div>
            {/* #608: "where we left off" handoff — a returning founder sees this
                instead of re-reading/re-explaining the raw chat history. Only
                shown once the thread has genuinely loaded, alongside real turns. */}
            {chatLoaded && chatSummary && chat.length > 0 && (
              <div className="m-chat-summary" data-testid="chat-summary">
                <span className="m-mono">SINCE YOU WERE LAST HERE</span>
                <p>{chatSummary}</p>
              </div>
            )}
            {/* #693: "what Cody has learned" — a synthesized ZeroMemory profile
                built from real founder-Cody exchanges. Independent of the raw
                chat summary above (that's the last conversation; this is an
                accumulated read on the founder/company overall). Only shown
                once real content exists — never an empty placeholder card. */}
            {chatLoaded && companyProfile && (
              <div className="m-chat-summary" data-testid="company-profile">
                <span className="m-mono">WHAT CODY HAS LEARNED</span>
                {companyProfile.summary && <p>{companyProfile.summary}</p>}
                {companyProfile.facts.length > 0 && (
                  <ul className="m-profile-facts" data-testid="company-profile-facts">
                    {companyProfile.facts.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className="m-chat-log" data-testid="chat-log" ref={chatLogRef}>
              {/* Honest empty state (#52): shown only once the persisted thread has
                  loaded and is genuinely empty — a brand-new company, no fake history. */}
              {chatLoaded && chat.length === 0 && (
                <p className="m-chat-cody"><span className="m-glyph">◇</span> {company} is live and on watch. Ask me anything — what to build next, how the wedge is holding up, or what I&apos;ll run tonight.</p>
              )}
              {chat.map((line, i) =>
                line.role === 'user'
                  ? (
                    <div key={i} className="m-chat-user-turn">
                      {line.text && <p className="m-chat-user">{line.text}</p>}
                      {line.attachments && line.attachments.length > 0 && (
                        <div className="m-chat-attachments" data-testid="chat-sent-attachments">
                          {line.attachments.map((a) => (
                            <span key={a.fileId} className="m-chip">{a.fileName}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                  : (
                    <div key={i} className="m-chat-cody-turn">
                      <span className="m-glyph">◇</span>
                      <StreamingMessage
                        role="assistant"
                        content={line.text}
                        streamingState="complete"
                        enableMarkdown={false}
                        showStreamingIndicator={false}
                        className="m-chat-cody-aikit"
                        style={AIKIT_MESSAGE_STYLE_OVERRIDE}
                        testId={`chat-cody-message-${i}`}
                      />
                    </div>
                  )
              )}
              {asking && (
                <div className="m-chat-cody-turn m-mono">
                  <span className="m-glyph">◇</span>
                  <StreamingMessage
                    role="assistant"
                    content="thinking…"
                    streamingState="streaming"
                    enableMarkdown={false}
                    showStreamingIndicator={false}
                    animationType="none"
                    className="m-chat-cody-aikit"
                    style={AIKIT_MESSAGE_STYLE_OVERRIDE}
                    testId="chat-cody-thinking"
                  />
                </div>
              )}
            </div>
            {/* Attachment chips (#741) — real preview before Send, not a fire-and-forget. */}
            {pendingAttachments.length > 0 && (
              <div className="m-chat-attachments" data-testid="chat-attachments">
                {pendingAttachments.map((a) => (
                  <span key={a.fileId} className="m-chip" data-testid="chat-attachment-chip">
                    {a.uploading ? `Uploading ${a.fileName}…` : a.fileName}
                    <button
                      type="button"
                      aria-label={`Remove ${a.fileName}`}
                      onClick={() => removeAttachment(a.fileId)}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            {attachError && <p className="m-chat-attach-error" data-testid="chat-attach-error">{attachError}</p>}
            <div className="m-chat-input">
              <input
                ref={attachInputRef}
                type="file"
                data-testid="chat-attach-input"
                accept={`${UPLOAD_ACCEPT_ATTR},${DOCUMENT_UPLOAD_ACCEPT_ATTR}`}
                onChange={onAttachChange}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="m-chat-attach-btn"
                data-testid="chat-attach"
                aria-label="Attach a file"
                onClick={() => attachInputRef.current?.click()}
              >📎</button>
              <input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder="Message Cody…"
              />
              <button className="btn-primary" onClick={ask} disabled={asking || pendingAttachments.some((a) => a.uploading)}>Send</button>
            </div>
          </div>
          </div>
        </div>
      </div>

      {proof.agentsActive != null && (
        <p className="m-live-footprint m-mono">
          {proof.agentsActive} AINative agents working platform-wide right now — the same infrastructure running {company}.
        </p>
      )}

      <DomainModal
        brand={state.appSub || companyId}
        slug={companyId}
        // #817: DomainModal's connect-domain calls must never fire against the
        // slugified-companyName FALLBACK inside companyId — only against the
        // reducer's own real appSub once it's actually known. On a fresh deep
        // link (/build?screen=live&company=X) there's a window before the
        // hydration effects above settle where companyId still resolves via
        // that fallback; a customer hit "company not found" from exactly this
        // path. appSubReady tells DomainModal a confirmed slug exists, not just
        // that companyId happens to be non-empty.
        appSubReady={!!state.appSub}
        keywords={[state.idea, state.brandTagline].filter(Boolean).join(' ')}
        open={domainOpen}
        onClose={() => setDomainOpen(false)}
        onRequireAuth={() => { setDomainOpen(false); dispatch({ type: 'GOTO_SCREEN', screen: 'signup' }) }}
      />
    </div>
  )
}
