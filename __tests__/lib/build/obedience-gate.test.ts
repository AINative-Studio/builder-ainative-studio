import { describe, it, expect } from 'vitest'
import {
  usesDataLayer,
  hasPersistenceGap,
  findAikitGaps,
  findPrimitiveComplianceGaps,
  hasVisitorTrackingGap,
  hasFakeLeadCaptureGap,
  hasAlertInLeadCaptureGap,
  hasFakeButtonGap,
  hasHardcodedToggleGap,
  hasUnpersistedComposerGap,
  hasAxLandmarkGap,
  hasAxManifestGap,
  hasAxJsonLdGap,
  hasAxSkipNavGap,
  hasAxNavLabelGap,
  hasAxSectionLabelGap,
  hasAxAgentAttributesGap,
  hasAxComplexWidgetRoleGap,
  checkObedience,
  buildObediencePrompt,
  narrowToPrimitiveComplianceOnly,
  evaluatePrimitiveComplianceRetry,
} from '@/lib/build/obedience-gate'

const dataManagingApp = (dbBacked: boolean) => `
function App(){
  const [items, setItems] = useState([${dbBacked ? '' : "{id:1,text:'x'}"}])
  ${dbBacked ? "useEffect(()=>{ fetch('/api/db/todos').then(r=>r.json()).then(d=>setItems(d.data||[])) },[])" : ''}
  return (<div>
    <button onClick={()=>setItems([...items,{}])}>Add</button>
    {items.map(i => <div key={i.id}>{i.text}</div>)}
  </div>)
}`

describe('obedience-gate: persistence (#297)', () => {
  it('usesDataLayer detects /api/db calls', () => {
    expect(usesDataLayer("fetch('/api/db/todos')")).toBe(true)
    expect(usesDataLayer('const x = 1')).toBe(false)
  })

  it('flags a record-managing app that hardcodes data (todo, no /api/db)', () => {
    expect(hasPersistenceGap(dataManagingApp(false), 'a todo list to add and remove tasks')).toBe(true)
  })

  it('does NOT flag when the app already uses /api/db', () => {
    expect(hasPersistenceGap(dataManagingApp(true), 'a todo list')).toBe(false)
  })

  it('does NOT flag a non-record idea (a counter)', () => {
    const counter = "function App(){const[n,setN]=useState(0);return <button onClick={()=>setN(n+1)}>{n}</button>}"
    expect(hasPersistenceGap(counter, 'a simple counter app')).toBe(false)
  })

  it('does NOT flag a record idea with no add/list surface (static landing)', () => {
    const landing = "function App(){return <div><h1>Welcome</h1></div>}"
    expect(hasPersistenceGap(landing, 'a contact directory')).toBe(false)
  })
})

describe('obedience-gate: AIKit (#297)', () => {
  it('flags a hand-rolled data table', () => {
    const code = 'function App(){return <table><tr><td>x</td></tr></table>}'
    const gaps = findAikitGaps(code)
    expect(gaps.some(g => g.includes('AIKitTable'))).toBe(true)
  })

  it('does NOT flag when AIKitTable is already used', () => {
    const code = 'function App(){return <AIKitTable columns={[]} rows={[]} />}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitTable'))).toBe(false)
  })

  it('flags hand-rolled pricing cards', () => {
    const code = 'function App(){return <div>Pro $49/mo <button>Choose</button></div>}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitPriceCard'))).toBe(true)
  })

  it('no AIKit gaps for a plain app', () => {
    expect(findAikitGaps('function App(){return <div>hi</div>}')).toEqual([])
  })

  // #78 (Phase 4): broadened detectors — the gate now catches more hand-rolled
  // patterns so it re-prompts the model to use AIKit (baseline aikit=0%).
  it('flags a hand-rolled <aside> sidebar', () => {
    const code = 'function App(){return <aside className="flex"><nav><a href="#" onClick={()=>{}}>Home</a></nav></aside>}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitSidebar'))).toBe(true)
  })

  it('flags a hand-rolled app header/nav bar', () => {
    const code = 'function App(){return <header className="flex"><span>Brand</span><a href="/x">Link</a></header>}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitHeader'))).toBe(true)
  })

  it('flags hand-rolled product cards', () => {
    const code = 'function App(){return <div><img src="p.jpg"/><span>$29</span><button>Add to cart</button></div>}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitProductCard'))).toBe(true)
  })

  it('flags a hand-rolled star rating', () => {
    const code = 'function App(){return <div>{[1,2,3].map(i=><span key={i}>★</span>)} rating</div>}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitRating'))).toBe(true)
  })

  // #1668-class bug: a stray `>` inside an unrelated JSX expression attribute
  // (a numeric/boolean comparison) used to give these three className-based
  // patterns a premature tag close to stop at, so the content check ran
  // against the expression's own text instead of the element's real
  // children — e.g. the `0` in `{count > 0}` satisfied the metric card's
  // own `\d` check even though the element's real content was plain text.
  it('does NOT flag MetricCard when a later attribute embeds a > comparison and the real content is not a metric', () => {
    const code = 'function App(){const count=5;return <div className="text-3xl font-bold" data-flag={count > 0}>Loading</div>}'
    expect(findAikitGaps(code).some(g => g.includes('MetricCard'))).toBe(false)
  })

  it('still flags a genuine MetricCard even when a later attribute embeds a > comparison', () => {
    const code = 'function App(){const count=5;return <div className="text-3xl font-bold" data-flag={count > 0}>$42</div>}'
    expect(findAikitGaps(code).some(g => g.includes('MetricCard'))).toBe(true)
  })

  it('does NOT flag AIKitSidebar when a later attribute embeds a > comparison and there is no real nav/aside/sidebar content', () => {
    const code = 'function App(){const i=2;return <div className="w-64" data-flag={i > 0}>Just some panel text</div>}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitSidebar'))).toBe(false)
  })

  it('does NOT flag AIKitBanner when a later attribute embeds a > comparison and there is no real alert content', () => {
    const code = 'function App(){const n=2;return <div className="bg-red-50" data-flag={n > 0}>Just some other text here</div>}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitBanner'))).toBe(false)
  })

  it('still flags a genuine AIKitBanner even when a later attribute embeds a > comparison', () => {
    const code = 'function App(){const n=2;return <div className="bg-red-50" data-flag={n > 0}>This is an alert/warning</div>}'
    expect(findAikitGaps(code).some(g => g.includes('AIKitBanner'))).toBe(true)
  })

  it('does NOT flag AIKit components that are already used', () => {
    const code = 'function App(){return <div><AIKitHeader title="x"/><AIKitSidebar items={[]}/></div>}'
    const gaps = findAikitGaps(code)
    expect(gaps.some(g => g.includes('AIKitHeader'))).toBe(false)
    expect(gaps.some(g => g.includes('AIKitSidebar'))).toBe(false)
  })
})

// #483/#563: the Live dashboard's "visitors" hero metric was a permanent,
// hardcoded 0 with nothing behind it, for every generated app, ever — despite
// the dashboard's own copy claiming "Cody grows these nightly." Unlike every
// other gate here, this one is UNCONDITIONAL (no idea-trigger gating): every
// generated app has some kind of landing/home surface.
describe('obedience-gate: visitor tracking (#483/#563)', () => {
  it('flags a plain app with no visitor beacon at all', () => {
    expect(hasVisitorTrackingGap('function App(){return <div>hi</div>}')).toBe(true)
  })

  it('does NOT flag an app that fires the real beacon', () => {
    const code = "useEffect(()=>{ fetch('/api/db/visitors', {method:'POST'}) }, [])"
    expect(hasVisitorTrackingGap(code)).toBe(false)
  })

  it('is unconditional — flags even a plain counter with no data-management idea at all', () => {
    expect(hasVisitorTrackingGap('function App(){ return <button>+1</button> }')).toBe(true)
  })

  it('checkObedience surfaces visitorTrackingGap and a reason string', () => {
    const r = checkObedience('function App(){return <div/>}', 'a counter')
    expect(r.visitorTrackingGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('visitor-tracking beacon'))).toBe(true)
  })

  it('buildObediencePrompt includes the real beacon call shape when this gap fires', () => {
    const r = checkObedience('function App(){return <div/>}', 'a counter')
    const prompt = buildObediencePrompt('a counter', r)
    expect(prompt).toMatch(/FIRE THE MANDATED VISITOR-TRACKING BEACON/)
    expect(prompt).toMatch(/\/api\/db\/visitors/)
  })

  it('buildObediencePrompt omits the visitor-tracking section when the beacon is already present', () => {
    const code = "function App(){ useEffect(()=>{fetch('/api/db/visitors',{method:'POST'})},[]); return <div/>}"
    const r = checkObedience(code, 'a counter')
    expect(r.visitorTrackingGap).toBe(false)
    const prompt = buildObediencePrompt('a counter', r)
    expect(prompt).not.toMatch(/FIRE THE MANDATED VISITOR-TRACKING BEACON/)
  })
})

