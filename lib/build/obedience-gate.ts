/**
 * Codegen obedience gate (#297 · epic #296).
 *
 * The system prompt already MANDATES that generated apps (a) persist real data via
 * the same-origin `/api/db/{table}` proxy and (b) use AIKit components instead of
 * hand-rolling them. But nothing ENFORCED it — the model frequently hardcoded mock
 * data and rebuilt components from scratch (baseline: dbBacked 33%, aikit 0%).
 *
 * This gate inspects the FINAL generated code + the idea and reports obedience gaps,
 * so the chat-ws pipeline can re-prompt with the specific gap (reusing the existing
 * validation-retry loop). It only flags gaps that are genuinely warranted:
 *  - persistence: only for ideas that clearly manage user records (todo/notes/CRM/
 *    dashboard/… — an "add/create/save/list" surface) AND the app has NO /api/db call.
 *  - AIKit: only when the app hand-rolls a UI pattern AIKit provides (metric/stat
 *    cards, a nav sidebar, a data table, pricing/product cards, chat bubbles).
 *  - primitive proxy compliance (#518): only when the IDEA TEXT ITSELF matches a
 *    RUNTIME_PROXIED_PRIMITIVES primitive's own trigger keywords (e.g. "remembers",
 *    "recalls" → ZeroMemory) but the generated code contains NO reference to ANY of
 *    its real proxy paths — meaning the model was explicitly instructed to call the
 *    real endpoint for a feature the founder clearly asked for, and didn't, almost
 *    always because it hand-rolled a lookalike substitute instead (confirmed live: a
 *    journaling app's "related memories" feature was pure client-side keyword
 *    matching over /api/db rows, with zero calls to /api/memory/* despite ZeroMemory
 *    being selected and instructed). Deliberately keyed off idea-trigger overlap
 *    rather than raw selectPrimitives() output: several of these primitives
 *    (ZeroMemory chief among them) are `foundational` and so are ALWAYS selected/
 *    wired regardless of the idea — flagging every app that doesn't call
 *    /api/memory/* would false-positive on a plain counter or landing page that was
 *    never asked to remember anything.
 *
 * Pure + deterministic. Never throws. Conservative — a false "no gap" is fine (the
 * app still works); we only re-prompt on a HIGH-confidence gap so we don't waste
 * turns on apps that legitimately don't need persistence/AIKit/a specific primitive
 * (e.g. a counter).
 */
import { scorePrimitives, RUNTIME_PROXY_PATH_SUBSTRINGS, getRuntimeProxyInstruction, type CompanyRole } from './primitive-catalog'

/** Does the code call the ZeroDB proxy for real persistence? */
export function usesDataLayer(code: string): boolean {
  return /\/api\/db\//.test(code || '')
}

/** Ideas whose apps clearly manage USER RECORDS and therefore SHOULD persist. */
const PERSISTENCE_IDEA_HINTS = [
  'todo', 'task', 'note', 'contact', 'crm', 'lead', 'customer', 'invoice',
  'inventory', 'product', 'order', 'booking', 'reservation', 'appointment',
  'expense', 'budget', 'journal', 'log', 'record', 'entry', 'entries',
  'dashboard', 'tracker', 'manage', 'list of', 'save', 'directory', 'catalog',
  'crud', 'database', 'habit', 'workout', 'recipe', 'bookmark', 'wishlist',
]

