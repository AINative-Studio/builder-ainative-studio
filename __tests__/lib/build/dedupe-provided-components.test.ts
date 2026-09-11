import { describe, it, expect } from 'vitest'
import { parse as babelParse } from '@babel/parser'
import { dedupeProvidedComponents, SCAFFOLD_PROVIDED_COMPONENTS } from '@/lib/build/dedupe-provided-components'

/**
 * Real bug found live (Dispatch, 2026-09-11, customer-reported: "basic UI
 * components are missing"). See the module's own doc comment for the full
 * story: a non-brace-balanced regex hunting for the FIRST `\n}` after a
 * `function NAME(...) {` opening consumed an entire, unrelated, LATER
 * function's body because a single-line stub function (real output of
 * lib/build/flatten-multifile.ts's external-import fix) shared one of the
 * scaffold-provided names and had no `\n}` of its own to stop the search at.
 */
describe('dedupeProvidedComponents', () => {
  it('removes a genuine multi-line hand-rolled redeclaration cleanly (the original, intended use case)', () => {
    const code = [
      "function Button({ children, onClick }) {",
      "  return (",
      '    <button onClick={onClick} className="btn">',
      "      {children}",
      "    </button>",
      "  );",
      "}",
      "",
      "function App() {",
      "  return <Button>Click</Button>;",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/function Button\(/)
    expect(out).toMatch(/function App\(/)
    expect(out).toMatch(/<Button>Click<\/Button>/)
  })

  it('removes a genuine multi-line hand-rolled const-arrow redeclaration cleanly', () => {
    const code = [
      "const Card = ({ children }) => (",
      "  <div className=\"card\">{children}</div>",
      ");",
      "",
      "function App() {",
      "  return <Card>Hi</Card>;",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/const Card\s*=/)
    expect(out).toMatch(/function App\(/)
  })

  /**
   * THE Dispatch bug, reproduced exactly. A single-line stub function using
   * a scaffold-provided name (Card) appears BEFORE a real, unrelated,
   * genuinely multi-line function (Customers) with many internal `\n}`
   * closes. The old, non-brace-balanced regex consumed all the way through
   * Customers' own closing brace. It must not.
   */
  it('does NOT consume a later, unrelated multi-line function when a single-line stub shares a scaffold-provided name', () => {
    const code = [
      "function Card(props){ return (props && props.children) || null; } // stub: '@radix-ui/react-dialog' import not backed by the preview scaffold",
      "function Customers() {",
      "  const [customers, setCustomers] = useState([]);",
      "  useEffect(() => {",
      "    fetch('/api/primitive/zeropipeline/deals').then(r => r.json()).then(data => setCustomers(data.deals || []));",
      "  }, []);",
      "  return (",
      "    <div>",
      "      {customers.map(c => <div key={c.id}>{c.name}</div>)}",
      "    </div>",
      "  );",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    // The real Customers function must survive completely intact.
    expect(out).toMatch(/function Customers\(\)/)
    expect(out).toMatch(/const \[customers, setCustomers\] = useState\(\[\]\);/)
    expect(out).toMatch(/zeropipeline\/deals/)
    expect(out).toMatch(/customers\.map/)
    // A real parse must succeed on what remains.
    expect(() => babelParse(out, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
  })

  it('reproduces the exact live Dispatch shape: multiple single-line stubs before a real multi-line component', () => {
    const stubs = ['Card', 'CardContent', 'Button', 'Dialog', 'DialogContent', 'Label', 'Input', 'Separator']
      .map((name) => `function ${name}(props){ return (props && props.children) || null; } // stub: '@radix-ui/react-dialog' import not backed by the preview scaffold`)
      .join('\n')
    const code = [
      stubs,
      "function Customers() {",
      "  const [customers, setCustomers] = useState([]);",
      "  const addCustomer = async () => {",
      "    await fetch('/api/primitive/zeropipeline/deals', { method: 'POST' });",
      "  };",
      "  return (",
      "    <div className=\"grid\">",
      "      {customers.map(c => (",
      "        <Card key={c.id}>",
      "          <CardContent>{c.name}</CardContent>",
      "        </Card>",
      "      ))}",
      "    </div>",
      "  );",
      "}",
      "",
      "function App() {",
      "  return <Customers />;",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).toMatch(/function Customers\(\)/)
    expect(out).toMatch(/addCustomer/)
    expect(out).toMatch(/function App\(\)/)
    expect(() => babelParse(out, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
  })

  it('accepts a custom name list (defaults to the real SCAFFOLD_PROVIDED_COMPONENTS)', () => {
    const code = 'function Widget(props){ return null; }\nfunction App(){ return <Widget/>; }'
    const out = dedupeProvidedComponents(code, ['Widget'])
    expect(out).not.toMatch(/function Widget\(/)
    expect(out).toMatch(/function App\(/)
  })

  it('SCAFFOLD_PROVIDED_COMPONENTS includes the exact names Dispatch used', () => {
    for (const name of ['Card', 'CardContent', 'Button', 'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogFooter', 'Label', 'Input', 'Separator']) {
      expect(SCAFFOLD_PROVIDED_COMPONENTS).toContain(name)
    }
  })

  it('strips a trailing "Available Shadcn components" comment block', () => {
    const code = 'function App(){ return null; }\n// Available Shadcn components: Button, Card, ...\nsome trailing junk'
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/Available Shadcn components/)
  })
})
