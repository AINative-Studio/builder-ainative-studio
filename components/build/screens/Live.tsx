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
import { useLiveProof } from '@/lib/build/useLiveProof'
import { buildSystems, type BusinessSystem } from '@/lib/build/business-systems'
import { DomainModal } from '@/components/build/DomainModal'
import { planUnlocks, type ActivePlan } from '@/lib/build/state'
import { useSession } from 'next-auth/react'

/** Display label for an active paid tier (#241). */
const PLAN_LABEL: Record<ActivePlan, string> = {
  '': '', pro: 'Pro', business: 'Business', enterprise: 'Enterprise', cody_vcto: 'Cody · Virtual CTO',
}

interface ChatLine { role: 'user' | 'cody'; text: string }

export function Live() {
  const { state, dispatch } = useBuild()
  const proof = useLiveProof()
  const [msg, setMsg] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const [chat, setChat] = useState<ChatLine[]>([])
  const [asking, setAsking] = useState(false)
  const [systems, setSystems] = useState<BusinessSystem[]>(buildSystems())
  const [nightshift, setNightshift] = useState<{ hasRun: boolean; summary?: string; lastRunAt?: string } | null>(null)
  // Early email capture (#207): an anonymous founder can save/share their company
  // by email BEFORE the upgrade wall — turning non-converters into a reachable lead.
  const [leadEmail, setLeadEmail] = useState('')
  const [leadSaved, setLeadSaved] = useState(false)
  const company = state.companyName || 'Your Company'
  const companyId = state.appSub || company.toLowerCase().replace(/\s+/g, '-')
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

  // Early email capture — save/share the company by email (no account needed) so an
  // anonymous non-converter becomes a reachable lead. Fires a GA4 lead event.
  const saveByEmail = async () => {
    const email = leadEmail.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || leadSaved) return
    setLeadSaved(true) // optimistic
    trackEvent('lead_captured', 'funnel', state.track)
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
        .then((d) => { if (alive && d?.entry?.domain) setCustomDomain(String(d.entry.domain)) })
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
  const wildcardHost =
    deployUrl && /^https?:\/\//i.test(deployUrl) && !/\/build\//.test(deployUrl)
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

  // Tonight's tasks — real platform-loop signal woven in so it's not fiction.
  const tonight = [
    `Evaluate ${company} and pick the highest-leverage next task`,
    proof.tasksToday != null
      ? `Join the ${proof.tasksToday} agent tasks the platform ran today`
      : 'Run the nightly improvement pass',
    'Summarize outcomes and score them into the RLHF loop',
  ]

  // Reach the real artifact graph from Live (returns to the workspace on the graph view).
  const openGraph = () => {
    dispatch({ type: 'GOTO_VIEW', view: 'graph' })
    dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })
  }
  // Re-scoping the wedge is a real upstream edit with downstream impact → fire the
  // blocking Dependency Conflict gate (traced from the real composition graph).
  const rescopeWedge = () => {
    dispatch({ type: 'TRIGGER_CONFLICT', changedView: state.track === 'company' ? 'wedge' : 'prd' })
  }

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
        <div className="m-live-masthead-right">
          <span className={`m-mono m-live-watch ${onWatch ? '' : 'is-preview'}`}>
            <span className="m-live-dot" /> {onWatch ? 'Cody is on watch' : 'Preview mode'}
          </span>
          <a className="m-mono m-live-url" href={liveHref} target="_blank" rel="noreferrer">
            {appReady ? `${customDomain ? 'Live at ' : ''}${liveLabel} ↗` : 'building your site…'}
          </a>
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
            <a className="btn-ghost" href="/settings/billing" target="_blank" rel="noreferrer">Manage plan ↗</a>
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
          <div className="m-live-card m-upsell">
            <div className="m-mono m-live-card-h">Hire the swarm</div>
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
            <div className="m-systems m-seams">
              {systems.map((s) =>
                // #278: only link when the company has its own provisioned instance URL.
                // Never dump the founder on a primitive marketing site.
                s.url ? (
                  <a key={s.key} className="m-system" href={s.url} target="_blank" rel="noreferrer">
                    <span className="m-system-name">{s.name}</span>
                    <span className="m-system-stat m-mono">{s.stat}</span>
                    <span className="m-chip m-system-prim">{s.primitive}</span>
                    <span className="m-mono m-system-src" title="Live from your provisioned instance">● live</span>
                  </a>
                ) : (
                  <div key={s.key} className="m-system">
                    <span className="m-system-name">{s.name}</span>
                    <span className="m-system-stat m-mono">{s.stat}</span>
                    <span className="m-chip m-system-prim">{s.primitive}</span>
                    {/* Honest marker: real provisioned data vs still-simulated (#243). */}
                    <span className="m-mono m-system-src" title={s.provisioned ? 'Live from your provisioned ZeroDB project' : 'Simulated — no per-company data source wired yet'}>
                      {s.provisioned ? '● live' : '○ sim'}
                    </span>
                    {/* "learn more" as a secondary affordance only, not the primary action (#278) */}
                    <a className="m-system-learn m-mono" href={s.docUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>docs ↗</a>
                  </div>
                )
              )}
            </div>
          </div>
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">The swarm · tonight&apos;s tasks</div>
            <ul className="m-list m-tonight">{tonight.map((t) => <li key={t}><span className="st is-running" /> {t}</li>)}</ul>
          </div>
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
              {/* Provision the real per-company cloud (#243): own ZeroDB project + persistent host. */}
              <button
                className="btn-secondary"
                onClick={provisionCompany}
                disabled={provision.busy || provision.provisioned}
                title={provision.provisioned ? 'This company has its own ZeroDB project' : 'Create a real per-company ZeroDB project + persistent deploy'}
              >
                {provision.provisioned ? '✓ Cloud provisioned' : provision.busy ? 'Provisioning…' : 'Provision cloud'}
              </button>
              {/* Not wired yet (#256): disabled + labeled so a customer never clicks a dead button. */}
              <button className="btn-secondary is-soon" disabled title="Coming soon">Redeploy · soon</button>
            </div>
            {provision.provisioned && (
              <p className="m-mono m-metric-note">Own ZeroDB project · Pipeline & Invoices read live data. Helpdesk & Voice still simulated.</p>
            )}
          </div>
        </div>

        {/* RIGHT — Ask Cody anything */}
        <div className="m-live-col">
          <div className="m-live-card m-chat">
            <div className="m-mono m-live-card-h"><span className="m-glyph">◇</span> Ask Cody anything</div>
            <div className="m-chat-log">
              {chat.length === 0 && (
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