// #563 follow-up — found live via direct inspection of the 4 most recent real
// admin-owned generated companies (2026-09-06): EVERY ONE had an email/
// waitlist capture form that fires alert() or flips a local "submitted" flag
// and discards the email — nothing ever persisted it. hasPersistenceGap can't
// catch this: it's scoped to an add-button + list UI shape, while a landing
// page's lead-capture form is a single form + submit, a completely different
// shape.
describe('obedience-gate: fake lead capture (real bug, found live)', () => {
  const FAKE_ALERT = `
function App(){
  const [email, setEmail] = useState('')
  const handleEarlyAccess = (e) => {
    e.preventDefault()
    if (email.trim()) { alert(\`Thanks! We'll contact you at \${email}\`); setEmail('') }
  }
  return (<form onSubmit={handleEarlyAccess}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  const FAKE_SUBMITTED_FLAG = `
function App(){
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const handleSubmit = (e) => {
    e.preventDefault()
    if (email.trim()) { setSubmitted(true); setTimeout(()=>setSubmitted(false), 3000); setEmail('') }
  }
  return (<form onSubmit={handleSubmit}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  const REAL_PERSISTED = `
function App(){
  const [email, setEmail] = useState('')
  const handleSubmit = async (e) => {
    e.preventDefault()
    await fetch('/api/db/waitlist', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email }) }).catch(()=>{})
    setEmail('')
  }
  return (<form onSubmit={handleSubmit}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  it('THE BUG: flags an alert()-only "Get Early Access" form (the real beacon repro)', () => {
    expect(hasFakeLeadCaptureGap(FAKE_ALERT)).toBe(true)
  })

  it('THE BUG: flags a fake "submitted" flag that never persists (the real triage/siliport/shortlist repro)', () => {
    expect(hasFakeLeadCaptureGap(FAKE_SUBMITTED_FLAG)).toBe(true)
  })

  it('does NOT flag a form that actually persists via /api/db', () => {
    expect(hasFakeLeadCaptureGap(REAL_PERSISTED)).toBe(false)
  })

  it('does NOT flag an app with no email capture form at all', () => {
    expect(hasFakeLeadCaptureGap('function App(){return <div>hi</div>}')).toBe(false)
  })

  it('checkObedience surfaces fakeLeadCaptureGap and a reason string', () => {
    const r = checkObedience(FAKE_ALERT, 'a B2B SaaS landing page')
    expect(r.fakeLeadCaptureGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('waitlist capture form'))).toBe(true)
  })

  it('buildObediencePrompt includes the real /api/db/waitlist call shape when this gap fires', () => {
    const r = checkObedience(FAKE_ALERT, 'a landing page')
    const prompt = buildObediencePrompt('a landing page', r)
    expect(prompt).toMatch(/PERSIST THE EMAIL\/WAITLIST CAPTURE FORM/)
    expect(prompt).toMatch(/\/api\/db\/waitlist/)
  })

  it('buildObediencePrompt omits the lead-capture section when the form already persists', () => {
    const r = checkObedience(REAL_PERSISTED, 'a landing page')
    expect(r.fakeLeadCaptureGap).toBe(false)
    const prompt = buildObediencePrompt('a landing page', r)
    expect(prompt).not.toMatch(/PERSIST THE EMAIL\/WAITLIST CAPTURE FORM/)
  })
})

describe('obedience-gate: hasAlertInLeadCaptureGap (#1581, flipsight)', () => {
  // Real shape found live on flipsight's deployed handleEarlyAccess: persists
  // the email via /api/db (correctly — NOT a fakeLeadCaptureGap) but ALSO
  // calls alert() as the success notification. A native alert() blocks the
  // page's entire main thread until a human manually dismisses it; a real
  // visitor submitting this form hit what looked like a completely frozen,
  // dead page.
  const PERSISTS_BUT_ALERTS = `
function App(){
  const [email, setEmail] = useState('')
  const handleEarlyAccess = async (e) => {
    e.preventDefault()
    await fetch('/api/db/waitlist', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email, joinedAt: new Date().toISOString() }) }).catch(()=>{})
    alert("You're on the list!")
    setEmail('')
  }
  return (<form onSubmit={handleEarlyAccess}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  // Same real shape, but the alert() lives OUTSIDE any lead-capture handler
  // (e.g. a delete-confirm dialog elsewhere in the app) — must not false-positive.
  const PERSISTS_NO_ALERT_PLUS_UNRELATED_ALERT = `
function App(){
  const [email, setEmail] = useState('')
  const handleEarlyAccess = async (e) => {
    e.preventDefault()
    await fetch('/api/db/waitlist', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email }) }).catch(()=>{})
    setEmail('')
  }
  const handleDelete = (id) => { if (confirm('Delete this item?')) { alert('Deleted'); } }
  return (<form onSubmit={handleEarlyAccess}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  // Local copies (the originals above are scoped to the earlier describe block).
  const REAL_PERSISTED = `
function App(){
  const [email, setEmail] = useState('')
  const handleSubmit = async (e) => {
    e.preventDefault()
    await fetch('/api/db/waitlist', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email }) }).catch(()=>{})
    setEmail('')
  }
  return (<form onSubmit={handleSubmit}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  const FAKE_ALERT = `
function App(){
  const [email, setEmail] = useState('')
  const handleEarlyAccess = (e) => {
    e.preventDefault()
    if (email.trim()) { alert(\`Thanks! We'll contact you at \${email}\`); setEmail('') }
  }
  return (<form onSubmit={handleEarlyAccess}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  it('THE BUG: flags a lead-capture handler that persists AND alerts (the real flipsight repro)', () => {
    expect(hasAlertInLeadCaptureGap(PERSISTS_BUT_ALERTS)).toBe(true)
  })

  it('does NOT flag a lead-capture handler that persists without alert()', () => {
    expect(hasAlertInLeadCaptureGap(REAL_PERSISTED)).toBe(false)
  })

  it('does NOT flag an alert()-only fake handler (that is hasFakeLeadCaptureGap/hasFakeButtonGap\'s job, not this gap\'s)', () => {
    expect(hasAlertInLeadCaptureGap(FAKE_ALERT)).toBe(false)
  })

  it('does NOT flag an unrelated alert() outside the lead-capture handler (e.g. a delete confirm)', () => {
    expect(hasAlertInLeadCaptureGap(PERSISTS_NO_ALERT_PLUS_UNRELATED_ALERT)).toBe(false)
  })

  it('does NOT flag an app with no email capture form at all', () => {
    expect(hasAlertInLeadCaptureGap('function App(){return <div>hi</div>}')).toBe(false)
  })

  // Same nested-paren regex-anti-pattern bug class as #1619/#1621
  // (component-detector.ts / dedupe-provided-components.ts): a flat
  // `\([^)]*\)` param-list match can't cross a `)` INSIDE the param list.
  const PERSISTS_AND_ALERTS_NESTED_PAREN_DEFAULT = `
