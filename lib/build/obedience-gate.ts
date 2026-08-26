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
 *
 * Pure + deterministic. Never throws. Conservative — a false "no gap" is fine (the
 * app still works); we only re-prompt on a HIGH-confidence gap so we don't waste
 * turns on apps that legitimately don't need persistence/AIKit (e.g. a counter).
 */

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

export interface ObedienceResult {
  ok: boolean
  persistenceGap: boolean
  aikitGaps: string[]
  reasons: string[]
}

/** Inspect generated code + idea; report obedience gaps for the re-prompt. */
export function checkObedience(code: string, idea: string): ObedienceResult {
  const persistenceGap = hasPersistenceGap(code, idea)
  const aikitGaps = findAikitGaps(code)
  const reasons: string[] = []
  if (persistenceGap) {
    reasons.push('App manages user records but hardcodes data — must persist via /api/db.')
  }
  if (aikitGaps.length) {
    reasons.push(`Hand-rolled UI that AIKit provides: ${aikitGaps.join(', ')}.`)
  }
  return { ok: reasons.length === 0, persistenceGap, aikitGaps, reasons }
}

/**
 * Build a focused re-prompt that tells the model EXACTLY what to fix, appended to
 * the broken code. Reused by the chat-ws obedience retry (mirrors buildRepairPrompt).
 */
export function buildObediencePrompt(idea: string, result: ObedienceResult): string {
  const parts: string[] = [
    'The generated app works but does NOT follow two required AINative rules. Fix ONLY these, keep everything else:',
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
  parts.push('Return the corrected full app. Do not remove features.')
  return parts.join('\n')
}
