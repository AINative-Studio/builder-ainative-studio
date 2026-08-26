import { describe, it, expect } from 'vitest'
import { extractCodeFromMarkdown, validateGeneratedCode, findUnresolvedComponents } from '@/lib/code-validator'

/**
 * Regression (#296): a multi-file generation (// --- FILE: … --- markers, each file
 * in its own ```jsx fence) must NOT collapse to just the first fence. Before this
 * fix, a 25,960-char CRM validated as 1,144 chars — the App.tsx shell only —
 * silently discarding 95% of the app (shallow, non-interactive complex builds).
 */
describe('multi-file extraction (#296)', () => {
  const multiFile = [
    '// --- FILE: src/App.tsx ---',
    '```jsx',
    'import Sidebar from "./components/Sidebar"',
    'import Contacts from "./components/Contacts"',
    'export default function App(){ return (<div><Sidebar/><Contacts/></div>) }',
    '```',
    '// --- FILE: src/components/Sidebar.tsx ---',
    '```jsx',
    'export default function Sidebar(){ return <nav className="w-64">many nav items with onClick handlers</nav> }',
    '```',
    '// --- FILE: src/components/Contacts.tsx ---',
    '```jsx',
    'import { useState } from "react"',
    'export default function Contacts(){ const [rows,setRows]=useState([]); return <table><tbody>{rows.map(r=><tr key={r.id}><td>{r.name}</td></tr>)}</tbody></table> }',
    '```',
  ].join('\n')

  it('keeps ALL files, not just the first fence', () => {
    const out = extractCodeFromMarkdown(multiFile)
    expect(out).toContain('function App')
    expect(out).toContain('function Sidebar')   // 2nd file survived
    expect(out).toContain('function Contacts')  // 3rd file survived
    expect(out).not.toContain('```')            // fences stripped
    // The extracted content must be substantially larger than a single shell file.
    expect(out.length).toBeGreaterThan(200)
  })

  it('validateGeneratedCode sees the whole multi-file app', () => {
    const v = validateGeneratedCode(multiFile)
    expect(v.code).toContain('function Contacts')
    expect(v.code.length).toBeGreaterThan(200)
  })

  it('single-fence (non-multifile) content is unchanged', () => {
    const single = '```jsx\nexport default function App(){ return <div>hi</div> }\n```'
    const out = extractCodeFromMarkdown(single)
    expect(out).toBe('export default function App(){ return <div>hi</div> }')
  })

  it('raw code with no fences and no markers passes through', () => {
    const raw = 'export default function App(){ return <div>x</div> }'
    expect(extractCodeFromMarkdown(raw)).toContain('function App')
  })
})

/**
 * Regression (#293): decomposed multi-file TS apps were rejected because TypeScript
 * GENERIC type arguments (useState<Contact[]>, forwardRef<HTMLButtonElement, …>) and
 * interface/type names matched the PascalCase JSX-component regex and were flagged as
 * "unresolved components" — killing the decomposition adoption (crm/ecommerce kept
 * their single-file version). Generics/DOM-types/interfaces must NOT be flagged;
 * genuinely-undefined JSX components still must be.
 */
describe('findUnresolvedComponents — TS generics are not components (#293)', () => {
  it('does not flag TS generic type args or interface names', () => {
    expect(findUnresolvedComponents('const [r] = useState<Contact[]>([])')).toEqual([])
    expect(findUnresolvedComponents('const B = forwardRef<HTMLButtonElement, ButtonProps>((p,r)=><button/>)')).toEqual([])
    expect(findUnresolvedComponents('interface SidebarProps{}\nconst x = useRef<SidebarProps>(null)')).toEqual([])
  })

  it('still flags a genuinely undefined JSX component', () => {
    expect(findUnresolvedComponents('function App(){ return <TotallyMadeUpWidget /> }')).toContain('TotallyMadeUpWidget')
    expect(findUnresolvedComponents('function App(){ return (<MadeUp2 />) }')).toContain('MadeUp2')
  })

  it('does not flag a resolved local component or a known AIKit one', () => {
    expect(findUnresolvedComponents('function Card(){return <div/>}\nfunction App(){return <Card/>}')).toEqual([])
    expect(findUnresolvedComponents('function App(){return <MetricCard title="x"/>}')).toEqual([])
  })
})