function App(){
  const [email, setEmail] = useState('')
  const handleEarlyAccess = async (e = getDefaultEvent()) => {
    e.preventDefault()
    await fetch('/api/db/waitlist', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email }) }).catch(()=>{})
    alert("You're on the list!")
    setEmail('')
  }
  return (<form onSubmit={handleEarlyAccess}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  it('THE BUG (nested-paren default param): still flags a lead-capture handler whose param list has a call-expression default', () => {
    expect(hasAlertInLeadCaptureGap(PERSISTS_AND_ALERTS_NESTED_PAREN_DEFAULT)).toBe(true)
  })

  it('does NOT flag a persisted-without-alert handler with a nested-paren default param (no regression)', () => {
    const code = `
function App(){
  const handleSubmit = async (e = getDefaultEvent()) => {
    e.preventDefault()
    await fetch('/api/db/waitlist', { method: 'POST' }).catch(()=>{})
  }
  return (<form onSubmit={handleSubmit}><input type="email" /></form>)
}`
    expect(hasAlertInLeadCaptureGap(code)).toBe(false)
  })

  // Same findMatchingBracket fix as hasFakeButtonGap's smiley tests above: a
  // string-literal default param value containing an unmatched ")" (a
  // smiley) used to throw off the depth-aware param-list scan here too,
  // making the whole handler — and therefore its real alert()-after-persist
  // bug — invisible to this gap.
  const PERSISTS_AND_ALERTS_SMILEY_DEFAULT_PARAM = `
function App(){
  const [email, setEmail] = useState('')
  const handleEarlyAccess = async (e = ':)') => {
    e.preventDefault && e.preventDefault()
    await fetch('/api/db/waitlist', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email }) }).catch(()=>{})
    alert("You're on the list!")
    setEmail('')
  }
  return (<form onSubmit={handleEarlyAccess}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)
}`

  it('THE BUG (stray paren inside a param default string): still flags a lead-capture handler whose param list has a string default containing an unmatched ")"', () => {
    expect(hasAlertInLeadCaptureGap(PERSISTS_AND_ALERTS_SMILEY_DEFAULT_PARAM)).toBe(true)
  })

  it('checkObedience surfaces alertInLeadCaptureGap and a reason string', () => {
    const r = checkObedience(PERSISTS_BUT_ALERTS, 'a landing page')
    expect(r.alertInLeadCaptureGap).toBe(true)
    expect(r.fakeLeadCaptureGap).toBe(false)
    expect(r.reasons.some((x) => x.includes('alert()') && x.includes('freezes'))).toBe(true)
  })

  it('buildObediencePrompt includes the alert()-removal instruction when this gap fires', () => {
    const r = checkObedience(PERSISTS_BUT_ALERTS, 'a landing page')
    const prompt = buildObediencePrompt('a landing page', r)
    expect(prompt).toMatch(/REMOVE alert\(\) FROM THE EMAIL\/WAITLIST CAPTURE SUCCESS UI/)
  })

  it('buildObediencePrompt omits the alert-removal section when the form already avoids alert()', () => {
    const r = checkObedience(REAL_PERSISTED, 'a landing page')
    expect(r.alertInLeadCaptureGap).toBe(false)
    const prompt = buildObediencePrompt('a landing page', r)
    expect(prompt).not.toMatch(/REMOVE alert\(\) FROM THE EMAIL\/WAITLIST CAPTURE SUCCESS UI/)
  })
})

describe('obedience-gate: hasFakeButtonGap (#844)', () => {
  const FAKE_SIGN_IN_ALERT = `
function App(){
  return (<nav><button onClick={() => alert('Sign In')}>Sign In</button></nav>)
}`

  const NO_OP_NAV_CTA = `
function App(){
  return (<nav><button className="btn">Get Early Access</button></nav>)
}`

  const REAL_AUTH_LINK = `
function App(){
  return (<nav><a href="/login">Sign In</a></nav>)
}`

  const REAL_CTA_HANDLER = `
function App(){
  const scrollToWaitlist = () => document.getElementById('waitlist')?.scrollIntoView()
  return (<nav><button onClick={scrollToWaitlist}>Get Early Access</button></nav>)
}`

  const ALERT_INSIDE_REAL_FLOW = `
function App(){
  const handleSubmit = async () => {
    const res = await fetch('/api/db/waitlist', { method: 'POST' })
    if (!res.ok) alert('Something went wrong')
  }
  return (<button onClick={handleSubmit}>Sign Up</button>)
}`

  // #1641: a `>` comparison inside an earlier attribute's expression
  // container (not the handler itself) used to truncate the attrs scan
  // before it ever reached the real onClick.
  const REAL_CTA_HANDLER_WITH_COMPARISON_ATTR = `
function App(){
  const items = []
  return (<nav><button className={items.length > 5 ? 'a' : 'b'} onClick={() => items.push(1)}>Sign In</button></nav>)
}`

  it('THE BUG: flags a "Sign In" button whose only handler is alert() (the real agentive repro)', () => {
    expect(hasFakeButtonGap(FAKE_SIGN_IN_ALERT)).toBe(true)
  })

  it('THE BUG: flags a "Get Early Access" nav button with no handler at all (the real agentive repro)', () => {
    expect(hasFakeButtonGap(NO_OP_NAV_CTA)).toBe(true)
  })

  it('does NOT flag a real auth link (href to a real route)', () => {
    expect(hasFakeButtonGap(REAL_AUTH_LINK)).toBe(false)
  })

  it('does NOT flag a CTA wired to a real handler', () => {
    expect(hasFakeButtonGap(REAL_CTA_HANDLER)).toBe(false)
  })

  it('does NOT flag alert() used as error handling inside a real async flow', () => {
    expect(hasFakeButtonGap(ALERT_INSIDE_REAL_FLOW)).toBe(false)
  })

  it('does NOT flag a CTA with a real onClick when an earlier attribute has a `>` comparison (#1641)', () => {
    expect(hasFakeButtonGap(REAL_CTA_HANDLER_WITH_COMPARISON_ATTR)).toBe(false)
  })

  it('does NOT flag an app with no CTA-shaped buttons at all', () => {
    expect(hasFakeButtonGap('function App(){return <div>hi</div>}')).toBe(false)
  })

  // Same nested-paren regex-anti-pattern bug class as #1609/#1611/#1615/
  // #1617/#1619/#1621/#1623: a flat `\([^)]*\)` can't cross a `)` INSIDE
  // the span it's matching.
  const FAKE_SIGN_IN_ALERT_NESTED_PAREN_PARAM = `
function App(){
  return (<nav><button onClick={function(e = getDefaultEvent()) { alert('Sign In') }}>Sign In</button></nav>)
}`

  const FAKE_SIGN_IN_ALERT_NESTED_PAREN_ARG = `
function App(){
  return (<nav><button onClick={() => { alert(getMessage()) }}>Sign In</button></nav>)
}`

  it('THE BUG (nested-paren default param): still flags a function-expression alert-only handler whose own param list has a call-expression default', () => {
    expect(hasFakeButtonGap(FAKE_SIGN_IN_ALERT_NESTED_PAREN_PARAM)).toBe(true)
  })

  it('THE BUG (nested-paren alert arg): still flags an alert-only handler whose alert() argument is itself a call expression', () => {
    expect(hasFakeButtonGap(FAKE_SIGN_IN_ALERT_NESTED_PAREN_ARG)).toBe(true)
  })

  it('does NOT flag a real handler (nested-paren param, no regression) that does real work and also alerts', () => {
    const code = `
function App(){
  return (<nav><button onClick={function(e = getDefaultEvent()) { trackClick(); alert('Sign In') }}>Sign In</button></nav>)
}`
    expect(hasFakeButtonGap(code)).toBe(false)
  })

  it('checkObedience surfaces fakeButtonGap and a reason string', () => {
    const r = checkObedience(FAKE_SIGN_IN_ALERT, 'a community platform')
    expect(r.fakeButtonGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('CTA-shaped button'))).toBe(true)
    const prompt = buildObediencePrompt('a community platform', r)
    expect(prompt).toMatch(/FIX YOUR FAKE\/DEAD BUTTONS/)
  })

  it('buildObediencePrompt omits the fake-button section when there is none', () => {
    const r = checkObedience(REAL_CTA_HANDLER, 'a community platform')
    expect(r.fakeButtonGap).toBe(false)
    const prompt = buildObediencePrompt('a community platform', r)
    expect(prompt).not.toMatch(/FIX YOUR FAKE\/DEAD BUTTONS/)
  })

  // Real bug: findMatchingBracket's char-by-char `(`/`)`/`{`/`}` count had no
  // notion of string content, so it miscounted the moment a string literal it
  // scanned THROUGH contained a lone, unmatched instance of the tracked
  // character — an emoticon in placeholder copy is exactly that. `alert('Thanks
  // :)')`'s message contains a bare `)` with no matching `(`; the old counter
  // hit it and returned the smiley's paren as if it closed the alert() call,
  // truncating the rest of the handler out of view and making this exact
  // alert()-only fake-CTA shape (#844) silently invisible.
  const FAKE_SIGN_IN_ALERT_SMILEY_ARG = `
function App(){
  return (<nav><button onClick={() => alert('Thanks :)')}>Sign In</button></nav>)
}`

  const FAKE_SIGN_IN_ALERT_SMILEY_PARAM_DEFAULT = `
function App(){
  return (<nav><button onClick={function(label = ':)') { alert('Sign In') }}>Sign In</button></nav>)
}`

  const FAKE_SIGN_IN_ALERT_BACKTICK_SMILEY_ARG = `
function App(){
  return (<nav><button onClick={() => alert(\`Thanks :)\`)}>Sign In</button></nav>)
}`

  it('THE BUG (stray paren inside a string): still flags an alert-only handler whose message contains an unmatched ")" (a smiley)', () => {
    expect(hasFakeButtonGap(FAKE_SIGN_IN_ALERT_SMILEY_ARG)).toBe(true)
  })

  it('THE BUG (stray paren inside a template-literal string): still flags an alert-only handler whose backtick message contains an unmatched ")"', () => {
    expect(hasFakeButtonGap(FAKE_SIGN_IN_ALERT_BACKTICK_SMILEY_ARG)).toBe(true)
  })

  it('THE BUG (stray paren inside a param default string): still flags an alert-only handler whose own param list has a string default containing an unmatched ")"', () => {
    expect(hasFakeButtonGap(FAKE_SIGN_IN_ALERT_SMILEY_PARAM_DEFAULT)).toBe(true)
  })

  it('does NOT flag a real handler whose message contains a smiley but that also does real work', () => {
    const code = `
function App(){
  return (<nav><button onClick={() => { trackClick(); alert('Thanks :)') }}>Sign In</button></nav>)
}`
    expect(hasFakeButtonGap(code)).toBe(false)
  })
})

