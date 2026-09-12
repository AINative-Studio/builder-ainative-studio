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
 * Real, live bug found live (same investigation as #566): a "favorite this
 * gallery item" toggle on a HARDCODED array (`useState([{...}, {...}])`, an
 * item-level boolean flipped via `.map()` inside the setter) is genuine user
 * interaction that resets on every reload — silently lost, exactly the same
 * class of defect as the lead-capture bug, just a different UI shape
 * (favorite/like/save toggle instead of a form submit). `hasPersistenceGap`
 * above can't catch this: it requires idea-hint overlap AND an explicit
 * Add/New/Create/Save BUTTON TEXT — a favorite toggle is usually an icon
 * button with no such text, and "favorite"/"like"/"save this" was never in
 * the idea-hint list at all (confirmed live: a real "street art gallery...
 * favorite toggle" idea matched zero hints). Unconditional, like visitor
 * tracking and lead capture — any generated app can have a hardcoded list
 * with a per-item toggle regardless of its core idea.
 */
function looksLikeToggleOnHardcodedList(code: string): boolean {
  const hasHardcodedArray = /useState\(\s*\[\s*\{/.test(code)
  const hasItemToggle = /\.map\(\s*\(?\w+\s*=>\s*\w+\.id\s*===[\s\S]{0,60}\?\s*\{\s*\.\.\.\w+,\s*\w+:\s*!\w+\.\w+\s*\}/.test(code)
  return hasHardcodedArray && hasItemToggle
}

export function hasHardcodedToggleGap(code: string): boolean {
  return looksLikeToggleOnHardcodedList(code) && !usesDataLayer(code)
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
 * AX compliance (agent-accessibility, prompt-only per lib/professional-prompt.ts's
 * 10-item checklist — never code-enforced before this). Audited live: real
 * generations scored ~1/10 against that checklist, because nothing here ever
 * re-prompted on a miss the way persistence/AIKit/primitive gaps already do.
 *
 * Scoped to the SINGLE cheapest, most foundational, unconditional item: the
 * root `<main aria-label="...">` landmark (checklist item 1) — everything
 * else in the checklist (nav/section landmarks, data-agent-* attributes, the
 * hidden manifest, JSON-LD) nests inside this one root, and it's the one
 * check regex-detectable with no false-positive risk across every shape of
 * generated app (single-file or multi-file, any layout). Deliberately NOT
 * attempting the full 8-item checklist in one pass — see this file's own
 * "Conservative — a false 'no gap' is fine" philosophy; the remaining items
 * need their own scoped follow-up (tracked separately, not each guessed at
 * here with regexes prone to false positives on legitimately simple apps).
 */
export function hasAxLandmarkGap(code: string): boolean {
  return !/<main[^>]*\baria-label\s*=/.test(code || '')
}

/**
 * AX compliance, follow-up (builder#687, items 5+6 of the 10-item checklist):
 * the hidden agent action manifest (`data-agent-manifest="true"`) and JSON-LD
 * structured data (`<script type="application/ld+json">`). Both are, like the
 * root landmark, single-presence checks with no idea-gating needed — every
 * generated app can carry one hidden manifest block and one JSON-LD block
 * regardless of what it does, so these are unconditional and low-false-
 * positive-risk, matching hasAxLandmarkGap's precedent. Deliberately still
 * NOT attempting the remaining items (nav/section landmarks are a coverage
 * claim across possibly-many elements, data-agent-* likewise — those need a
 * different, coverage-style check design, not a single presence/absence
 * regex) — tracked separately.
 */
export function hasAxManifestGap(code: string): boolean {
  return !/data-agent-manifest\s*=\s*["']true["']/.test(code || '')
}

/**
 * AX compliance, follow-up (builder#687 item 8): a skip-navigation link that
 * genuinely targets a real landmark. Deliberately checks BOTH halves — a
 * dangling skip-link with no real target is worse than none at all (false
 * accessibility theater an agent/screen-reader user would trust and then
 * hit a dead anchor), so this only passes when a real `href="#someId"` (or
 * the `data-agent-action="skip-nav"` marker) AND a matching `id="someId"`
 * both appear in the code. Single-presence-of-a-pair check, same
 * low-false-positive shape as the manifest/JSON-LD checks above.
 */
export function hasAxSkipNavGap(code: string): boolean {
  const src = code || ''
  const skipLinkMatch = src.match(/<a[^>]*\bhref\s*=\s*["']#([\w-]+)["'][^>]*(?:data-agent-action\s*=\s*["']skip-nav["']|>[\s\S]{0,40}skip to main)/i)
    || src.match(/<a[^>]*\bdata-agent-action\s*=\s*["']skip-nav["'][^>]*\bhref\s*=\s*["']#([\w-]+)["']/i)
  if (!skipLinkMatch) return true
  const targetId = skipLinkMatch[1]
  const hasTarget = new RegExp(`\\bid\\s*=\\s*["']${targetId}["']`).test(src)
  return !hasTarget
}

export function hasAxJsonLdGap(code: string): boolean {
  return !/<script[^>]*\btype\s*=\s*["']application\/ld\+json["']/.test(code || '')
}

/**
 * AX compliance, follow-up (builder#687 item 2): every `<nav>` element must
 * carry `aria-label`. CONDITIONAL, unlike the root main landmark — a
 * legitimately simple single-section app (a plain counter, a single-form
 * tool) may have no `<nav>` at all, and that's fine; this only fires once
 * the app has ALREADY chosen to render navigation without labeling it.
 * Matches every opening `<nav` tag individually rather than a single
 * presence/absence check, since a multi-file app can render more than one.
 */
export function hasAxNavLabelGap(code: string): boolean {
  const src = code || ''
  const navTags = src.match(/<nav\b[^>]*>/gi) || []
  if (navTags.length === 0) return false
  return navTags.some((tag) => !/\baria-label\s*=/.test(tag))
}

/**
 * AX compliance, follow-up (builder#687 item 3): every `<section>` element
 * must carry `aria-label`. Same conditional shape as hasAxNavLabelGap — an
 * app with no `<section>` elements at all has nothing to flag.
 */
export function hasAxSectionLabelGap(code: string): boolean {
  const src = code || ''
  const sectionTags = src.match(/<section\b[^>]*>/gi) || []
  if (sectionTags.length === 0) return false
  return sectionTags.some((tag) => !/\baria-label\s*=/.test(tag))
}

/**
 * AX compliance, follow-up (builder#687 item 4): `data-agent-role`/
 * `data-agent-action`/`data-agent-context` on interactive elements. This is
 * explicitly a COVERAGE claim (per the issue's own framing), not a single
 * presence/absence check — "on ALL interactive elements" can't be verified
 * exactly with a regex without false-positives on legitimately decorative
 * buttons/links. Conservative compromise: count real interactive elements
 * (<button>, and <a> with an href that isn't just "#") vs. how many carry
 * ANY of the three data-agent-* markers, and only flag a gap when there are
 * several interactive elements and NONE of them are tagged — i.e. the
 * pattern is entirely absent from the app, not merely incomplete. A
 * genuinely partial gap (3 of 5 buttons tagged) is judged not worth
 * re-prompting over — it's real coverage, just imperfect, and chasing 100%
 * risks the same false-positive/thrash-on-a-legitimately-fine-app failure
 * mode this file's own design philosophy warns against.
 */
export function hasAxAgentAttributesGap(code: string): boolean {
  const src = code || ''
  const interactiveCount =
    (src.match(/<button\b/gi) || []).length +
    (src.match(/<a\b[^>]*\bhref\s*=\s*["'](?!#["'])[^"']+["']/gi) || []).length
  if (interactiveCount < 2) return false // too little interactive surface to judge coverage at all
  const taggedCount = (src.match(/data-agent-(role|action|context)\s*=/gi) || []).length
  return taggedCount === 0
}

/**
 * AX compliance, follow-up (builder#687 item 7): ARIA roles on complex
 * widgets. Rather than trying to detect every possible "complex widget"
 * shape (high false-positive risk per this file's own philosophy), this
 * targets the two patterns already regex-detected elsewhere in this exact
 * file for OTHER reasons — a tab-like widget (matched by the stepper AIKit
 * pattern's shape: numbered/active-state controls) and a live status/
 * loading region — since both are common in generated dashboards and both
 * have a well-known, unambiguous correct ARIA role with no legitimate
 * reason to omit it once the pattern is already present.
 */
export function hasAxComplexWidgetRoleGap(code: string): boolean {
  const src = code || ''
  // Tab-like widget: multiple sibling buttons driving an `activeTab`/
  // `currentTab`-style state, with no tablist/tab roles anywhere.
  const looksLikeTabs = /(activeTab|currentTab|selectedTab)/i.test(src) && /<button\b/i.test(src)
  const hasTabRoles = /\brole\s*=\s*["']tab(list)?["']/i.test(src)
  if (looksLikeTabs && !hasTabRoles) return true
  // Live status/loading region: a spinner/loading UI with no status role
  // and no aria-live — a screen reader/agent gets no signal anything changed.
  const looksLikeLiveStatus = /(loading|isLoading|spinner)/i.test(src) && /(animate-spin|Loading\.\.\.|Loading…)/i.test(src)
  const hasStatusSignal = /\brole\s*=\s*["']status["']|\baria-live\s*=/i.test(src)
  if (looksLikeLiveStatus && !hasStatusSignal) return true
  return false
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
  /** Real bug (found live): a favorite/like/save toggle on a hardcoded array
   *  — genuine interaction silently lost on reload. */
  hardcodedToggleGap: boolean
  /** AX compliance: no root `<main aria-label>` landmark (checklist item 1). */
  axLandmarkGap: boolean
  /** AX compliance: no hidden agent action manifest (checklist item 5). */
  axManifestGap: boolean
  /** AX compliance: no JSON-LD structured data (checklist item 6). */
  axJsonLdGap: boolean
  /** AX compliance: no skip-nav link to a real landmark (checklist item 8). */
  axSkipNavGap: boolean
  /** AX compliance: a <nav> element with no aria-label (checklist item 2). */
  axNavLabelGap: boolean
  /** AX compliance: a <section> element with no aria-label (checklist item 3). */
  axSectionLabelGap: boolean
  /** AX compliance: interactive elements with no data-agent-* markers at all (checklist item 4). */
  axAgentAttributesGap: boolean
  /** AX compliance: a complex widget (tabs/live-status) missing its ARIA role (checklist item 7). */
  axComplexWidgetRoleGap: boolean
  reasons: string[]
}

/**
 * Real bug found live (Meridian, 2026-09-10, issue #612): a Company-track
 * landing page's underlying idea can legitimately match a real primitive's
 * trigger keywords (Meridian's idea genuinely says "sales pipeline data" →
 * correctly matches ZeroPipeline) even though the generation itself is
 * `company-app/route.ts`'s marketing-copy-only page (hero/features/pricing/
 * footer) — which has no legitimate reason to call ANY primitive's live API.
 * The re-prompt this triggered ("call ZeroPipeline in your marketing page")
 * pushed the model toward inventing pipeline-shaped UI in what should stay a
 * static page, contributing to repeated truncation (confirmed live: 5
 * straight generation attempts truncated on missing ./ui/* imports while
 * this exact gap fired every time). `landingPageOnly` opts a caller out of
 * ONLY the primitive-compliance check — every other gap (AIKit usage,
 * persistence, visitor tracking, lead capture) still applies normally, since
 * those are legitimately unconditional per this file's existing design.
 */
export interface CheckObedienceOptions {
  landingPageOnly?: boolean
}

/** Inspect generated code + idea; report obedience gaps for the re-prompt. */
export function checkObedience(
  code: string,
  idea: string,
  role?: CompanyRole,
  options?: CheckObedienceOptions,
): ObedienceResult {
  const persistenceGap = hasPersistenceGap(code, idea)
  const aikitGaps = findAikitGaps(code)
  const primitiveComplianceGaps = options?.landingPageOnly ? [] : findPrimitiveComplianceGaps(code, idea, role)
  const visitorTrackingGap = hasVisitorTrackingGap(code)
  const fakeLeadCaptureGap = hasFakeLeadCaptureGap(code)
  const hardcodedToggleGap = hasHardcodedToggleGap(code)
  const axLandmarkGap = hasAxLandmarkGap(code)
  const axManifestGap = hasAxManifestGap(code)
  const axJsonLdGap = hasAxJsonLdGap(code)
  const axSkipNavGap = hasAxSkipNavGap(code)
  const axNavLabelGap = hasAxNavLabelGap(code)
  const axSectionLabelGap = hasAxSectionLabelGap(code)
  const axAgentAttributesGap = hasAxAgentAttributesGap(code)
  const axComplexWidgetRoleGap = hasAxComplexWidgetRoleGap(code)
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
  if (hardcodedToggleGap) {
    reasons.push('A favorite/like/save toggle on a hardcoded list resets on reload — must persist via /api/db.')
  }
  if (axLandmarkGap) {
    reasons.push('No root <main aria-label="..."> landmark — required so AI agents can parse and navigate the page.')
  }
  if (axManifestGap) {
    reasons.push('No hidden agent action manifest (data-agent-manifest="true") — required so agents can discover available actions.')
  }
  if (axJsonLdGap) {
    reasons.push('No JSON-LD structured data (<script type="application/ld+json">) — required so agents can parse what the app does.')
  }
  if (axSkipNavGap) {
    reasons.push('No skip-navigation link to a real landmark — a link that does not target a real id="..." is worse than none at all.')
  }
  if (axNavLabelGap) {
    reasons.push('A <nav> element has no aria-label — required so agents can distinguish multiple navigation regions.')
  }
  if (axSectionLabelGap) {
    reasons.push('A <section> element has no aria-label — required so agents can identify each major content block.')
  }
  if (axAgentAttributesGap) {
    reasons.push('No data-agent-role/data-agent-action/data-agent-context markers anywhere despite real interactive elements — agents cannot discover what they can click.')
  }
  if (axComplexWidgetRoleGap) {
    reasons.push('A complex widget (tabs or a live status/loading region) is missing its ARIA role — agents/screen readers get no signal about its behavior.')
  }
  return { ok: reasons.length === 0, persistenceGap, aikitGaps, primitiveComplianceGaps, visitorTrackingGap, fakeLeadCaptureGap, hardcodedToggleGap, axLandmarkGap, axManifestGap, axJsonLdGap, axSkipNavGap, axNavLabelGap, axSectionLabelGap, axAgentAttributesGap, axComplexWidgetRoleGap, reasons }
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
  if (result.hardcodedToggleGap) {
    parts.push(
      '6) PERSIST THE FAVORITE/LIKE/SAVE TOGGLE — it currently only flips a field in a hardcoded, in-memory array',
      '   (useState([{...}])), so every toggle resets the instant the page reloads. Load the list from /api/db on',
      '   mount, and PUT the toggled field back on each click:',
      "   fetch(`/api/db/<table>?id=${item.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'},",
      "     body: JSON.stringify({ favorited: !item.favorited }) }).catch(() => {})",
      '   Keep the same instant-feeling UI (update local state immediately, PUT in the background).',
      '',
    )
  }
  if (result.axLandmarkGap) {
    parts.push(
      '7) ADD THE ROOT AX LANDMARK — the outermost element the component returns must be',
      '   <main aria-label="{App Name} - {one-line page description}"> wrapping everything else.',
      '   Example: <main aria-label="Scorch - hot sauce subscription dashboard">...</main>',
      '   This is required so AI agents can parse and navigate the page. Do not change anything else about the layout.',
      '',
    )
  }
  if (result.axManifestGap) {
    parts.push(
      '8) ADD A HIDDEN AGENT ACTION MANIFEST — a hidden block listing the page\'s real interactive elements, so an',
      '   agent can discover what it can do without guessing at the DOM:',
      '   <div hidden data-agent-manifest="true" aria-hidden="true">',
      '     <script type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify({',
      '       actions: [{ id: "add", type: "button", selector: \'[data-agent-action="add"]\', description: "Add a new item" }],',
      '       sections: [{ id: "list", selector: \'[data-agent-context="items-list"]\', description: "The main list" }]',
      '     }) }} />',
      '   </div>',
      '   List the app\'s REAL actions/sections, not the example above verbatim.',
      '',
    )
  }
  if (result.axJsonLdGap) {
    parts.push(
      '9) ADD JSON-LD STRUCTURED DATA — a hidden Schema.org block describing what this app is:',
      '   <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({',
      '     "@context": "https://schema.org", "@type": "SoftwareApplication",',
      '     "name": "{App Name}", "description": "{one-line description}"',
      '   }) }} />',
      '',
    )
  }
  if (result.axSkipNavGap) {
    parts.push(
      '10) ADD A SKIP-NAVIGATION LINK — as the FIRST element returned, before anything else, AND make sure it',
      '    targets a real id that actually exists elsewhere in the same file:',
      '    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4',
      '    focus:z-50 focus:bg-white focus:px-4 focus:py-2" data-agent-action="skip-nav">Skip to main content</a>',
      '    ... then somewhere in the real content: <main id="main-content" aria-label="...">',
      '    A skip-link with no matching id is worse than none — do not add the link without also adding the id.',
      '',
    )
  }
  if (result.axNavLabelGap) {
    parts.push(
      '11) LABEL YOUR <nav> ELEMENT(S) — every <nav> must carry aria-label describing what it navigates:',
      '    <nav aria-label="Main navigation">...</nav>   <nav aria-label="Pagination">...</nav>',
      '    Do not add a <nav> that was not already there — only label the ones that already exist.',
      '',
    )
  }
  if (result.axSectionLabelGap) {
    parts.push(
      '12) LABEL YOUR <section> ELEMENT(S) — every <section> must carry aria-label describing that block:',
      '    <section aria-label="Recent activity">...</section>',
      '    Do not add a <section> that was not already there — only label the ones that already exist.',
      '',
    )
  }
  if (result.axAgentAttributesGap) {
    parts.push(
      '13) TAG INTERACTIVE ELEMENTS FOR AGENTS — add data-agent-role/data-agent-action/data-agent-context to your',
      '    real buttons and links so an agent can discover what it can do without guessing at the DOM:',
      '    <button data-agent-role="button" data-agent-action="add-item">Add</button>',
      '    <a href="/settings" data-agent-role="link" data-agent-context="settings">Settings</a>',
      '    You do not need every single element — tag the primary/real actions a user (or agent) would take.',
      '',
    )
  }
  if (result.axComplexWidgetRoleGap) {
    parts.push(
      '14) ADD ARIA ROLES TO YOUR COMPLEX WIDGET — a tab-like control or a live status/loading region has no role:',
      '    Tabs:   <div role="tablist"><button role="tab" aria-selected={isActive}>...</button></div>',
      '    Status: <div role="status" aria-live="polite">Loading…</div>',
      '    Only add the role to the pattern that already exists — do not invent a new widget.',
      '',
    )
  }
  parts.push('Return the corrected full app. Do not remove features.')
  return parts.join('\n')
}

/**
 * Real gap found live (issue #624, Meridian real-product build, 2026-09-10):
 * the general obedience-repair pass in chat-ws adopts a candidate if ANY
 * dimension improved (e.g. AIKit hand-rolling fixed) even when
 * primitiveComplianceGaps — the dimension that most defines whether a real
 * product actually calls its primitives — is still wide open. Confirmed
 * live: a repair pass correctly fixed a hand-rolled AIKitHeader but left
 * "ZeroPipeline, ZeroVoice, ZeroMemory never called" completely unresolved,
 * and the general improved-on-ANY-dimension check adopted it anyway.
 *
 * Produces a narrowed ObedienceResult carrying ONLY the still-open primitive
 * gaps, so buildObediencePrompt(idea, narrowed) emits a re-prompt focused
 * entirely on closing that one gap — no distracting instructions about
 * dimensions that are already fixed.
 */
export function narrowToPrimitiveComplianceOnly(gaps: string[]): ObedienceResult {
  return {
    ok: gaps.length === 0,
    persistenceGap: false,
    aikitGaps: [],
    primitiveComplianceGaps: gaps,
    visitorTrackingGap: false,
    fakeLeadCaptureGap: false,
    hardcodedToggleGap: false,
    axLandmarkGap: false,
    axManifestGap: false,
    axJsonLdGap: false,
    axSkipNavGap: false,
    axNavLabelGap: false,
    axSectionLabelGap: false,
    axAgentAttributesGap: false,
    axComplexWidgetRoleGap: false,
    reasons: [],
  }
}

/**
 * Did a targeted primitive-compliance retry make real progress? Pure
 * decision function so the orchestration in chat-ws (which owns the actual
 * model call) stays testable without mocking an LLM. `closed` is true only
 * when the gap is FULLY resolved — a caller wanting a bounded retry loop
 * should keep retrying while `!closed && madeProgress`, and stop (keep the
 * prior version) the moment a retry makes zero progress.
 */
export function evaluatePrimitiveComplianceRetry(
  beforeGaps: string[],
  afterGaps: string[],
): { madeProgress: boolean; closed: boolean } {
  return {
    madeProgress: afterGaps.length < beforeGaps.length,
    closed: afterGaps.length === 0,
  }
}
