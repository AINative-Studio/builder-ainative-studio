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
 * Real, live bug found on a real company (#1581, flipsight): a waitlist
 * submit handler DID persist the real email via /api/db (so hasFakeLeadCaptureGap
 * above correctly does NOT flag it) but ALSO called `alert(...)` as its success
 * notification. A native alert() blocks the page's ENTIRE main thread until a
 * human manually dismisses it — a real visitor submitting the form hit what
 * looked like a completely frozen, dead page, with zero recovery short of a
 * manual reload. This is a strictly worse outcome than the fake-lead-capture
 * gap above (which at least leaves the page responsive); it was never caught
 * because `hasAlertOnlyHandler` (used by hasFakeButtonGap) deliberately only
 * flags a handler whose ENTIRE body is alert() — a handler that does real work
 * AND also calls alert() was explicitly treated as fine. It isn't: alert() is
 * never an acceptable success UI for a form that persists real user data,
 * regardless of what else the handler does.
 */
/** Index of a quote's matching closing quote (honoring `\` escapes), or -1 if unterminated. */
function findStringEnd(code: string, openIdx: number, quote: string): number {
  let i = openIdx + 1
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue }
    if (code[i] === quote) return i
    i++
  }
  return -1
}

/** Index of a template literal's closing backtick (honoring `\` escapes and skipping over `${}` interpolations), or -1 if unterminated. */
function findBacktickEnd(code: string, openIdx: number): number {
  let i = openIdx + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '`') return i
    if (ch === '$' && code[i + 1] === '{') {
      const closeIdx = findMatchingBracket(code, i + 1, '{', '}')
      if (closeIdx === -1) return -1
      i = closeIdx + 1
      continue
    }
    i++
  }
  return -1
}

/**
 * Index of the matching closing bracket for the opener at `openIdx` (depth-aware,
 * honoring arbitrarily nested brackets of the SAME kind), skipping over nested
 * string/template literals so a quote/backtick-delimited character is never
 * mistaken for bracket-relevant syntax. Or -1 if unbalanced.
 *
 * Real bug this replaces: a flat char-by-char `(`/`)` (or `{`/`}`) count has no
 * notion of string content — it miscounts the moment a string literal it's
 * scanning THROUGH contains a lone, unmatched instance of the very character
 * being tracked. An emoticon in user-facing copy is exactly that: `alert('Thanks
 * :)')`'s message contains a bare `)` with no matching `(`, so counting hit that
 * `)` as if it closed the call, returning the SMILEY's paren instead of the real
 * one — truncating hasAlertOnlyHandler's view of the call and making an
 * alert()-only fake-CTA handler (#844, the exact bug this gate exists to catch)
 * silently invisible the moment its placeholder text includes a smiley or any
 * other lone `)`/`}`. Skipping over string/template-literal spans entirely (same
 * technique already proven in template-literal-to-concat.ts) fixes this without
 * changing behavior for a string with no stray bracket characters (same bracket
 * found either way).
 */
function findMatchingBracket(code: string, openIdx: number, open: string, close: string): number {
  let depth = 0
  let i = openIdx
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (ch === '`') {
      const end = findBacktickEnd(code, i)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (ch === open) { depth++; i++; continue }
    if (ch === close) {
      depth--
      if (depth === 0) return i
      i++
      continue
    }
    i++
  }
  return -1
}

/**
 * Scan forward from just after a JSX tag's name (`attrsStart`) to the index
 * of the `>` that closes it — depth-aware over `{}` so a `>` inside a JSX
 * expression attribute (e.g. `aria-hidden={count > 0}`) is never mistaken
 * for the tag's end (the bug hasNoOpCtaButton/matchOpeningTags/etc already
 * fix, #1641/#1664-1671), AND skipping over quoted string/template-literal
 * attribute values entirely (same technique as findMatchingBracket above) —
 * without that, a stray, UNMATCHED `{` inside a literal attribute string
 * (e.g. `title="Price: {amount"`, as opposed to the balanced `title="Save
 * {10}% today"`) throws depth permanently out of balance, so the scanner
 * never finds the tag's real `>` and the whole element is misread as
 * unterminated and silently skipped — hiding a real compliance gap (no-op
 * CTA, missing landmark/skip-nav, hand-rolled AIKit pattern) behind nothing
 * more than ordinary user-facing copy containing a brace character.
 * Returns -1 if genuinely unterminated.
 */