describe('obedience-gate: checkObedience + prompt', () => {
  it('ok:true when no gaps (including the mandated visitor beacon + AX landmark/manifest/JSON-LD/skip-nav)', () => {
    const r = checkObedience(
      "function App(){ useEffect(()=>{fetch('/api/db/visitors',{method:'POST'})},[]); return <><a href=\"#main-content\" data-agent-action=\"skip-nav\">Skip to main content</a><main id=\"main-content\" aria-label=\"Counter app\">" +
      "<div hidden data-agent-manifest=\"true\"></div><script type=\"application/ld+json\"></script><div>hi</div></main></>}",
      'a counter',
    )
    expect(r.ok).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('reports both gaps and builds a targeted prompt', () => {
    const code = dataManagingApp(false) + '<table><tr><td>x</td></tr></table>'
    const r = checkObedience(code, 'a CRM with a contacts table')
    expect(r.ok).toBe(false)
    expect(r.persistenceGap).toBe(true)
    expect(r.aikitGaps.length).toBeGreaterThan(0)
    const prompt = buildObediencePrompt('a CRM', r)
    expect(prompt).toMatch(/\/api\/db/)
    expect(prompt).toMatch(/AIKIT/i)
    expect(prompt).toMatch(/Return the corrected full app/)
  })

  it('persistence-only gap → prompt mentions /api/db but not AIKit section', () => {
    const r = checkObedience(dataManagingApp(false), 'a notes app')
    const prompt = buildObediencePrompt('notes', r)
    expect(prompt).toMatch(/PERSIST REAL DATA/)
    expect(prompt).not.toMatch(/USE AIKIT COMPONENTS/)
  })

  it('never throws on empty/garbage input (still flags the unconditional visitor-tracking gap)', () => {
    expect(() => checkObedience('', '')).not.toThrow()
    const r = checkObedience('', '')
    expect(r.visitorTrackingGap).toBe(true)
    expect(r.reasons).toContain('Landing/home page never fires the mandated visitor-tracking beacon (POST /api/db/visitors on mount).')
  })
})

// #518: codegenCompositionBlock correctly instructs the model to call a
// RUNTIME_PROXIED_PRIMITIVES primitive's real proxy, but a live production test
// showed the model doesn't reliably follow that instruction — a journaling app's
// "related memories" feature was pure client-side keyword matching over rows
// already loaded from /api/db, never calling /api/memory/remember or
// /api/memory/recall despite ZeroMemory being selected and instructed. This gate
// detects that specific compliance gap (idea asked for the capability, code never
// called the real endpoint) so the existing obedience retry loop can repair it.
describe('obedience-gate: primitive proxy compliance (#518)', () => {
  const keywordMatchingMemoryApp = `
function App(){
  const [entries, setEntries] = useState([])
  useEffect(()=>{ fetch('/api/db/journal_entries').then(r=>r.json()).then(d=>setEntries(d.data||[])) },[])
  function findRelatedMemories(text){
    const words = text.toLowerCase().split(/\\s+/)
    return entries.filter(e => words.some(w => e.text.toLowerCase().includes(w)))
  }
  return (<div>{entries.map(e => <div key={e.id}>{e.text}</div>)}</div>)
}`

  const realMemoryApp = `
function App(){
  const [entries, setEntries] = useState([])
  useEffect(()=>{ fetch('/api/db/journal_entries').then(r=>r.json()).then(d=>setEntries(d.data||[])) },[])
  async function findRelatedMemories(text){
    const res = await fetch('/api/memory/recall', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: text }),
    })
    return (await res.json()).results
  }
  return (<div>{entries.map(e => <div key={e.id}>{e.text}</div>)}</div>)
}`

  // Note: deliberately avoids substrings like "remembers" (contains "members",
  // a Community trigger) so this idea only matches ZeroMemory's own triggers —
  // keeps the compliance-gap assertions below scoped to the one primitive under
  // test instead of incidentally tripping an unrelated one via keyword overlap.
  const JOURNAL_IDEA = 'a personal journaling app with memory of past entries that recalls relevant history when I write something new'

  it('reproduces the real #518 failure: journaling idea + client-side keyword matching flags ZeroMemory', () => {
    const gaps = findPrimitiveComplianceGaps(keywordMatchingMemoryApp, JOURNAL_IDEA)
    expect(gaps).toContain('ZeroMemory')
  })

  it('does NOT flag when the app actually calls the real ZeroMemory proxy', () => {
    const gaps = findPrimitiveComplianceGaps(realMemoryApp, JOURNAL_IDEA)
    expect(gaps).not.toContain('ZeroMemory')
  })

  it('does NOT flag ZeroMemory for an idea that never asked for memory/recall (avoids false positives on foundational primitives)', () => {
    // ZeroMemory is `foundational: true` — always selected/wired regardless of
    // idea — so this must be gated on idea-trigger overlap, not raw selection,
    // or a plain counter app would falsely fail this check forever.
    const counter = "function App(){const[n,setN]=useState(0);return <button onClick={()=>setN(n+1)}>{n}</button>}"
    expect(findPrimitiveComplianceGaps(counter, 'a simple counter app')).toEqual([])
  })

  it('never throws and returns no gaps on empty/garbage input', () => {
    expect(() => findPrimitiveComplianceGaps('', '')).not.toThrow()
    expect(findPrimitiveComplianceGaps('', '')).toEqual([])
  })

  it('flags Browser Agent when a scraping idea never calls its real extract/act proxy', () => {
    const fakeScraper = "function App(){ const prices = [{name:'Competitor A', price: 9.99}]; return <div/> }"
    const gaps = findPrimitiveComplianceGaps(fakeScraper, 'a tool that scrapes competitor pricing from their websites')
    expect(gaps).toContain('Browser Agent')
  })

  it('does not flag Browser Agent when the real extract proxy is called', () => {
    const realScraper = "function App(){ fetch('/api/browser-agent/extract', {method:'POST'}); return <div/> }"
    const gaps = findPrimitiveComplianceGaps(realScraper, 'a tool that scrapes competitor pricing from their websites')
    expect(gaps).not.toContain('Browser Agent')
  })

  it('checkObedience surfaces primitiveComplianceGaps and a reason string', () => {
    const r = checkObedience(keywordMatchingMemoryApp, JOURNAL_IDEA)
    expect(r.ok).toBe(false)
    expect(r.primitiveComplianceGaps).toContain('ZeroMemory')
    expect(r.reasons.join(' ')).toMatch(/ZeroMemory/)
  })

  it('buildObediencePrompt includes the real call shape + anti-pattern warning for the flagged primitive', () => {
    const r = checkObedience(keywordMatchingMemoryApp, JOURNAL_IDEA)
    const prompt = buildObediencePrompt(JOURNAL_IDEA, r)
    expect(prompt).toMatch(/YOU WERE TOLD TO CALL THESE REAL PRIMITIVES AND DID NOT/)
    expect(prompt).toContain('ZeroMemory')
    expect(prompt).toMatch(/POST \/api\/memory\/recall/)
    expect(prompt).toMatch(/client-side keyword\/text/i)
    expect(prompt).toMatch(/Return the corrected full app/)
  })

  it('buildObediencePrompt omits the primitive-compliance section when there is no such gap', () => {
    const r = checkObedience(realMemoryApp, JOURNAL_IDEA)
    const prompt = buildObediencePrompt(JOURNAL_IDEA, r)
    expect(prompt).not.toMatch(/YOU WERE TOLD TO CALL THESE REAL PRIMITIVES AND DID NOT/)
  })

  it('a role can surface a role-emphasized primitive gap even without idea-text overlap', () => {
    // Sales role boosts ZeroPipeline/ZeroInvoice/ZeroCommerce regardless of idea
    // text — but ZeroPipeline/etc. aren't in RUNTIME_PROXY_PATH_SUBSTRINGS, so this
    // just guards that passing a role doesn't throw and still returns a real array.
    expect(() => findPrimitiveComplianceGaps('function App(){}', 'a small business', 'sales')).not.toThrow()
    expect(Array.isArray(findPrimitiveComplianceGaps('function App(){}', 'a small business', 'sales'))).toBe(true)
  })
})

// Real bug found live (same investigation as #566): a "favorite this gallery
// item" toggle on a HARDCODED array is genuine user interaction that resets on
// every reload — silently lost. hasPersistenceGap can't catch this: it
// requires idea-hint overlap AND explicit Add/New/Create/Save BUTTON TEXT — a
// favorite toggle is usually an icon button with no such text, and "favorite"
// was never in the idea-hint list at all (confirmed live: a real "street art
// gallery... favorite toggle" idea matched zero hints).
describe('obedience-gate: hardcoded toggle (real bug, found live)', () => {
  const GALLERY_APP = `
function App(){
  const [artPieces, setArtPieces] = useState([
    { id: 1, title: 'Ocean Waves', artist: 'Marina Santos', favorited: false },
    { id: 2, title: 'Boardwalk Dreams', artist: 'Jake Morrison', favorited: true },
  ])
  const toggleFavorite = (id) => {
    setArtPieces(prev => prev.map(piece =>
      piece.id === id ? { ...piece, favorited: !piece.favorited } : piece
    ))
  }
  return (<div>{artPieces.map(p => <button key={p.id} onClick={()=>toggleFavorite(p.id)}>{p.favorited ? '♥' : '♡'}</button>)}</div>)
}`

  const PERSISTED_GALLERY_APP = `
function App(){
  const [artPieces, setArtPieces] = useState([])
  useEffect(() => { fetch('/api/db/art').then(r=>r.json()).then(d=>setArtPieces(d.data||[])) }, [])
  const toggleFavorite = (id, current) => {
    fetch(\`/api/db/art?id=\${id}\`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ favorited: !current }) }).catch(()=>{})
    setArtPieces(prev => prev.map(piece => piece.id === id ? { ...piece, favorited: !piece.favorited } : piece))
  }
  return (<div>{artPieces.map(p => <button key={p.id} onClick={()=>toggleFavorite(p.id, p.favorited)}>{p.favorited ? '♥' : '♡'}</button>)}</div>)
}`

  it('THE BUG: flags a favorite toggle on a hardcoded array (the real aerosol repro)', () => {
    expect(hasHardcodedToggleGap(GALLERY_APP)).toBe(true)
  })

  it('does NOT flag when the list is loaded from and toggled through /api/db', () => {
    expect(hasHardcodedToggleGap(PERSISTED_GALLERY_APP)).toBe(false)
  })

  it('does NOT flag an app with no toggle-on-array pattern at all', () => {
    expect(hasHardcodedToggleGap('function App(){return <div>hi</div>}')).toBe(false)
  })

  it('checkObedience surfaces hardcodedToggleGap and a reason string', () => {
    const r = checkObedience(GALLERY_APP, 'a street art gallery with a favorite toggle')
    expect(r.hardcodedToggleGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('toggle on a hardcoded list'))).toBe(true)
  })

  it('buildObediencePrompt includes the real PUT call shape when this gap fires', () => {
    const r = checkObedience(GALLERY_APP, 'a gallery app')
    const prompt = buildObediencePrompt('a gallery app', r)
    expect(prompt).toMatch(/PERSIST THE FAVORITE\/LIKE\/SAVE TOGGLE/)
    expect(prompt).toMatch(/method: 'PUT'/)
  })

  it('buildObediencePrompt omits the toggle section when the list already persists', () => {
    const r = checkObedience(PERSISTED_GALLERY_APP, 'a gallery app')
    expect(r.hardcodedToggleGap).toBe(false)
    const prompt = buildObediencePrompt('a gallery app', r)
    expect(prompt).not.toMatch(/PERSIST THE FAVORITE\/LIKE\/SAVE TOGGLE/)
  })
})

describe('obedience-gate: unpersisted feed composer (#1598, agentis — real bug, found live)', () => {
  // The real repro shape: a feed with hardcoded seed posts, a broadcast
  // composer that prepends to the array (instant optimistic UI), AND the
  // mandated visitor-tracking beacon ALSO present — the exact condition that
  // made the old blunt usesDataLayer(code) short-circuit miss this entirely
  // (the file DOES call /api/db, just for something unrelated to the feed).
  const AGENTIS_APP = `
function App(){
  const [posts, setPosts] = useState([
    { id: 1, author: 'GPT-Analyst', text: 'Markets looking bullish today' },
    { id: 2, author: 'CreativeForge', text: 'New art drop incoming' },
  ])
  const [draft, setDraft] = useState('')
  useEffect(() => { fetch('/api/db/visitors', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path: '/' }) }).catch(() => {}) }, [])
  const handleBroadcast = () => {
    const newPost = { id: Date.now(), author: 'You', text: draft }
    setPosts(prev => [newPost, ...prev])
    setDraft('')
  }
  return (<div>
    <input value={draft} onChange={e=>setDraft(e.target.value)} />
    <button onClick={handleBroadcast}>Broadcast</button>
    {posts.map(p => <div key={p.id}>{p.author}: {p.text}</div>)}
  </div>)
}`

  const PERSISTED_AGENTIS_APP = `
function App(){
  const [posts, setPosts] = useState([])
  const [draft, setDraft] = useState('')
  useEffect(() => { fetch('/api/db/posts').then(r=>r.json()).then(d=>setPosts(d.data||[])) }, [])
  const handleBroadcast = async () => {
    const saved = await fetch('/api/db/posts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ author: 'You', text: draft }) }).then(r=>r.json()).catch(()=>null)
    setPosts(prev => [saved?.data || saved, ...prev])
    setDraft('')
  }
  return (<div><input value={draft} onChange={e=>setDraft(e.target.value)} /><button onClick={handleBroadcast}>Broadcast</button>{posts.map(p => <div key={p.id}>{p.author}: {p.text}</div>)}</div>)
}`

  it('THE BUG: flags a broadcast/post composer that appends to a hardcoded array (the real agentis repro)', () => {
    expect(hasUnpersistedComposerGap(AGENTIS_APP)).toBe(true)
  })

  it('CRITICAL: still flags it even though the file DOES call /api/db for something unrelated (the mandated visitor beacon) — this is exactly the bug hasPersistenceGap could not catch', () => {
    expect(usesDataLayer(AGENTIS_APP)).toBe(true) // confirms the file-wide check alone would wrongly call this "fine"
    expect(hasPersistenceGap(AGENTIS_APP, 'Where AI agents meet, trade, and thrive')).toBe(false) // the OLD gap really does miss it
    expect(hasUnpersistedComposerGap(AGENTIS_APP)).toBe(true) // the NEW gap catches it anyway
  })

  it('does NOT flag when the feed is actually loaded from and posted through /api/db', () => {
    expect(hasUnpersistedComposerGap(PERSISTED_AGENTIS_APP)).toBe(false)
  })

  it('does NOT flag an app with no composer-on-hardcoded-array pattern at all', () => {
    expect(hasUnpersistedComposerGap('function App(){return <div>hi</div>}')).toBe(false)
  })

  it('does NOT flag a lead-capture form (different shape — single capture + static success, not an append-to-visible-list)', () => {
    const LEAD_CAPTURE_APP = `
function App(){
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const handleSubmit = (e) => { e.preventDefault(); setSubmitted(true) }
  return (<form onSubmit={handleSubmit}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /><button>Join</button></form>)
}`
    expect(hasUnpersistedComposerGap(LEAD_CAPTURE_APP)).toBe(false)
  })

  it('does NOT flag a favorite toggle (the sibling hardcodedToggleGap\'s own territory, not this one)', () => {
    const TOGGLE_APP = `
function App(){
  const [artPieces, setArtPieces] = useState([{ id: 1, favorited: false }])
  const toggleFavorite = (id) => { setArtPieces(prev => prev.map(piece => piece.id === id ? { ...piece, favorited: !piece.favorited } : piece)) }
  return (<div>{artPieces.map(p => <button key={p.id} onClick={()=>toggleFavorite(p.id)}>♡</button>)}</div>)
}`
    expect(hasUnpersistedComposerGap(TOGGLE_APP)).toBe(false)
  })

  it('checkObedience surfaces unpersistedComposerGap and a reason string', () => {
    const r = checkObedience(AGENTIS_APP, 'Where AI agents meet, trade, and thrive')
    expect(r.unpersistedComposerGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('feed/composer') && x.includes('hardcoded array'))).toBe(true)
  })

  it('buildObediencePrompt includes the real POST call shape when this gap fires', () => {
    const r = checkObedience(AGENTIS_APP, 'a social feed for AI agents')
    const prompt = buildObediencePrompt('a social feed for AI agents', r)
    expect(prompt).toMatch(/PERSIST THE FEED\/COMPOSER/)
    expect(prompt).toMatch(/method: 'POST'/)
  })

  it('buildObediencePrompt omits the composer section when the feed already persists', () => {
    const r = checkObedience(PERSISTED_AGENTIS_APP, 'a social feed for AI agents')
    expect(r.unpersistedComposerGap).toBe(false)
    const prompt = buildObediencePrompt('a social feed for AI agents', r)
    expect(prompt).not.toMatch(/PERSIST THE FEED\/COMPOSER/)
  })
})