/** Does the code contain a data-management surface (add/create/save/list of items)? */
function looksDataManaging(code: string): boolean {
  const addBtn = /(Add|New|Create|Save)\b/i.test(code) && /(onClick|onSubmit)=/.test(code)
  const listState = /\.map\(/.test(code) && /useState\(\s*\[/.test(code)
  return addBtn && listState
}

/**
 * Should this app be persisting to /api/db? True when the idea is record-managing
 * AND the app has an add/list surface AND it does NOT already call /api/db.
 */
export function hasPersistenceGap(code: string, idea: string): boolean {
  if (usesDataLayer(code)) return false
  const ideaLc = (idea || '').toLowerCase()
  const ideaWantsData = PERSISTENCE_IDEA_HINTS.some((h) => ideaLc.includes(h))
  return ideaWantsData && looksDataManaging(code)
}

/**
 * Real, live, universal bug found via direct inspection of the 4 most recent
 * real admin-owned generated companies (2026-09-06): EVERY ONE had an email/
 * waitlist capture form (`type="email"` + a submit handler) that fires
 * `alert()`, or flips a local `submitted` state and clears the input — the
 * email is NEVER PERSISTED anywhere. A founder using any of these sees "200+
 * people joined the waitlist" copy while every real submission is silently
 * discarded. `hasPersistenceGap` above structurally can't catch this: it's
 * scoped to an add-button + list UI shape (todo/CRM-style apps), while a
 * landing page's lead-capture form is a completely different shape (a single
 * form + submit, no list at all) — so it never matched.
 */
function looksLikeLeadCapture(code: string): boolean {
  const hasEmailInput = /type=["']email["']/i.test(code)
  const hasSubmitHandler = /(handleSubmit|handleEarlyAccess|handleWaitlist|handleSignup|onSubmit)\s*[:=]/.test(code)
  return hasEmailInput && hasSubmitHandler
}

/**
 * Does the code actually persist the captured email anywhere real? Note:
 * builder's OWN /api/build/lead is NOT a valid answer here — it's an internal
 * route for builder.ainative.studio's own visitor capture (requires the
 * platform's server-side key); a generated app is a separately-hosted,
 * sandboxed client that can never reach it. The only real persistence path a
 * generated app has is the same /api/db/{table} proxy every other record uses.
 */
function persistsLeadCapture(code: string): boolean {
  return usesDataLayer(code)
}

/**
 * True when the app has an email/waitlist capture form but never persists
 * what it captures. Unconditional like visitor tracking — any generated app
 * can have a lead-capture form regardless of its core idea.
 */
export function hasFakeLeadCaptureGap(code: string): boolean {
  return looksLikeLeadCapture(code) && !persistsLeadCapture(code)
}

/**
 * #483/#563: does the code fire the mandated visitor-tracking beacon
 * (`POST /api/db/visitors` on mount)? Real gap fix — the founder's Live
 * dashboard showed a "visitors" count that was a permanent, hardcoded 0 with
 * NOTHING behind it for every generated app, ever, despite the dashboard's
 * own copy claiming "Cody grows these nightly." Unlike the other gates here,
 * this one is UNCONDITIONAL — every generated app has some kind of landing/
 * home surface, so there's no idea-trigger overlap to gate on (mirrors how
 * ZeroDB/AUTH in the FOUNDATION prompt block are always-required, not
 * idea-conditional).
 */
export function hasVisitorTrackingGap(code: string): boolean {
  return !/\/api\/db\/visitors/.test(code || '')
}

/**
 * AIKit patterns the model tends to hand-roll. Each entry: a regex that matches a
 * HAND-ROLLED version in the generated code, and the AIKit component to use instead.
 * We only flag when the AIKit component is NOT already imported/used.
 */
const AIKIT_PATTERNS: Array<{ handRolled: RegExp; component: string; label: string }> = [
  // A stat/metric card: a number + a label/change, hand-built with divs.
  { handRolled: /className="[^"]*\b(text-3xl|text-4xl)[^"]*"[^>]*>\s*\{?[^<]*(\$|%|\d)/, component: 'MetricCard', label: 'stat/metric cards' },
  // A left nav column (w-NN sidebar) OR an <aside> element used as nav.
  { handRolled: /className="[^"]*\b(w-64|w-56|w-72)\b[^"]*"[^>]*>[\s\S]{0,400}(nav|aside|sidebar)/i, component: 'AIKitSidebar', label: 'sidebar navigation' },
  { handRolled: /<aside[\s>][\s\S]{0,300}(<nav|onClick|href|menu|item)/i, component: 'AIKitSidebar', label: 'sidebar navigation' },
  // A data table built from <table>.
  { handRolled: /<table[\s>]/i, component: 'AIKitTable', label: 'data table' },
  // Pricing cards.
  { handRolled: /(price|pricing|\/mo|per month)[\s\S]{0,200}(Get started|Choose|Subscribe|Buy)/i, component: 'AIKitPriceCard', label: 'pricing cards' },
  // A top app header/nav bar hand-built with <header>/<nav>.
  { handRolled: /<(header|nav)[\s>][\s\S]{0,300}(<a\b|href|onClick|logo|brand|search)/i, component: 'AIKitHeader', label: 'app header / nav bar' },
  // Product cards: an image + name + price + add-to-cart, hand-built.
  { handRolled: /(add to cart|addtocart|buy now)[\s\S]{0,60}|(<img[\s\S]{0,200}(\$|price)[\s\S]{0,120}(add|cart|buy))/i, component: 'AIKitProductCard', label: 'product cards' },
  // Pagination: prev/next page buttons hand-built.
  { handRolled: /(Prev(ious)?[\s\S]{0,120}Next|Page\s*\{?\s*\d)[\s\S]{0,80}(onClick|setPage|currentPage)/i, component: 'AIKitPagination', label: 'pagination' },
  // A vertical timeline / activity feed hand-built with divs + dots.
  { handRolled: /(timeline|activity feed)[\s\S]{0,200}(map\(|<li|rounded-full)/i, component: 'AIKitTimeline', label: 'timeline / activity feed' },
  // Multi-step wizard/stepper hand-built.
  { handRolled: /(step\s*\d|currentStep|activeStep)[\s\S]{0,160}(map\(|rounded-full|border)/i, component: 'AIKitStepper', label: 'multi-step / stepper' },
  // Banner / alert bar hand-built.
  { handRolled: /className="[^"]*\b(bg-(red|yellow|green|blue|amber)-(50|100|500))\b[^"]*"[^>]*>[\s\S]{0,140}(alert|warning|success|error|dismiss|notice)/i, component: 'AIKitBanner', label: 'banner / alert' },
  // Star rating hand-built with SVG/★ stars.
  { handRolled: /(★|<svg[\s\S]{0,120}star)[\s\S]{0,80}(★|map\(|rating)/i, component: 'AIKitRating', label: 'star rating' },
]

/** Which AIKit components are already used/imported in the code? */
function usedAikit(code: string): Set<string> {
  const found = new Set<string>()
  const names = ['MetricCard', 'AIKitSidebar', 'AIKitHeader', 'AIKitTable', 'AIKitPriceCard', 'AIKitProductCard', 'AIKitRating', 'AgentCard', 'SwarmView', 'ChatBubble', 'EmptyState', 'AIKitTimeline', 'AIKitStepper', 'AIKitBanner', 'AIKitAvatar', 'AIKitPagination', 'AIKitBreadcrumb']
  for (const n of names) {
    if (new RegExp(`<${n}[\\s/>]`).test(code)) found.add(n)
  }
  return found
}

/**
 * Return the AIKit components the app hand-rolled instead of using. Only components
 * NOT already used are reported. Empty array = no AIKit gap.
 */
export function findAikitGaps(code: string): string[] {
  const src = code || ''
  const have = usedAikit(src)
  const gaps: string[] = []
  for (const p of AIKIT_PATTERNS) {
    if (have.has(p.component)) continue
    if (p.handRolled.test(src)) gaps.push(`${p.component} (${p.label})`)
  }
  return [...new Set(gaps)]
}

/**
 * #518: which RUNTIME_PROXIED_PRIMITIVES primitives the IDEA ITSELF clearly asked
 * for (real trigger-keyword overlap, e.g. "remembers"/"recalls" → ZeroMemory) but
 * whose real proxy path was NEVER called anywhere in the generated code. Uses
 * scorePrimitives' idea-trigger overlap (`matched`) rather than raw selection —
 * several of these primitives are `foundational` and so are always wired/selected
 * regardless of the idea; gating on trigger overlap instead keeps this check scoped
 * to apps that genuinely asked for the capability, mirroring how hasPersistenceGap
 * only fires for record-managing ideas rather than every app.
 */
export function findPrimitiveComplianceGaps(code: string, idea: string, role?: CompanyRole): string[] {
  const src = code || ''
  const scored = scorePrimitives(idea, 'company', role)
  const gaps: string[] = []
  for (const [name, paths] of Object.entries(RUNTIME_PROXY_PATH_SUBSTRINGS)) {
    const score = scored.find((s) => s.primitive.name === name)
    if (!score || score.matched.length === 0) continue // idea never asked for this capability
    const calledAny = paths.some((p) => src.includes(p))
    if (!calledAny) gaps.push(name)
  }
  return gaps
}

export interface ObedienceResult {
  ok: boolean
  persistenceGap: boolean
  aikitGaps: string[]
  /** #518: selected primitives whose real proxy path was never called. */
  primitiveComplianceGaps: string[]
  /** #483/#563: the mandated visitor-tracking beacon was never fired. */
  visitorTrackingGap: boolean
  /** Real bug (found live, 4/4 recent generations): an email/waitlist capture
   *  form that never persists what it captures. */
  fakeLeadCaptureGap: boolean
  reasons: string[]
}

/** Inspect generated code + idea; report obedience gaps for the re-prompt. */
export function checkObedience(code: string, idea: string, role?: CompanyRole): ObedienceResult {
  const persistenceGap = hasPersistenceGap(code, idea)
  const aikitGaps = findAikitGaps(code)
  const primitiveComplianceGaps = findPrimitiveComplianceGaps(code, idea, role)
  const visitorTrackingGap = hasVisitorTrackingGap(code)
  const fakeLeadCaptureGap = hasFakeLeadCaptureGap(code)
  const reasons: string[] = []
  if (persistenceGap) {
    reasons.push('App manages user records but hardcodes data — must persist via /api/db.')
  }
  if (aikitGaps.length) {
    reasons.push(`Hand-rolled UI that AIKit provides: ${aikitGaps.join(', ')}.`)
  }
  if (primitiveComplianceGaps.length) {
    reasons.push(`Selected primitive(s) never called their real proxy: ${primitiveComplianceGaps.join(', ')}.`)
  }
  if (fakeLeadCaptureGap) {
    reasons.push('Email/waitlist capture form never persists the email it collects — must save via /api/db.')
  }
  if (visitorTrackingGap) {
    reasons.push('Landing/home page never fires the mandated visitor-tracking beacon (POST /api/db/visitors on mount).')
  }
  return { ok: reasons.length === 0, persistenceGap, aikitGaps, primitiveComplianceGaps, visitorTrackingGap, fakeLeadCaptureGap, reasons }
}

/**
 * Build a focused re-prompt that tells the model EXACTLY what to fix, appended to
 * the broken code. Reused by the chat-ws obedience retry (mirrors buildRepairPrompt).
 */
export function buildObediencePrompt(idea: string, result: ObedienceResult): string {
  const parts: string[] = [
    'The generated app works but does NOT follow required AINative rules. Fix ONLY these, keep everything else:',
    '',
  ]
  if (result.persistenceGap) {
    parts.push(
      '1) PERSIST REAL DATA. This app manages user records but hardcodes them in useState.',
      '   Wire it to the ZeroDB proxy instead:',
      "   - Load:   useEffect(() => { fetch('/api/db/<table>').then(r=>r.json()).then(d=>setItems(d.data||[])) }, [])",
      "   - Create: await fetch('/api/db/<table>', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(item) }); then re-fetch or append d.data.",
      "   - Update: PUT /api/db/<table>?id=<id>   Delete: DELETE /api/db/<table>?id=<id>",
      '   Rows come back FLAT with an `id` field. Keep the UI identical; just make it data-backed.',
      '',
    )
  }
  if (result.aikitGaps.length) {
    parts.push(
      `2) USE AIKIT COMPONENTS instead of hand-rolling: ${result.aikitGaps.join(', ')}.`,
      "   Import from './components/aikit' and './components/ui/*'. Examples:",
      '   <MetricCard title="Revenue" value="$84K" change="+12.5%" changeType="positive" />',
      '   <AIKitSidebar items={[...]} />   <AIKitTable columns={[...]} rows={[...]} />',
      '   <AIKitPriceCard name="Pro" price="$49" features={[...]} />',
      '',
    )
  }
  if (result.primitiveComplianceGaps.length) {
    // #518: this app was told to compose these real primitives (they appeared in
    // the composition block) but never called ANY of their real proxy paths — the
    // observed live failure mode is a hand-rolled lookalike substitute (e.g.
    // client-side keyword matching standing in for ZeroMemory recall), so quote
    // the EXACT same instruction + anti-pattern warning the model already had,
    // rather than a generic "please fix" that's easy to satisfy shallowly again.
    parts.push(
      `3) YOU WERE TOLD TO CALL THESE REAL PRIMITIVES AND DID NOT: ${result.primitiveComplianceGaps.join(', ')}.`,
      '   Search your own code for any hand-rolled logic standing in for these (e.g. client-side keyword/text',
      '   matching, hardcoded lists, fabricated data) and REPLACE it with the real call below. Do not just add',
      '   an unused import — the feature must actually invoke the endpoint.',
      '',
    )
    for (const name of result.primitiveComplianceGaps) {
      const instruction = getRuntimeProxyInstruction(name)
      if (instruction) parts.push(`   ${name} — To use: ${instruction}`, '')
    }
  }
  if (result.visitorTrackingGap) {
    parts.push(
      '4) FIRE THE MANDATED VISITOR-TRACKING BEACON. The founder\'s Live dashboard reads a real visitors count —',
      '   your landing/home page component MUST fire exactly ONE pageview on mount via the same /api/db proxy:',
      "   useEffect(() => { fetch('/api/db/visitors', { method: 'POST', headers: {'Content-Type':'application/json'},",
      "     body: JSON.stringify({ path: window.location.pathname, ts: new Date().toISOString() }) }).catch(() => {}) }, [])",
      '   Best-effort — a failed beacon must never block or error the page. Once per mount, not per re-render.',
      '',
    )
  }
  if (result.fakeLeadCaptureGap) {
    parts.push(
      '5) PERSIST THE EMAIL/WAITLIST CAPTURE FORM — it currently only shows a fake "submitted" state (alert() or a',
      '   local flag) and discards what the visitor typed. Real founders see fake signup counts while every real',
      '   submission is silently lost. Fix the submit handler to actually save it via the same /api/db proxy:',
      "   const handleSubmit = async (e) => { e.preventDefault(); await fetch('/api/db/waitlist', { method: 'POST',",
      "     headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email, joinedAt: new Date().toISOString() }) })",
      '     .catch(() => {}); setSubmitted(true); setEmail(\'\') }',
      '   Keep the existing success UI (alert/toast/inline message) — only the persistence is missing.',
      '',
    )
  }
  parts.push('Return the corrected full app. Do not remove features.')
  return parts.join('\n')
}