function findTagClose(code: string, attrsStart: number): number {
  let depth = 0
  let i = attrsStart
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (ch === '`') {
      const end = findBacktickEnd(code, i)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (ch === '{') { depth++; i++; continue }
    if (ch === '}') { depth--; i++; continue }
    if (ch === '>' && depth <= 0) return i
    i++
  }
  return -1
}

/** Index of the `)` matching the `(` at `openIndex`, or -1 if unbalanced. */
function findMatchingParen(code: string, openIndex: number): number {
  return findMatchingBracket(code, openIndex, '(', ')')
}

export function hasAlertInLeadCaptureGap(code: string): boolean {
  if (!looksLikeLeadCapture(code)) return false
  // Scope the alert() search to each matched handler's own body (brace-balanced),
  // not the whole file — an unrelated alert() elsewhere (e.g. a delete-confirm
  // dialog) is a different, legitimate use this gap must not false-positive on.
  //
  // The param list after the handler name is walked with depth-aware
  // findMatchingParen() rather than a flat `\([^)]*\)` regex — the same
  // nested-paren bug class as #1619/#1621 (component-detector.ts,
  // dedupe-provided-components.ts): `[^)]*` can't cross a `)` INSIDE the
  // param list, so a destructured default that calls a function (e.g.
  // `async (e = getDefaultEvent()) => {`) made the whole handler invisible
  // to this gap, silently missing a real alert()-freezes-the-page bug.
  const handlerStartRe = /(handleSubmit|handleEarlyAccess|handleWaitlist|handleSignup)\s*[:=]\s*(?:async\s*)?/g
  let m: RegExpExecArray | null
  while ((m = handlerStartRe.exec(code))) {
    const pos = m.index + m[0].length
    let paramEnd: number
    if (code[pos] === '(') {
      const close = findMatchingParen(code, pos)
      if (close === -1) continue
      paramEnd = close + 1
    } else {
      const ident = /^[A-Za-z_$][\w$]*/.exec(code.slice(pos))
      if (!ident) continue
      paramEnd = pos + ident[0].length
    }
    const arrow = /^\s*=>\s*\{/.exec(code.slice(paramEnd))
    if (!arrow) continue
    const bodyStart = paramEnd + arrow[0].length - 1 // position of the opening {
    let depth = 0
    let end = bodyStart
    for (; end < code.length; end++) {
      if (code[end] === '{') depth++
      else if (code[end] === '}') { depth--; if (depth === 0) { end++; break; } }
    }
    const body = code.slice(bodyStart, end)
    if (/\balert\(/.test(body) && /\/api\/db\//.test(body)) return true
  }
  return false
}

/**
 * Real, live bug found on a real founder's live landing page (#844, agentive/
 * amador@selfpreneur.com): a top-nav "Sign In" button whose ONLY handler was
 * `onClick={() => alert('Sign In')}` — Cody-generated placeholder code that
 * was never wired to a real auth flow. A real visitor clicking it got a
 * native browser dialog and nothing else; they could not sign in at all. A
 * SECOND button on the same page ("Get Early Access" in the top nav, distinct
 * from the real, working hero-section waitlist form) had no onClick/action
 * attribute whatsoever — clicking it did nothing, silently.
 *
 * These are the same class of defect as the lead-capture gap above (a
 * CTA-shaped control that LOOKS interactive but has no real behavior behind
 * it), just for buttons instead of forms. A button whose only handler body is
 * a bare `alert(...)` call, or a button/anchor with CTA-shaped text
 * ("sign in", "log in", "get started", "get early access", "join", "sign up")
 * and no click handler / href at all, is always a defect — there is no
 * legitimate reason for either shape in generated code.
 */
const CTA_BUTTON_TEXT = /sign\s*in|log\s*in|get\s*started|get\s*early\s*access|join\s*(now|waitlist)?|sign\s*up/i

function hasAlertOnlyHandler(code: string): boolean {
  // onClick={() => alert('...')} / onClick={() => { alert('...') }} /
  // onClick={function(){ alert('...') }} with nothing else in the handler
  // body (a real handler calling alert() as part of a larger flow, e.g.
  // after a real fetch(), is NOT flagged).
  //
  // The function's own param list and alert()'s own argument list are
  // walked with depth-aware findMatchingBracket() rather than a flat
  // `\([^)]*\)` regex -- same nested-paren bug class as #1609/#1611/#1615/
  // #1617/#1619/#1621/#1623: a default param that calls a function
  // (`function(e = getDefaultEvent())`) or an alert() argument that is
  // itself a call (`alert(getMessage())`) made this entirely invisible,
  // silently missing a real fake-CTA bug.
  const onClickRe = /onClick=\{/g
  let m: RegExpExecArray | null
  while ((m = onClickRe.exec(code))) {
    const openBraceIdx = m.index + m[0].length - 1
    const closeBraceIdx = findMatchingBracket(code, openBraceIdx, '{', '}')
    if (closeBraceIdx === -1) continue
    const inner = code.slice(openBraceIdx + 1, closeBraceIdx).trim()

    let bodyStart = -1
    const arrowNoParams = /^\(\)\s*=>\s*/.exec(inner)
    if (arrowNoParams) {
      bodyStart = arrowNoParams[0].length
    } else {
      const fnStart = /^function\s*\(/.exec(inner)
      if (fnStart) {
        const fnOpenIdx = fnStart[0].length - 1
        const fnCloseIdx = findMatchingBracket(inner, fnOpenIdx, '(', ')')
        if (fnCloseIdx === -1) continue
        const afterParams = /^\s*/.exec(inner.slice(fnCloseIdx + 1))!
        bodyStart = fnCloseIdx + 1 + afterParams[0].length
      }
    }
    if (bodyStart === -1) continue

    let body = inner.slice(bodyStart)
    if (body.startsWith('{')) {
      const blockCloseIdx = findMatchingBracket(body, 0, '{', '}')
      if (blockCloseIdx === -1) continue
      body = body.slice(1, blockCloseIdx).trim()
    }
    // The body must be ONLY a single alert(...) call (optional trailing `;`).
    const alertStart = /^alert\(/.exec(body)
    if (!alertStart) continue
    const alertOpenIdx = alertStart[0].length - 1
    const alertCloseIdx = findMatchingBracket(body, alertOpenIdx, '(', ')')
    if (alertCloseIdx === -1) continue
    const trailing = body.slice(alertCloseIdx + 1).trim()
    if (trailing === '' || trailing === ';') return true
  }
  return false
}

function hasNoOpCtaButton(code: string): boolean {
  // A <button>/<a> whose visible text matches a CTA phrase, scanned within a
  // small window for an onClick/href — absent means genuinely no behavior.
  //
  // Real bug (#1641): a flat `[^>]*` for the attrs stops at the FIRST `>`,
  // which a JSX expression container among the attributes can contain as an
  // ordinary comparison operator (e.g. `className={x > 5 ? 'a' : 'b'}
  // onClick={handleClick}`) — truncating `attrs` before it ever reaches the
  // real `onClick=`, so a button with a genuine handler gets misread as
  // having none and false-flagged as a no-op CTA. Tracking `{}` depth to
  // find the tag's real closing `>` fixes that without changing behavior
  // for attributes with no expression containers (same `>` found either
  // way).
  const openTagRe = /<(button|a)\b/gi
  let match: RegExpExecArray | null
  while ((match = openTagRe.exec(code))) {
    const tagName = match[1]
    const attrsStart = match.index + match[0].length
    const i = findTagClose(code, attrsStart)
    if (i === -1) continue // unterminated tag
    const attrs = code.slice(attrsStart, i)
    const rest = code.slice(i + 1, i + 1 + 60 + tagName.length + 3)
    const textMatch = rest.match(new RegExp(`^([^<]{0,60})<\\/${tagName}>`, 'i'))
    if (!textMatch) continue
    const text = textMatch[1]
    if (!CTA_BUTTON_TEXT.test(text)) continue
    const hasHandler = /onClick=|href=|data-agent-action=/.test(attrs)
    if (!hasHandler) return true
  }
  return false
}

/**
 * True when the app has a CTA-shaped button that either (a) fires nothing but
 * a bare alert() or (b) has no click handler/href at all. Unconditional like
 * visitor tracking and lead capture — any generated app can have a nav with
 * Sign In / Get Started / Get Early Access buttons regardless of its idea.
 */
export function hasFakeButtonGap(code: string): boolean {
  return hasAlertOnlyHandler(code) || hasNoOpCtaButton(code)
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
 * Real, live bug found live (#1598, agentis — "a social feed for AI agents"):
 * a feed/composer UI (type a message, click Post/Broadcast/Send, it appears
 * in the feed immediately) is genuine user-generated content, silently lost
 * on reload — same defect class as the toggle/lead-capture gaps above, a
 * THIRD distinct UI shape (append-to-a-list via a composer input + submit,
 * not a form that then shows a static success state, and not a per-item
 * boolean flip). `hasPersistenceGap` structurally cannot catch this even
 * though it DOES require list + onClick/onSubmit: `usesDataLayer(code)`
 * short-circuits the ENTIRE check the moment the file calls `/api/db`
 * ANYWHERE — including the mandated visitor-tracking beacon every generated
 * app includes regardless of its core feature. A file can legitimately call
 * `/api/db/visitors` while its actual composer/feed feature never touches
 * `/api/db` at all; the blunt file-wide `usesDataLayer` check can't tell
 * those apart. `PERSISTENCE_IDEA_HINTS` also has no keyword for a social/
 * feed/marketplace shape ("Where AI agents meet, trade, and thrive" matches
 * none of them) — confirming this needs its own unconditional, shape-based
 * detector, exactly like the toggle gap, not an idea-hint addition (an idea
 * keyword list can never enumerate every possible app shape).
 */
function extractComposerHandlerBody(code: string): string | null {
  const nameMatch = code.match(
    /\b(handlePost|handleBroadcast|handleSend|handlePublish|handleCreatePost|handleSubmitPost|handleShare)\s*[:=]/,
  )
  if (!nameMatch) return null
  // Grab a bounded window AFTER the handler's own name/assignment — large
  // enough to cover a realistic handler body, but scoped to THIS handler
  // rather than the whole file, so an unrelated /api/db call elsewhere
  // (e.g. the mandated visitor beacon) can never hide a missing persistence
  // call inside this specific handler. Bounded, not brace-matched, to stay
  // a cheap regex-only check consistent with every other detector here.
  const start = nameMatch.index ?? 0
  return code.slice(start, start + 600)
}

function looksLikeUnpersistedComposer(code: string): boolean {
  // A hardcoded seed array of post/feed-shaped objects to append to.
  const hasHardcodedArray = /useState\(\s*\[\s*\{/.test(code)
  // A composer: a text input/textarea PAIRED with a submit handler whose
  // name suggests posting/broadcasting/sending content (not a generic form
  // submit — that's `looksLikeLeadCapture`'s territory, a different shape:
  // single capture + static success state, never an append-to-a-visible-list).
  const hasComposerHandler =
    /\b(handlePost|handleBroadcast|handleSend|handlePublish|handleCreatePost|handleSubmitPost|handleShare)\s*[:=]/.test(code)
  // The composer's own setter PREPENDS/APPENDS a new item onto the existing
  // array — `setX(prev => [newItem, ...prev])` or `[...prev, newItem]` — the
  // exact "it shows up immediately" optimistic-UI shape that makes the bug
  // invisible without a reload. A toggle (per-item field flip via `.map`)
  // does not match this and is the sibling check's own territory instead.
  const hasListAppend = /set\w+\(\s*\(?prev\)?\s*=>\s*\[(?:[\s\S]{0,80}\.\.\.prev|prev,)[\s\S]{0,200}\]\s*\)/.test(code)
  return hasHardcodedArray && hasComposerHandler && hasListAppend
}

export function hasUnpersistedComposerGap(code: string): boolean {
  if (!looksLikeUnpersistedComposer(code)) return false
  // Feature-scoped, not file-wide: #1598's exact bug was that a blunt
  // whole-file `usesDataLayer` check gets fooled by an unrelated /api/db
  // call anywhere else in the file (e.g. the mandated visitor beacon). Check
  // only the composer handler's OWN body for a /api/db call.
  const handlerBody = extractComposerHandlerBody(code)
  if (!handlerBody) return false
  return !usesDataLayer(handlerBody)
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

/**
 * All opening tags for `tagName` (e.g. "main"), as the full attribute text
 * up to the tag's real closing `>` — depth-aware over `{}` so a JSX
 * expression attribute that itself contains a `>` (a comparison, e.g.
 * `aria-hidden={count > 0}`) is never mistaken for the tag's end. Same bug
 * class as hasNoOpCtaButton's own fix (#1641): a flat `[^>]*` stops at the
 * FIRST `>`, truncating the tag before a later real attribute (aria-label,
 * type="application/ld+json", ...) is ever reached — making a genuinely-
 * compliant element false-flagged as missing it.
 */
function matchOpeningTags(code: string, tagName: string): string[] {
  const tags: string[] = []
  const openTagRe = new RegExp(`<${tagName}\\b`, 'gi')
  let match: RegExpExecArray | null
  while ((match = openTagRe.exec(code))) {
    const attrsStart = match.index + match[0].length
    const i = findTagClose(code, attrsStart)
    if (i === -1) continue // unterminated tag
    tags.push(code.slice(match.index, i + 1))
  }
  return tags
}

export function hasAxLandmarkGap(code: string): boolean {
  const mainTags = matchOpeningTags(code || '', 'main')
  return mainTags.length === 0 || !mainTags.some((tag) => /\baria-label\s*=/.test(tag))
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
 *
 * Finds the `<a>` tag's real closing `>` the same depth-aware way
 * matchOpeningTags does (#1668 — same truncation bug matchOpeningTags
 * fixes for other tags applied here to an earlier JSX-comparison attribute
 * before `href`), then accepts either half of the original two shapes
 * (the `data-agent-action="skip-nav"` marker anywhere in the tag, or the
 * "skip to main" text immediately following it) regardless of attribute
 * order — subsuming the original's two separately-ordered regex branches.
 */
export function hasAxSkipNavGap(code: string): boolean {
  const src = code || ''
  const anchorRe = /<a\b/gi
  let m: RegExpExecArray | null
  let targetId: string | null = null
  while ((m = anchorRe.exec(src))) {
    const attrsStart = m.index + m[0].length
    const i = findTagClose(src, attrsStart)
    if (i === -1) continue // unterminated tag
    const tag = src.slice(m.index, i + 1)
    const hrefMatch = tag.match(/\bhref\s*=\s*["']#([\w-]+)["']/)
    if (!hrefMatch) continue
    const hasActionMarker = /\bdata-agent-action\s*=\s*["']skip-nav["']/.test(tag)
    const followingText = src.slice(i + 1, i + 1 + 40)
    const hasSkipText = /skip to main/i.test(followingText)
    if (hasActionMarker || hasSkipText) {
      targetId = hrefMatch[1]
      break
    }
  }
  if (!targetId) return true
  const hasTarget = new RegExp(`\\bid\\s*=\\s*["']${targetId}["']`).test(src)
  return !hasTarget
}

export function hasAxJsonLdGap(code: string): boolean {
  const scriptTags = matchOpeningTags(code || '', 'script')
  return !scriptTags.some((tag) => /\btype\s*=\s*["']application\/ld\+json["']/.test(tag))
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
  const navTags = matchOpeningTags(src, 'nav')
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
  const sectionTags = matchOpeningTags(src, 'section')
  if (sectionTags.length === 0) return false
  return sectionTags.some((tag) => !/\baria-label\s*=/.test(tag))
}

/**
 * AX compliance, follow-up (builder#687 item 4): `data-agent-role`/
 * `data-agent-action`/`data-agent-context` on interactive elements. This is
 * explicitly a COVERAGE claim (per the issue's own framing), not a single
 * presence/absence check — "on ALL interactive elements" can't be verified
 * exactly with a regex without demanding 100% and risking false-positive
 * thrash on legitimately decorative controls (a toast's "×" dismiss, a
 * disclosure caret). Real coverage-ratio check, not mere presence:
 *
 *   - Count real interactive elements: <button> and <a> with a genuine
 *     href (not just "#"). Each element is counted once, regardless of how
 *     many data-agent-* attributes it carries (a single element tagged with
 *     all three must not inflate the count vs. one tagged with one).
 *   - Require at least AX_AGENT_ATTR_COVERAGE_THRESHOLD (50%) of them to
 *     carry at least one data-agent-* marker. The required count rounds DOWN
 *     (Math.floor), the more forgiving direction for an odd element count —
 *     e.g. 3 elements need only 1 tagged, 5 need only 2 — so a small app
 *     isn't unfairly penalized by a rounding choice that happens to work
 *     against it.
 *   - Too little interactive surface (<2 elements) is never judged at all —
 *     a one-button app has nothing meaningful to measure coverage against.
 */
export const AX_AGENT_ATTR_COVERAGE_THRESHOLD = 0.5

/** True when `tag` (a single opening element like `<button ...>`) carries at least one data-agent-* marker. */
function elementHasAgentMarker(tag: string): boolean {
  return /data-agent-(role|action|context)\s*=/i.test(tag)
}

export function hasAxAgentAttributesGap(code: string): boolean {
  const src = code || ''
  const buttonTags = matchOpeningTags(src, 'button')
  const linkTags = matchOpeningTags(src, 'a').filter((tag) => /\bhref\s*=\s*["'](?!#["'])[^"']+["']/.test(tag))
  const interactiveTags = [...buttonTags, ...linkTags]
  if (interactiveTags.length < 2) return false // too little interactive surface to judge coverage at all
  const taggedCount = interactiveTags.filter(elementHasAgentMarker).length
  const requiredCount = Math.floor(interactiveTags.length * AX_AGENT_ATTR_COVERAGE_THRESHOLD)
  return taggedCount < requiredCount
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
 * True when some `className="..."` attribute's value matches `classNameRe`
 * AND, within `maxGap` characters after that same tag's REAL closing `>`,
 * `contentRe` matches.
 *
 * Real bug this replaces: the three callers below used to splice the two
 * halves together as one regex with a flat `[^>]*>` bridging them (e.g.
 * `className="[^"]*\btext-3xl\b[^"]*"[^>]*>\s*\{?[^<]*(\$|%|\d)`). Any OTHER
 * attribute on that same tag whose JSX expression embeds an ordinary `>`
 * comparison (`data-flag={count > 0}`, `aria-current={i > 0}`, ...) is
 * common in generated code and gives the regex a premature `>` to stop at.
 * The content check then runs against text INSIDE that expression instead
 * of the element's real children — e.g. the `0` in `{count > 0}` satisfies
 * `\d` — so a plain `<div className="text-3xl" data-flag={count > 0}>
 * Loading</div>` (not a metric at all) gets misreported as a hand-rolled
 * MetricCard. Same `{}`-depth-aware technique as obedience-gate's own
 * matchOpeningTags (#1664/#1665) and output-validator's findSidebarTags
 * (#1666/#1667), applied here to land on the tag's real `>` before running
 * the content check.
 */
function hasClassNameFollowedByContent(code: string, classNameRe: RegExp, contentRe: RegExp, maxGap: number): boolean {
  const classAttrRe = /className="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = classAttrRe.exec(code))) {
    if (!classNameRe.test(m[1])) continue
    const i = findTagClose(code, classAttrRe.lastIndex)
    if (i === -1) continue // unterminated tag
    if (contentRe.test(code.slice(i + 1, i + 1 + maxGap))) return true
  }
  return false
}

/**
 * AIKit patterns the model tends to hand-roll. Each entry: either a regex, or a
 * predicate function for patterns that need to look past a tag's real closing `>`
 * (see hasClassNameFollowedByContent), that matches a HAND-ROLLED version in the
 * generated code, and the AIKit component to use instead. We only flag when the
 * AIKit component is NOT already imported/used.
 */
const AIKIT_PATTERNS: Array<{ handRolled: RegExp | ((code: string) => boolean); component: string; label: string }> = [
  // A stat/metric card: a number + a label/change, hand-built with divs.
  {
    handRolled: (code) => hasClassNameFollowedByContent(code, /\b(text-3xl|text-4xl)\b/, /^\s*\{?[^<]*(\$|%|\d)/, Infinity),
    component: 'MetricCard',
    label: 'stat/metric cards',
  },
  // A left nav column (w-NN sidebar) OR an <aside> element used as nav.
  {
    handRolled: (code) => hasClassNameFollowedByContent(code, /\b(w-64|w-56|w-72)\b/, /(nav|aside|sidebar)/i, 400),
    component: 'AIKitSidebar',
    label: 'sidebar navigation',
  },
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
  {
    handRolled: (code) =>
      hasClassNameFollowedByContent(code, /\b(bg-(red|yellow|green|blue|amber)-(50|100|500))\b/, /(alert|warning|success|error|dismiss|notice)/i, 140),
    component: 'AIKitBanner',
    label: 'banner / alert',
  },
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
    const matched = typeof p.handRolled === 'function' ? p.handRolled(src) : p.handRolled.test(src)
    if (matched) gaps.push(`${p.component} (${p.label})`)
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
  /** Real bug (found live, #1581): a lead-capture handler that DOES persist
   *  via /api/db but also calls alert() as its success UI — a native alert()
   *  freezes the page's entire main thread until manually dismissed. */
  alertInLeadCaptureGap: boolean
  /** Real bug (found live, #844): a CTA-shaped button (Sign In, Get Early
   *  Access, …) whose only behavior is a bare alert(), or no handler at all. */
  fakeButtonGap: boolean
  /** Real bug (found live): a favorite/like/save toggle on a hardcoded array
   *  — genuine interaction silently lost on reload. */
  hardcodedToggleGap: boolean
  /** Real bug (found live, #1598): a feed/composer (post/broadcast/send) that
   *  appends to a hardcoded array — genuine user-generated content silently
   *  lost on reload, invisible to the blunt file-wide usesDataLayer() check
   *  when the file calls /api/db for something unrelated (e.g. the mandated
   *  visitor beacon) but never for the composer's own feature. */
  unpersistedComposerGap: boolean
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
  const alertInLeadCaptureGap = hasAlertInLeadCaptureGap(code)
  const fakeButtonGap = hasFakeButtonGap(code)
  const hardcodedToggleGap = hasHardcodedToggleGap(code)
  const unpersistedComposerGap = hasUnpersistedComposerGap(code)
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
  if (alertInLeadCaptureGap) {
    reasons.push('Email/waitlist capture handler calls alert() as its success UI — a native alert() freezes the entire page until manually dismissed; use a toast or inline message instead.')
  }
  if (fakeButtonGap) {
    reasons.push('A CTA-shaped button (Sign In, Get Early Access, …) fires only alert() or has no handler at all — wire it to a real action or remove it.')
  }
  if (visitorTrackingGap) {
    reasons.push('Landing/home page never fires the mandated visitor-tracking beacon (POST /api/db/visitors on mount).')
  }
  if (hardcodedToggleGap) {
    reasons.push('A favorite/like/save toggle on a hardcoded list resets on reload — must persist via /api/db.')
  }
  if (unpersistedComposerGap) {
    reasons.push('A feed/composer (post/broadcast/send) appends to a hardcoded array — genuine content is lost on reload, must persist via /api/db.')
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
  return { ok: reasons.length === 0, persistenceGap, aikitGaps, primitiveComplianceGaps, visitorTrackingGap, fakeLeadCaptureGap, alertInLeadCaptureGap, fakeButtonGap, hardcodedToggleGap, unpersistedComposerGap, axLandmarkGap, axManifestGap, axJsonLdGap, axSkipNavGap, axNavLabelGap, axSectionLabelGap, axAgentAttributesGap, axComplexWidgetRoleGap, reasons }
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
      '   Keep the existing success UI (toast/inline message) — NEVER alert(), only the persistence is missing.',
      '',
    )
  }
  if (result.alertInLeadCaptureGap) {
    parts.push(
      '5b) REMOVE alert() FROM THE EMAIL/WAITLIST CAPTURE SUCCESS UI — the handler correctly persists the email',
      '    via /api/db, but also calls alert(...) to notify the visitor. A native alert() blocks the page\'s ENTIRE',
      '    main thread until a human manually dismisses it — a real visitor submitting the form hits what looks',
      '    like a completely frozen, dead page. Replace it with an inline message or toast, e.g.:',
      "    setSubmitted(true) // then render: {submitted && <p>You're on the list!</p>} instead of alert(...)",
      '    Keep the real persistence exactly as-is — only the alert() call must be removed.',
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
  if (result.unpersistedComposerGap) {
    parts.push(
      '6b) PERSIST THE FEED/COMPOSER (post/broadcast/send) — it currently only prepends the new item to a',
      '    hardcoded, in-memory array (useState([{...}])), so every post vanishes the instant the page reloads.',
      '    Load the feed from /api/db on mount, and POST each new item the same way:',
      "    useEffect(() => { fetch('/api/db/<table>').then(r=>r.json()).then(d=>setItems(d.data||seedItems)) }, [])",
      "    const handlePost = async () => { const saved = await fetch('/api/db/<table>', { method: 'POST',",
      "      headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text, postedAt: new Date().toISOString() })",
      '      }).then(r=>r.json()).catch(()=>null); setItems(prev => [saved?.data || saved, ...prev]) }',
      '    Keep the same instant-feeling optimistic UI — only the persistence is missing.',
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
      '    Tag at least HALF of your real buttons/links (rounded down) — you do not need literally every element,',
      '    but a handful tagged out of many is not enough. Prioritize the primary/real actions a user would take.',
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
  if (result.fakeButtonGap) {
    parts.push(
      '15) FIX YOUR FAKE/DEAD BUTTONS — a CTA-shaped button (Sign In, Get Started, Get Early Access, …) either',
      '    fires only alert(...) or has no onClick/href at all. Every button must do something real:',
      '    - "Sign In" with no real auth flow in this app: REMOVE the button rather than fake it.',
      '    - A CTA that should submit data: wire it to the same /api/db proxy the rest of the app uses.',
      '    - A CTA that should link somewhere real (e.g. scroll to the real waitlist form, navigate to a real',
      '      section): give it a real onClick or href, not a placeholder.',
      '    Never leave a button that looks clickable but does nothing when a real visitor clicks it.',
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
    alertInLeadCaptureGap: false,
    fakeButtonGap: false,
    hardcodedToggleGap: false,
    unpersistedComposerGap: false,
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