// AX compliance (agent-accessibility, builder AX audit): lib/professional-prompt.ts's
// 10-item checklist was prompt-only with zero code-level enforcement — real
// generations scored ~1/10 against it. This is the first item made unconditional
// and code-enforced, matching hasVisitorTrackingGap's precedent: every generated
// app has exactly one top-level render, so the root <main aria-label> landmark is
// unconditional, not idea-gated.
describe('obedience-gate: AX root landmark (agent-accessibility)', () => {
  it('flags an app with no <main> element at all', () => {
    expect(hasAxLandmarkGap('function App(){ return <div>hi</div> }')).toBe(true)
  })

  it('flags a <main> with no aria-label', () => {
    expect(hasAxLandmarkGap('function App(){ return <main><div>hi</div></main> }')).toBe(true)
  })

  it('does NOT flag a <main> that has an aria-label', () => {
    expect(hasAxLandmarkGap('function App(){ return <main aria-label="Scorch dashboard"><div>hi</div></main> }')).toBe(false)
  })

  it('does NOT flag when aria-label appears with other attributes in any order', () => {
    expect(hasAxLandmarkGap('function App(){ return <main className="app" aria-label="Scorch dashboard" data-x="1"><div>hi</div></main> }')).toBe(false)
  })

  it('does NOT flag a <main> whose aria-label is preceded by a JSX-comparison attribute (#1668)', () => {
    expect(hasAxLandmarkGap('function App(){ return <main data-count={n > 0 ? 1 : 0} aria-label="Scorch dashboard"><div>hi</div></main> }')).toBe(false)
  })

  it('is unconditional — flags even a plain counter with no data-management idea at all', () => {
    const r = checkObedience('function App(){ return <div>0</div> }', 'a counter')
    expect(r.axLandmarkGap).toBe(true)
  })

  // Real bug (#1713): a leftover commented-out example mentioning a
  // compliant <main> used to satisfy this check even with no real <main>
  // landmark anywhere in the actual rendered output.
  it('still flags a missing landmark when only a //-comment mentions a compliant <main>', () => {
    const code = '// example: <main aria-label="App content">...</main>\nfunction App(){ return <div>hi</div> }'
    expect(hasAxLandmarkGap(code)).toBe(true)
  })

  it('still flags a missing landmark when only a /* */ comment mentions a compliant <main>', () => {
    const code = '/* was: <main aria-label="App content">...</main> */\nfunction App(){ return <div>hi</div> }'
    expect(hasAxLandmarkGap(code)).toBe(true)
  })

  it('still detects a real compliant <main> even when an unrelated comment also mentions one', () => {
    const code = '// old shape: <main>...</main>\nfunction App(){ return <main aria-label="App content"><div>hi</div></main> }'
    expect(hasAxLandmarkGap(code)).toBe(false)
  })

  it('checkObedience surfaces axLandmarkGap and a reason string', () => {
    const r = checkObedience('function App(){ return <div>hi</div> }', 'anything')
    expect(r.axLandmarkGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('<main aria-label'))).toBe(true)
  })

  it('buildObediencePrompt includes the real <main aria-label> shape when this gap fires', () => {
    const r = checkObedience('function App(){ return <div>hi</div> }', 'anything')
    const prompt = buildObediencePrompt('anything', r)
    expect(prompt).toMatch(/ADD THE ROOT AX LANDMARK/)
    expect(prompt).toMatch(/<main aria-label=/)
  })

  it('buildObediencePrompt omits the AX section when the landmark is already present', () => {
    const r = checkObedience('function App(){ return <main aria-label="App"><div>hi</div></main> }', 'anything')
    expect(r.axLandmarkGap).toBe(false)
    const prompt = buildObediencePrompt('anything', r)
    expect(prompt).not.toMatch(/ADD THE ROOT AX LANDMARK/)
  })
})

