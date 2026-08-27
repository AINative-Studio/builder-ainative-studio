'use client'

/**
 * Live operating dashboard (#226) — the destination. 04-SCREENS Live.
 * The founder supervises an AI-run company. The business-systems grid wires the
 * real AINative primitives (ZeroPipeline/ZeroInvoice/ServiceOS/ZeroVoice), and
 * Cody's nightly-run status is our real recursive loop pointed at the user's co.
 */

import { useState, useEffect } from 'react'
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
import { WebsitePanel } from '@/components/build/WebsitePanel'
import { FeedbackPulse } from '@/components/build/FeedbackPulse'

/** Display label for an active paid tier (#241). */
const PLAN_LABEL: Record<ActivePlan, string> = {
  '': '', pro: 'Pro', business: 'Business', enterprise: 'Enterprise', cody_vcto: 'Cody · Virtual CTO',
}

// Monthly $ value per plan for the Meta Pixel Purchase event — mirrors PLAN_VALUE
// in app/api/build/subscription/verify/route.ts so browser and CAPI agree.
const PLAN_META_VALUE: Record<string, number> = {
  pro: 49, launch: 49, business: 149, company: 149, enterprise: 999, cody_vcto: 4999,
}

interface ChatLine { role: 'user' | 'cody'; text: string }

