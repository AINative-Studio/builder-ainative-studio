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

  // Real bug (2026-10-28): a flat `\([^)]*\)` for the param list cannot
  // cross a `)` INSIDE the param list — e.g. a destructured default value
  // that calls a function. The redeclaration below was never matched at
  // all, so it survived dedup and would throw "Identifier 'Button' has
  // already been declared" alongside the real import.
  it('#1619-class: removes a const-arrow redeclaration whose destructured param has a call-expression default', () => {
    const code = [
      "import { Button } from './components/ui/button'",
      "const Button = ({ variant = getDefaultVariant() }) => {",
      "  return (<button className={variant}>Click</button>);",
      "}",
      "",
      "function App() {",
      "  return <Button variant=\"primary\">Hi</Button>;",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/const Button\s*=/)
    expect(out).toMatch(/function App\(/)
  })

  it('#1619-class: removes a single-line function redeclaration whose param has a call-expression default', () => {
    const code = [
      "function Card({ variant = getDefaultVariant() }){ return (variant); } // stub",
      "",
      "function Customers() {",
      "  function helper() { return 1; }",
      "  return <div>customers</div>;",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/function Card\(/)
    expect(out).toMatch(/function Customers\(/)
    expect(out).toMatch(/function helper\(/)
  })

  it('#1619-class: removes a multi-line function redeclaration whose param has a nested-destructure call-expression default', () => {
    const code = [
      "function Badge({ pair: [a, b] = getPair() }) {",
      "  return (",
      "    <span>{a}{b}</span>",
      "  );",
      "}",
      "",
      "function App() {",
      "  return <Badge />;",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/function Badge\(/)
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

  // Real bug (2026-10-29): findMatchingParen did a plain char-by-char `(`/`)`
  // count with no notion of string content. A destructured default VALUE
  // that is a string/template literal containing a lone, unmatched `)`
  // (e.g. an emoticon) got counted as the param list's real close, so the
  // redeclaration was never matched and survived dedup — reproducing the
  // exact "Identifier already declared" crash this module exists to
  // prevent (same class as #1654, different call site).
  it('#1654-class: removes a const-arrow redeclaration whose destructured default is a string literal with a stray unmatched paren', () => {
    const code = [
      "import { Button } from './components/ui/button'",
      "const Button = ({ label = 'Thanks :)' }) => {",
      "  return (<button>{label}</button>);",
      "}",
      "",
      "function App() {",
      '  return <Button label="hi" />;',
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/const Button\s*=/)
    expect(out).toMatch(/function App\(/)
  })

  it('#1654-class: removes a const-arrow redeclaration whose destructured default is a template literal with a stray unmatched paren', () => {
    const code = [
      "import { Button } from './components/ui/button'",
      "const Button = ({ label = `Thanks :)` }) => {",
      "  return (<button>{label}</button>);",
      "}",
      "",
      "function App() {",
      '  return <Button label="hi" />;',
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/const Button\s*=/)
    expect(out).toMatch(/function App\(/)
  })

  it('#1654-class: removes a single-line function redeclaration whose default param value is a string literal with a stray unmatched paren', () => {
    const code = [
      "function Card({ label = 'Thanks :)' }){ return (label); } // stub",
      "",
      "function Customers() {",
      "  function helper() { return 1; }",
      "  return <div>customers</div>;",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/function Card\(/)
    expect(out).toMatch(/function Customers\(/)
    expect(out).toMatch(/function helper\(/)
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

  /**
   * Real bug found live (Habanero Hub, 2026-09-11): the preview scaffold's
   * own setup script pre-declares ~180 Lucide icon names as plain top-level
   * `const`s (app/api/preview/[id]/route.ts's "Create all common icon
   * constants" block) — these were never added to
   * SCAFFOLD_PROVIDED_COMPONENTS, which only ever covered shadcn/AIKit
   * names. A generated app that hand-rolls its own fallback component using
   * one of these ~180 reserved names (reasonable: the model has no way to
   * know these specific names are pre-declared elsewhere) crashes the WHOLE
   * app with a real `SyntaxError: Identifier 'X' has already been declared`
   * — even though the setup script and the compiled app script can't
   * actually read each other's values, a top-level const/let in either one
   * still occupies the SAME shared global lexical scope, so redeclaring the
   * same name anywhere throws regardless. Confirmed live: DollarSign,
   * exactly this shape, crashed the app before ANY component (and therefore
   * no primitive call) ever ran.
   */
  it('removes a hand-rolled icon-name redeclaration that collides with the scaffold-provided Lucide icon consts (the real Habanero Hub bug)', () => {
    const code = [
      "const Button = ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>;",
      "const DollarSign = ({ className }) => <span className={className}>$</span>;",
      "const Truck = ({ className }) => <span className={className}>🚚</span>;",
      "const Clock = ({ className }) => <span className={className}>🕒</span>;",
      "",
      "export default function Orders() {",
      "  const [orders, setOrders] = useState([]);",
      "  return (",
      "    <div>",
      "      <DollarSign className=\"w-5 h-5 text-green-400\" />",
      "      {orders.map(o => <div key={o.id}>{o.name}</div>)}",
      "    </div>",
      "  );",
      "}",
    ].join('\n')
    const out = dedupeProvidedComponents(code)
    expect(out).not.toMatch(/const DollarSign\s*=/)
    // The real component and its real logic must survive completely intact.
    expect(out).toMatch(/function Orders\(\)/)
    expect(out).toMatch(/const \[orders, setOrders\] = useState\(\[\]\);/)
    expect(out).toMatch(/orders\.map/)
    expect(() => babelParse(out, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
  })

  it('SCAFFOLD_PROVIDED_COMPONENTS includes the real pre-declared Lucide icon names from the preview scaffold', () => {
    for (const name of ['DollarSign', 'Truck', 'Clock', 'Search', 'ChevronDown', 'AlertTriangle', 'CheckCircle2']) {
      expect(SCAFFOLD_PROVIDED_COMPONENTS).toContain(name)
    }
  })

  // Round 4 of the same drift class as #1277/#1278/#1281 (fixed in
  // component-verifier.ts's AVAILABLE_COMPONENTS and component-detector.ts's
  // NON_ROOT_NAMES, but not here): these real shadcn exports were missing
  // from this list, so a generated app redeclaring one of them locally
  // never got deduped and kept the "Identifier has already been declared"
  // crash.
  it('SCAFFOLD_PROVIDED_COMPONENTS includes RadioGroup/DialogOverlay/CircularProgress/Toast*', () => {
    for (const name of [
      'RadioGroup', 'RadioGroupItem', 'DialogOverlay', 'CircularProgress',
      'Toast', 'ToastTitle', 'ToastDescription',
    ]) {
      expect(SCAFFOLD_PROVIDED_COMPONENTS).toContain(name)
    }
  })

  // Same root-cause class as #1277/#1278/#1281: these are real shadcn
  // exports (lib/sandpack/shadcn-bundle.ts) that were missing from this
  // list, so a generated app redeclaring one of them locally never got
  // deduped and kept the "Identifier has already been declared" crash.
  it('SCAFFOLD_PROVIDED_COMPONENTS includes the real shadcn exports that had drifted out of sync', () => {
    for (const name of [
      'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem',
      'DropdownMenuLabel', 'DropdownMenuSeparator',
      'ScrollArea', 'ScrollBar', 'Slider', 'Switch', 'Textarea',
      'Tooltip', 'TooltipTrigger', 'TooltipContent', 'TooltipProvider',
    ]) {
      expect(SCAFFOLD_PROVIDED_COMPONENTS).toContain(name)
    }
  })
})