describe('obedience-gate: AX agent manifest (builder#687 item 5)', () => {
  it('flags an app with no data-agent-manifest at all', () => {
    expect(hasAxManifestGap('function App(){ return <div>hi</div> }')).toBe(true)
  })

  it('does NOT flag an app that has the hidden manifest block', () => {
    expect(hasAxManifestGap('function App(){ return <div hidden data-agent-manifest="true"></div> }')).toBe(false)
  })

  it('checkObedience surfaces axManifestGap and a reason string', () => {
    const r = checkObedience('function App(){ return <div>hi</div> }', 'anything')
    expect(r.axManifestGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('agent action manifest'))).toBe(true)
  })

  it('buildObediencePrompt includes the manifest shape when this gap fires, omits it when already present', () => {
    const missing = checkObedience('function App(){ return <div>hi</div> }', 'anything')
    expect(buildObediencePrompt('anything', missing)).toMatch(/ADD A HIDDEN AGENT ACTION MANIFEST/)

    const present = checkObedience('function App(){ return <div hidden data-agent-manifest="true"></div> }', 'anything')
    expect(present.axManifestGap).toBe(false)
    expect(buildObediencePrompt('anything', present)).not.toMatch(/ADD A HIDDEN AGENT ACTION MANIFEST/)
  })
})

describe('obedience-gate: AX JSON-LD structured data (builder#687 item 6)', () => {
  it('flags an app with no JSON-LD script at all', () => {
    expect(hasAxJsonLdGap('function App(){ return <div>hi</div> }')).toBe(true)
  })

  it('does NOT flag an app that has a JSON-LD script tag', () => {
    expect(hasAxJsonLdGap('function App(){ return <script type="application/ld+json">{}</script> }')).toBe(false)
  })

  it('does NOT flag a JSON-LD script tag whose type attr is preceded by a JSX-comparison attribute (#1668)', () => {
    expect(hasAxJsonLdGap('function App(){ return <script data-x={n > 0 ? 1 : 0} type="application/ld+json">{}</script> }')).toBe(false)
  })

  // Real bug (#1713): a commented-out example JSON-LD script tag used to
  // satisfy this check with no real structured-data script anywhere.
  it('still flags a missing JSON-LD script when only a comment mentions one', () => {
    const code = '/* add: <script type="application/ld+json">{}</script> */\nfunction App(){ return <div>hi</div> }'
    expect(hasAxJsonLdGap(code)).toBe(true)
  })

  it('checkObedience surfaces axJsonLdGap and a reason string', () => {
    const r = checkObedience('function App(){ return <div>hi</div> }', 'anything')
    expect(r.axJsonLdGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('JSON-LD'))).toBe(true)
  })

  it('buildObediencePrompt includes the JSON-LD shape when this gap fires, omits it when already present', () => {
    const missing = checkObedience('function App(){ return <div>hi</div> }', 'anything')
    expect(buildObediencePrompt('anything', missing)).toMatch(/ADD JSON-LD STRUCTURED DATA/)

    const present = checkObedience('function App(){ return <script type="application/ld+json">{}</script> }', 'anything')
    expect(present.axJsonLdGap).toBe(false)
    expect(buildObediencePrompt('anything', present)).not.toMatch(/ADD JSON-LD STRUCTURED DATA/)
  })
})

