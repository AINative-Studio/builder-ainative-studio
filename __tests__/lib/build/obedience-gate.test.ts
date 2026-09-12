import { describe, it, expect } from 'vitest'
import {
  usesDataLayer,
  hasPersistenceGap,
  findAikitGaps,
  findPrimitiveComplianceGaps,
  hasVisitorTrackingGap,
  hasFakeLeadCaptureGap,
  hasHardcodedToggleGap,
  hasAxLandmarkGap,
  hasAxManifestGap,
  hasAxJsonLdGap,
  hasAxSkipNavGap,
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

  it('is unconditional — flags even a plain counter with no data-management idea at all', () => {
    const r = checkObedience('function App(){ return <div>0</div> }', 'a counter')
    expect(r.axLandmarkGap).toBe(true)
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