export function Live() {
  const { state, dispatch } = useBuild()
  const proof = useLiveProof()
  const [msg, setMsg] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const [chat, setChat] = useState<ChatLine[]>([])
  // Whether the persisted conversation has been loaded yet (#52) — gates the
  // honest empty state so we don't flash "ask me anything" before hydration.
  const [chatLoaded, setChatLoaded] = useState(false)
  const [asking, setAsking] = useState(false)
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
  // Persistent-cloud provisioning (#243): once a company is provisioned it has
  // its own real ZeroDB project + persistent deploy target, and the systems grid
  // reads real per-company data.
  const [provision, setProvision] = useState<{ provisioned: boolean; busy: boolean; projectId?: string }>({ provisioned: false, busy: false })
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
        if (!alive || !d) return
        setProvision((p) => ({ ...p, provisioned: !!d.provisioned, projectId: d.zerodbProjectId || undefined }))
        if (d.deployUrl) setDeployUrl(String(d.deployUrl))
      })
      .catch(() => {})
    // Company track has no /preview app — generate a REAL landing-page app for it
    // once, so the prod URL /build/{slug} actually shows something. Register it.
    if (!state.appChatId && state.idea && state.appSub) {
      fetch('/api/build/company-app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: state.idea, slug: state.appSub, name: company,
          tagline: state.brandTagline, color: state.brandColor,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.chatId) { setAppReady(true); dispatch({ type: 'SET_APP_CHATID', chatId: d.chatId }) } })
        .catch(() => {})
    }
    // The visible nightshift — the real last nightly run + morning summary.
    fetch(`/api/build/nightshift?companyId=${encodeURIComponent(companyId)}&idea=${encodeURIComponent(state.idea)}&companyName=${encodeURIComponent(company)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setNightshift(d) })
      .catch(() => { /* honest: no card if unavailable */ })
    return () => { alive = false }
  }, [companyId])

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
    fetch(`/api/build/ask?companyId=${encodeURIComponent(companyId)}`)
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
        setChatLoaded(true)
      })
      .catch(() => { if (alive) setChatLoaded(true) })
    return () => { alive = false }
  }, [companyId])

  const ask = async () => {
    const q = msg.trim()
    if (!q || asking) return
    setChat((c) => [...c, { role: 'user', text: q }])
    setMsg('')
    setAsking(true)
    try {
      const res = await fetch('/api/build/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, idea: state.idea, companyName: company, track: state.track, companyId }),
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

  // Provision the persistent cloud for this company (#243): a real per-company
  // ZeroDB project + persistent deploy target. Requires an account (the project
  // is owned by the founder). Refreshes the systems grid to read real data after.
  const provisionCompany = async () => {
    if (provision.busy || provision.provisioned) return
    if (!signedIn) { dispatch({ type: 'GOTO_SCREEN', screen: 'signup' }); return }
    setProvision((p) => ({ ...p, busy: true }))
    try {
      const res = await fetch('/api/build/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId, name: company, plan: state.plan }),
      })
      const d = await res.json().catch(() => null)
      if (d?.ok) {
        setProvision({ provisioned: true, busy: false, projectId: d.zerodbProjectId })
        // Re-read systems now that they point at the real provisioned project.
        fetch(`/api/build/systems?companyId=${encodeURIComponent(companyId)}&idea=${encodeURIComponent(state.idea || '')}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => { if (s?.systems) setSystems(s.systems) })
          .catch(() => {})
      } else {
        setProvision((p) => ({ ...p, busy: false }))
      }
    } catch {
      setProvision((p) => ({ ...p, busy: false }))
    }
  }

  // FIX-5: per-project brand color so every company's dashboard looks distinct,
  // not identical. Falls back to the track accent.
  const brandStyle = state.brandColor && /^#[0-9a-fA-F]{6}$/.test(state.brandColor)
    ? ({ ['--m-brand' as string]: state.brandColor } as React.CSSProperties)
    : undefined

  return (
    <div className="modernist m-live" data-track="company" style={brandStyle}>
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

      {/* Upgrade path (#207 · #252). Three states, always giving an OBVIOUS next
          step to paid — the gap the founder hit ("couldn't figure out how to pay"):
            1. On a paid plan → "On {plan}" + Manage plan.
            2. Signed in, unpaid → trial countdown + a real Upgrade button → Pricing (Stripe).
            3. Anonymous → claim/sign-up (then they return here and can upgrade). */}
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
            <button className="btn-ghost" data-testid="manage-plan" onClick={manageBilling}>Manage plan ↗</button>
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

      {/* RLHF pulse (#332): rate the built company once it's live. One rating
          per generation (keyed by chatId/slug), dismissible, never blocking. */}
      {state.builtCompany && (
        <div style={{ padding: '0 var(--m-pad, 24px)' }}>
          <FeedbackPulse surface="live" />
        </div>
      )}

      <div className={`m-live-grid ${state.tablet ? 'is-tablet' : ''}`}>
        {/* LEFT — Cody status + metrics + upsell */}
        <div className="m-live-col">
          <div className="m-live-card">
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
            <div className="m-live-card-actions">
              <button className="btn-ghost" onClick={openGraph}>Open the artifact graph →</button>
              <button className="btn-ghost" onClick={rescopeWedge}>Re-scope the wedge ⚠</button>
            </div>
          </div>
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">Business metrics</div>
            <div className="m-metric-rows">
              {/* Honest zero-state for a just-shipped company — the swarm fills these. */}
              <div className="m-metric"><span className="m-metric-v m-artifact">0</span><span className="m-metric-l m-mono">visitors</span></div>
              <div className="m-metric"><span className="m-metric-v m-artifact">0</span><span className="m-metric-l m-mono">waitlist</span></div>
              <div className="m-metric"><span className="m-metric-v m-artifact">$0</span><span className="m-metric-l m-mono">revenue</span></div>
            </div>
            <p className="m-mono m-metric-note">Live from day one — Cody grows these nightly.</p>
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
        </div>

        {/* MIDDLE — business systems + tonight + infra */}
        <div className="m-live-col">
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">Business systems</div>
            {/* Total savings vs stand-alone SaaS (#dashboard-ux): sum the comparable
                monthly cost of every system shown, so the founder sees what they'd
                pay to assemble this stack from separate providers — included here. */}
            {(() => {
              const total = systems.reduce((sum, s) => sum + (s.savedMonthly || 0), 0)
              if (total <= 0) return null
              return (
                <p className="m-system-savings-total" data-testid="systems-savings-total">
                  ≈ <strong>${total}/mo</strong> of stand-alone SaaS — <span className="m-mono">included, usage-based</span>
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
                  <div key={s.key} className="m-system">
                    <span className="m-system-name">{s.name}</span>
                    <span className="m-system-stat m-mono">{s.stat}</span>
                    <span className="m-chip m-system-prim">{s.primitive}</span>
                    {/* Live/Planned badge (#67): replaces ● live / ○ sim text markers. */}
                    <SystemStatusBadge provisioned={s.provisioned} />
                    <SystemSaving vsProvider={s.vsProvider} savedMonthly={s.savedMonthly} />
                    {/* "learn more" as a secondary affordance only, not the primary action (#278) */}
                    <a className="m-system-learn m-mono" href={s.docUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>docs ↗</a>
                  </div>
                )
              )}
            </div>
          </div>
          {/* Real, stateful Tasks/Backlog (#55) — replaces the hardcoded tonight
              array. Persisted per {owner, company}; surfaces real swarm task_ids
              and the nightly loop's Recurring task. */}
          <TasksPanel companyId={companyId} />
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">Website & infrastructure</div>
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
              <p className="m-mono m-metric-note">Own ZeroDB project · Pipeline & Invoices read live data. Helpdesk & Voice still simulated.</p>
            )}
          </div>
          {/* Deploy version history + one-click rollback (#62) — each deploy of the
              company app is a version (message + SHA + timestamp, CURRENT badge on
              the live one); REVERT rolls the live site back via Railway with a
              confirmation + honest rolling-back → validating → live status. A new,
              distinct section — does not touch #67 systems / #55 Tasks / #52 chat. */}
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
          {/* Auto-generated ON-BRAND media (#54) — Auto Image + Auto Video, each with
              a Once/Daily/Weekly/Monthly schedule, run on OWNED core Multimodal /
              Content-Workflow primitives with assets stored in the company's own
              ZeroDB. Shows last-generated + next run; inert + honest when media creds
              aren't set. A new, distinct section — does not touch #67 systems / #52
              chat / #55 Tasks / #62 Versions / #64 Documents / #65 masthead / #51 video. */}
          <MediaPanel
            companyId={companyId}
            companyName={company}
            brandTagline={state.brandTagline}
            brandColor={state.brandColor}
            idea={state.idea}
          />
          {/* Auto Mode (#58) — user-set autonomous run duration ("Cody works
              nonstop. You choose how long."). Duration selector + START/STOP wired
              to the REAL loop (/api/build/auto-mode → bounded swarm dispatch over the
              window), with live progress (time remaining / tasks dispatched / current
              activity). Paid-gated (Business+, same unlock as the nightly loop) with a
              transparent credit cost, agent-triggerable, and inert+honest when the loop
              isn't configured. A NEW, distinct section — does not touch #67 systems /
              #52 chat / #55 Tasks / #62 Versions / #64 Documents / #65 masthead / #51
              video / #54 media. */}
          <AutoModePanel
            companyId={companyId}
            companyName={company}
            track={state.track}
            unlocked={gates.nightlyLoop}
            onUpgrade={goUpgrade}
          />
        </div>

        {/* RIGHT — Ask Cody anything. Sticky rail (m-live-col-chat) so the chat —
            the primary way to talk to Cody — stays above the fold as the founder
            scrolls the tall middle column, and moves to the top on tablet. */}
        <div className="m-live-col m-live-col-chat">
          <div className="m-live-card m-chat">
            <div className="m-mono m-live-card-h"><span className="m-glyph">◇</span> Ask Cody anything</div>
            <div className="m-chat-log" data-testid="chat-log">
              {/* Honest empty state (#52): shown only once the persisted thread has
                  loaded and is genuinely empty — a brand-new company, no fake history. */}
              {chatLoaded && chat.length === 0 && (
                <p className="m-chat-cody"><span className="m-glyph">◇</span> {company} is live and on watch. Ask me anything — what to build next, how the wedge is holding up, or what I&apos;ll run tonight.</p>
              )}
              {chat.map((line, i) =>
                line.role === 'user'
                  ? <p key={i} className="m-chat-user">{line.text}</p>
                  : <p key={i} className="m-chat-cody"><span className="m-glyph">◇</span> {line.text}</p>
              )}
              {asking && <p className="m-chat-cody m-mono"><span className="m-glyph">◇</span> thinking…</p>}
            </div>
            <div className="m-chat-input">
              <input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder="Message Cody…"
              />
              <button className="btn-primary" onClick={ask} disabled={asking}>Send</button>
            </div>
          </div>
        </div>
      </div>

      {proof.agentsActive != null && (
        <p className="m-live-footprint m-mono">
          {proof.agentsActive} AINative agents working platform-wide right now — the same infrastructure running {company}.
        </p>
      )}

      <DomainModal brand={state.appSub || companyId} slug={companyId} keywords={[state.idea, state.brandTagline].filter(Boolean).join(' ')} open={domainOpen} onClose={() => setDomainOpen(false)} onRequireAuth={() => { setDomainOpen(false); dispatch({ type: 'GOTO_SCREEN', screen: 'signup' }) }} />
    </div>
  )
}