describe('obedience-gate: AX skip-navigation link (builder#687 item 8)', () => {
  it('flags an app with no skip-nav link at all', () => {
    expect(hasAxSkipNavGap('function App(){ return <main id="main-content">hi</main> }')).toBe(true)
  })

  it('flags a skip-nav link with no matching target id (dangling link)', () => {
    expect(hasAxSkipNavGap('function App(){ return <a href="#main-content" data-agent-action="skip-nav">Skip</a><div>hi</div> }')).toBe(true)
  })

  it('does NOT flag a real skip-nav link with a matching target id', () => {
    expect(hasAxSkipNavGap('function App(){ return <a href="#main-content" data-agent-action="skip-nav">Skip</a><main id="main-content">hi</main> }')).toBe(false)
  })

  it('also accepts the plain "Skip to main content" text pattern without the data-agent-action marker', () => {
    expect(hasAxSkipNavGap('function App(){ return <a href="#content">Skip to main content</a><main id="content">hi</main> }')).toBe(false)
  })

  it('does NOT flag a skip-nav link whose href is preceded by a JSX-comparison attribute (#1668)', () => {
    expect(hasAxSkipNavGap('function App(){ return <a data-x={n > 0 ? 1 : 0} href="#main-content" data-agent-action="skip-nav">Skip</a><main id="main-content">hi</main> }')).toBe(false)
  })

  // Real bug (#1713): a commented-out example skip-link (and its matching
  // id target) used to satisfy this check with no real skip-nav anywhere.
  it('still flags a missing skip-nav link when only a comment mentions a compliant one', () => {
    const code = '// example: <a href="#main-content" data-agent-action="skip-nav">Skip</a><main id="main-content">hi</main>\nfunction App(){ return <div>hi</div> }'
    expect(hasAxSkipNavGap(code)).toBe(true)
  })

  it('checkObedience surfaces axSkipNavGap and a reason string', () => {
    const r = checkObedience('function App(){ return <div>hi</div> }', 'anything')
    expect(r.axSkipNavGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('skip-navigation'))).toBe(true)
  })

  it('buildObediencePrompt includes the skip-nav shape when this gap fires, omits it when already present', () => {
    const missing = checkObedience('function App(){ return <div>hi</div> }', 'anything')
    expect(buildObediencePrompt('anything', missing)).toMatch(/ADD A SKIP-NAVIGATION LINK/)

    const present = checkObedience('function App(){ return <a href="#main-content" data-agent-action="skip-nav">Skip</a><main id="main-content">hi</main> }', 'anything')
    expect(present.axSkipNavGap).toBe(false)
    expect(buildObediencePrompt('anything', present)).not.toMatch(/ADD A SKIP-NAVIGATION LINK/)
  })
})

describe('obedience-gate: AX nav label (builder#687 item 2)', () => {
  it('does NOT flag an app with no <nav> at all — a simple app legitimately has none', () => {
    expect(hasAxNavLabelGap('function App(){ return <main aria-label="App"><div>hi</div></main> }')).toBe(false)
  })

  it('flags a <nav> with no aria-label', () => {
    expect(hasAxNavLabelGap('function App(){ return <nav><a href="/">Home</a></nav> }')).toBe(true)
  })

  it('does NOT flag a <nav> that has aria-label', () => {
    expect(hasAxNavLabelGap('function App(){ return <nav aria-label="Main navigation"><a href="/">Home</a></nav> }')).toBe(false)
  })

  it('flags if ANY of multiple <nav> elements is missing aria-label', () => {
    const code = 'function App(){ return <><nav aria-label="Main">...</nav><nav><a href="/2">2</a></nav></> }'
    expect(hasAxNavLabelGap(code)).toBe(true)
  })

  it('does NOT flag when ALL <nav> elements have aria-label', () => {
    const code = 'function App(){ return <><nav aria-label="Main">...</nav><nav aria-label="Pagination">...</nav></> }'
    expect(hasAxNavLabelGap(code)).toBe(false)
  })

  it('does NOT flag a <nav> that HAS aria-label when an earlier attribute is a JSX expression containing a `>` comparison', () => {
    // Real bug: a flat `[^>]*` stops at the FIRST `>`, and a JSX expression
    // attribute containing an ordinary comparison operator (e.g.
    // `aria-hidden={count > 0}`) supplies one — truncating the match before
    // the real `aria-label=` later in the tag is ever reached, falsely
    // flagging a genuinely-compliant <nav> as missing it.
    const code = 'function App(){ return <nav aria-hidden={count > 0} aria-label="Main navigation"><a href="/">Home</a></nav> }'
    expect(hasAxNavLabelGap(code)).toBe(false)
  })

  // Real bug (#1713): matchOpeningTags used to match a commented-out
  // example <nav> with no real <nav> anywhere in the app, wrongly flagging
  // a gap the app doesn't actually have (the app legitimately has no nav).
  it('does NOT flag an app with no real <nav> when only a comment mentions an unlabeled one', () => {
    const code = '// old shape: <nav><a href="/">Home</a></nav>\nfunction App(){ return <main aria-label="App"><div>hi</div></main> }'
    expect(hasAxNavLabelGap(code)).toBe(false)
  })

  it('checkObedience surfaces axNavLabelGap and a reason string only when a nav is actually present', () => {
    const noNav = checkObedience('function App(){ return <main aria-label="App"><div>hi</div></main> }', 'a counter')
    expect(noNav.axNavLabelGap).toBe(false)

    const unlabeledNav = checkObedience('function App(){ return <nav><a href="/">Home</a></nav> }', 'a dashboard')
    expect(unlabeledNav.axNavLabelGap).toBe(true)
    expect(unlabeledNav.reasons.some((x) => x.includes('<nav>'))).toBe(true)
  })

  it('buildObediencePrompt includes the nav-label instruction when this gap fires, omits it otherwise', () => {
    const missing = checkObedience('function App(){ return <nav><a href="/">Home</a></nav> }', 'anything')
    expect(buildObediencePrompt('anything', missing)).toMatch(/LABEL YOUR <nav>/)

    const present = checkObedience('function App(){ return <nav aria-label="Main"><a href="/">Home</a></nav> }', 'anything')
    expect(present.axNavLabelGap).toBe(false)
    expect(buildObediencePrompt('anything', present)).not.toMatch(/LABEL YOUR <nav>/)
  })
})

describe('obedience-gate: AX section label (builder#687 item 3)', () => {
  it('does NOT flag an app with no <section> at all', () => {
    expect(hasAxSectionLabelGap('function App(){ return <div>hi</div> }')).toBe(false)
  })

  it('flags a <section> with no aria-label', () => {
    expect(hasAxSectionLabelGap('function App(){ return <section><div>hi</div></section> }')).toBe(true)
  })

  it('does NOT flag a <section> that has aria-label', () => {
    expect(hasAxSectionLabelGap('function App(){ return <section aria-label="Recent activity"><div>hi</div></section> }')).toBe(false)
  })

  it('does NOT flag a <section> that HAS aria-label when an earlier attribute is a JSX expression containing a `>` comparison', () => {
    const code = 'function App(){ return <section aria-hidden={count > 0} aria-label="Recent activity"><div>hi</div></section> }'
    expect(hasAxSectionLabelGap(code)).toBe(false)
  })

  it('checkObedience + buildObediencePrompt wire through correctly', () => {
    const r = checkObedience('function App(){ return <section><div>hi</div></section> }', 'anything')
    expect(r.axSectionLabelGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('<section>'))).toBe(true)
    expect(buildObediencePrompt('anything', r)).toMatch(/LABEL YOUR <section>/)
  })
})

