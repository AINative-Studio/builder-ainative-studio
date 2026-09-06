import { describe, it, expect } from 'vitest'
import {
  usesDataLayer,
  hasPersistenceGap,
  findAikitGaps,
  findPrimitiveComplianceGaps,
  hasVisitorTrackingGap,
  checkObedience,
  buildObediencePrompt,
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

describe('obedience-gate: checkObedience + prompt', () => {
  it('ok:true when no gaps (including the mandated visitor beacon)', () => {
    const r = checkObedience(
      "function App(){ useEffect(()=>{fetch('/api/db/visitors',{method:'POST'})},[]); return <div>hi</div>}",
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
