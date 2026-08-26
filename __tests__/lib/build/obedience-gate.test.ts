import { describe, it, expect } from 'vitest'
import {
  usesDataLayer,
  hasPersistenceGap,
  findAikitGaps,
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

describe('obedience-gate: checkObedience + prompt', () => {
  it('ok:true when no gaps', () => {
    const r = checkObedience("function App(){return <div>hi</div>}", 'a counter')
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

  it('never throws on empty/garbage input', () => {
    expect(() => checkObedience('', '')).not.toThrow()
    expect(checkObedience('', '').ok).toBe(true)
  })
})