describe('obedience-gate: AX agent attribute coverage (builder#687 item 4)', () => {
  it('does NOT flag an app with too little interactive surface to judge coverage (< 2 interactive elements)', () => {
    expect(hasAxAgentAttributesGap('function App(){ return <button>Go</button> }')).toBe(false)
  })

  it('flags an app with several real interactive elements and NO data-agent-* markers anywhere', () => {
    const code = 'function App(){ return <><button onClick={a}>Add</button><button onClick={b}>Remove</button><a href="/settings">Settings</a></> }'
    expect(hasAxAgentAttributesGap(code)).toBe(true)
  })

  it('REAL COVERAGE RATIO, not mere presence: 1 of 4 tagged is below the 50% (floor) bar and IS flagged', () => {
    const code = 'function App(){ return <><button data-agent-action="add">Add</button><button onClick={b}>Remove</button><button onClick={c}>Edit</button><a href="/settings">Settings</a></> }'
    // 4 interactive elements, floor(4*0.5)=2 required, only 1 tagged -> gap.
    expect(hasAxAgentAttributesGap(code)).toBe(true)
  })

  it('does NOT flag once at least the required ratio is met (2 of 4 tagged meets the floor(4*0.5)=2 bar)', () => {
    const code = 'function App(){ return <><button data-agent-action="add">Add</button><button data-agent-action="remove">Remove</button><button onClick={c}>Edit</button><a href="/settings">Settings</a></> }'
    expect(hasAxAgentAttributesGap(code)).toBe(false)
  })

  it('partial coverage below 50% is NOT excused just because something is tagged (old "any tag anywhere" behavior is gone)', () => {
    const code = 'function App(){ return <><button data-agent-action="add">Add</button><button onClick={b}>Remove</button><button onClick={c}>Edit</button><button onClick={d}>Cancel</button><a href="/settings">Settings</a></> }'
    // 5 elements, floor(5*0.5)=2 required, only 1 tagged -> still a gap.
    expect(hasAxAgentAttributesGap(code)).toBe(true)
  })

  it('rounds the required count DOWN for odd totals — 3 elements need only 1 tagged, not 2', () => {
    const code = 'function App(){ return <><button data-agent-action="add">Add</button><button onClick={b}>Remove</button><a href="/settings">Settings</a></> }'
    expect(hasAxAgentAttributesGap(code)).toBe(false)
  })

  it('a single element carrying ALL THREE markers still counts as exactly one tagged element, not three', () => {
    const code = 'function App(){ return <><button data-agent-role="button" data-agent-action="add" data-agent-context="items">Add</button><button onClick={b}>Remove</button><button onClick={c}>Edit</button><button onClick={d}>Cancel</button></> }'
    // 4 elements, floor(4*0.5)=2 required; only 1 element is actually tagged
    // (despite carrying 3 attributes) -> still a gap, not incorrectly "3 tagged".
    expect(hasAxAgentAttributesGap(code)).toBe(true)
  })

  it('a bare href="#" link does not count toward the interactive-element threshold', () => {
    expect(hasAxAgentAttributesGap('function App(){ return <><button onClick={a}>Go</button><a href="#">x</a></> }')).toBe(false)
  })

  it('a data-agent-* marker is still detected when an earlier attribute is a JSX expression containing a `>` comparison', () => {
    // Same bug class as the nav/section label gaps: a flat `[^>]*` stops at
    // the first `>`, and `disabled={count > 0}` supplies one before the
    // real `data-agent-action=` is reached — falsely treating a tagged
    // element as untagged.
    const code = 'function App(){ return <><button disabled={count > 0} data-agent-action="add">Add</button><button data-agent-action="remove">Remove</button><button onClick={c}>Edit</button><a href="/settings">Settings</a></> }'
    // 4 elements, floor(4*0.5)=2 required, 2 tagged -> no gap.
    expect(hasAxAgentAttributesGap(code)).toBe(false)
  })

  it('checkObedience + buildObediencePrompt wire through correctly', () => {
    const code = 'function App(){ return <><button onClick={a}>Add</button><button onClick={b}>Remove</button></> }'
    const r = checkObedience(code, 'anything')
    expect(r.axAgentAttributesGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('data-agent'))).toBe(true)
    expect(buildObediencePrompt('anything', r)).toMatch(/TAG INTERACTIVE ELEMENTS FOR AGENTS/)
  })

  it('buildObediencePrompt states the coverage expectation, not just "tag some elements"', () => {
    const code = 'function App(){ return <><button onClick={a}>Add</button><button onClick={b}>Remove</button></> }'
    const r = checkObedience(code, 'anything')
    expect(buildObediencePrompt('anything', r)).toMatch(/at least HALF/i)
  })
})

describe('obedience-gate: AX complex widget roles (builder#687 item 7)', () => {
  it('does NOT flag an app with no tab-like or live-status pattern at all', () => {
    expect(hasAxComplexWidgetRoleGap('function App(){ return <div>hi</div> }')).toBe(false)
  })

  it('flags a tab-like widget (activeTab state + buttons) with no tablist/tab roles', () => {
    const code = 'function App(){ const [activeTab,setActiveTab]=useState(0); return <button onClick={()=>setActiveTab(1)}>Tab</button> }'
    expect(hasAxComplexWidgetRoleGap(code)).toBe(true)
  })

  it('does NOT flag a tab-like widget that already has tablist/tab roles', () => {
    const code = 'function App(){ const [activeTab,setActiveTab]=useState(0); return <div role="tablist"><button role="tab" onClick={()=>setActiveTab(1)}>Tab</button></div> }'
    expect(hasAxComplexWidgetRoleGap(code)).toBe(false)
  })

  it('flags a loading/spinner pattern with no status role or aria-live', () => {
    const code = 'function App(){ const [isLoading,setIsLoading]=useState(true); return <div className="animate-spin">Loading...</div> }'
    expect(hasAxComplexWidgetRoleGap(code)).toBe(true)
  })

  it('does NOT flag a loading pattern that already has role="status" or aria-live', () => {
    const code = 'function App(){ const [isLoading,setIsLoading]=useState(true); return <div role="status" className="animate-spin">Loading...</div> }'
    expect(hasAxComplexWidgetRoleGap(code)).toBe(false)
  })

  it('checkObedience + buildObediencePrompt wire through correctly', () => {
    const code = 'function App(){ const [activeTab,setActiveTab]=useState(0); return <button onClick={()=>setActiveTab(1)}>Tab</button> }'
    const r = checkObedience(code, 'anything')
    expect(r.axComplexWidgetRoleGap).toBe(true)
    expect(r.reasons.some((x) => x.includes('complex widget'))).toBe(true)
    expect(buildObediencePrompt('anything', r)).toMatch(/ADD ARIA ROLES TO YOUR COMPLEX WIDGET/)
  })
})

/**
 * Real gap found live (issue #624, Meridian real-product build, 2026-09-10):
 * the general obedience-repair pass in chat-ws adopts a candidate if ANY
 * dimension improved — even when primitiveComplianceGaps, the dimension
 * that most defines whether a real product actually calls its primitives,
 * is still wide open. Confirmed live: a repair pass fixed a hand-rolled
 * AIKitHeader but left "ZeroPipeline, ZeroVoice, ZeroMemory never called"
 * completely unresolved, and the general check adopted it anyway.
 *
 * narrowToPrimitiveComplianceOnly + evaluatePrimitiveComplianceRetry are the
 * pure decision logic behind chat-ws's targeted follow-up retry loop
 * (closePrimitiveComplianceGap) — extracted here so the actual decision-
 * making is unit-testable without mocking an LLM call.
 */
describe('obedience-gate: targeted primitive-compliance retry (#624)', () => {
  describe('narrowToPrimitiveComplianceOnly', () => {
    it('produces a result carrying ONLY the given primitive gaps, nothing else', () => {
      const r = narrowToPrimitiveComplianceOnly(['ZeroPipeline', 'ZeroVoice'])
      expect(r.primitiveComplianceGaps).toEqual(['ZeroPipeline', 'ZeroVoice'])
      expect(r.persistenceGap).toBe(false)
      expect(r.aikitGaps).toEqual([])
      expect(r.visitorTrackingGap).toBe(false)
      expect(r.fakeLeadCaptureGap).toBe(false)
      expect(r.hardcodedToggleGap).toBe(false)
    })

    it('buildObediencePrompt on the narrowed result emits ONLY the primitive-compliance section', () => {
      const r = narrowToPrimitiveComplianceOnly(['ZeroPipeline'])
      const prompt = buildObediencePrompt('a sales pipeline app', r)
      expect(prompt).toMatch(/YOU WERE TOLD TO CALL THESE REAL PRIMITIVES AND DID NOT: ZeroPipeline/)
      // None of the other repair sections should appear — this must be a
      // FOCUSED re-prompt, not a repeat of the general one.
      expect(prompt).not.toMatch(/PERSIST REAL DATA/)
      expect(prompt).not.toMatch(/USE AIKIT COMPONENTS/)
      expect(prompt).not.toMatch(/FIRE THE MANDATED VISITOR-TRACKING BEACON/)
    })

    it('ok is false when gaps are non-empty, true when empty', () => {
      expect(narrowToPrimitiveComplianceOnly(['ZeroPipeline']).ok).toBe(false)
      expect(narrowToPrimitiveComplianceOnly([]).ok).toBe(true)
    })
  })

  describe('evaluatePrimitiveComplianceRetry', () => {
    it('reports progress and NOT closed when the gap shrinks but is not empty', () => {
      const result = evaluatePrimitiveComplianceRetry(['ZeroPipeline', 'ZeroVoice'], ['ZeroPipeline'])
      expect(result.madeProgress).toBe(true)
      expect(result.closed).toBe(false)
    })

    it('reports progress AND closed when the gap fully resolves', () => {
      const result = evaluatePrimitiveComplianceRetry(['ZeroPipeline'], [])
      expect(result.madeProgress).toBe(true)
      expect(result.closed).toBe(true)
    })

    it('reports NO progress when the gap is unchanged (the real bug this fixes: adopting a no-op retry)', () => {
      const result = evaluatePrimitiveComplianceRetry(['ZeroPipeline', 'ZeroVoice'], ['ZeroPipeline', 'ZeroVoice'])
      expect(result.madeProgress).toBe(false)
      expect(result.closed).toBe(false)
    })

    it('reports NO progress (and flags it) if a retry somehow makes things WORSE', () => {
      const result = evaluatePrimitiveComplianceRetry(['ZeroPipeline'], ['ZeroPipeline', 'ZeroVoice'])
      expect(result.madeProgress).toBe(false)
      expect(result.closed).toBe(false)
    })
  })
})
