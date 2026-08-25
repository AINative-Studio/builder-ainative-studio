import { describe, it, expect } from 'vitest'
import { isRenderable, validateJavaScriptCode } from '@/lib/code-validator'
import { checkAppReady } from '@/lib/build/ready-gate'
import { storePreview } from '@/lib/preview-store'

/**
 * builder#79 — the "tangle" (chatId bH0a0UpzRuKBVpy4TPngr) regression.
 *
 * tangle crashed at runtime with "ErrorBoundary is not defined" + "Unexpected
 * token" yet the #77 parse gate PASSED it (verified live: register-app returned
 * ok:true, not generation_failed). Root cause: the generated code was TRUNCATED —
 * cut off mid-render, leaving JSX open and dangling closers ("<div>\n));\n}\n}").
 * Babel reports this as "Unterminated JSX contents", which was NOT in the gate's
 * catastrophic-error set, so validateJavaScriptCode returned valid:true (treated it
 * as a benign warning) and the broken app shipped. The truncated app then blanks
 * the preview / fires the ErrorBoundary path downstream.
 *
 * This corpus locks in: (a) tangle's truncation class (and its siblings) is
 * REJECTED by the gate, and (b) legitimate apps — including ones that reference
 * <ErrorBoundary> (now runtime-resolvable, builder#79 route.ts fix) — still PASS.
 */

// The exact tail shape of tangle's stored code: a component that references known
// components/icons but whose render is TRUNCATED (JSX left open, then a stray
// "));\n}\n}"). This is a faithful, compact reproduction of chatId
// bH0a0UpzRuKBVpy4TPngr's defect.
const TANGLE_TRUNCATED = `function App() {
  const [activeTab, setActiveTab] = useState('discover')
  const profiles = [{ id: 1, name: 'Alex' }]
  return (
    <div className="min-h-screen">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="discover">Discover</TabsTrigger>
        </TabsList>
      </Tabs>
      {profiles.map((p) => (
        <Card key={p.id}>
          <CardContent>
            <h3>{p.name}</h3>
            <div>
));
}
}`

// A minimal VALID app — must keep passing (guards against over-rejection).
const GOOD_APP = `function App() {
  const [count, setCount] = useState(0)
  return (
    <Card>
      <CardContent>
        <h1>Counter</h1>
        <Button onClick={() => setCount(count + 1)}>{count}</Button>
      </CardContent>
    </Card>
  )
}`

describe('builder#79 — tangle truncation is REJECTED by the gate', () => {
  it('rejects the tangle-class truncated app (was shipped as ok:true)', () => {
    const r = isRenderable(TANGLE_TRUNCATED)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('syntax_error')
    // The precise Babel diagnostic for the truncation.
    expect((r.error || '').toLowerCase()).toContain('unterminated jsx')
  })

  it('validateJavaScriptCode marks the truncated app invalid (catastrophic)', () => {
    const r = validateJavaScriptCode(TANGLE_TRUNCATED, {
      importsStripped: false,
      lenient: false,
    })
    expect(r.valid).toBe(false)
  })

  it('rejects a truncation that leaves a JSX element unclosed at EOF', () => {
    const bad = `function App() {\n  return (\n    <div>\n      <span>hello`
    expect(isRenderable(bad).ok).toBe(false)
  })

  it('rejects code cut off mid-expression (dangling closers only)', () => {
    const bad = `function App() {\n  return (\n    <div>\n      <p>hi</p>\n      <div>\n));\n}\n}`
    expect(isRenderable(bad).ok).toBe(false)
  })

  it('rejects a truncation that cuts off inside a string literal', () => {
    const bad = `function App() {\n  const label = "started but never closed\n  return <div>{label}</div>\n}`
    expect(isRenderable(bad).ok).toBe(false)
  })
})

describe('builder#79 — legitimate apps still pass (no over-rejection)', () => {
  it('accepts a valid single-page app', () => {
    expect(isRenderable(GOOD_APP).ok).toBe(true)
  })

  it('accepts a well-formed app that references <ErrorBoundary>', () => {
    // The runtime now binds ErrorBoundary as a bare identifier (route.ts #79 fix),
    // so a well-formed app that wraps itself in <ErrorBoundary> must NOT be flagged
    // — only truncated/broken code is rejected.
    const eb = `function App() {
  const [n, setN] = useState(0)
  return (
    <ErrorBoundary>
      <Card>
        <CardContent>
          <Button onClick={() => setN(n + 1)}>{n}</Button>
        </CardContent>
      </Card>
    </ErrorBoundary>
  )
}`
    const r = isRenderable(eb)
    expect(r.ok).toBe(true)
  })
})

describe('builder#79 — end-to-end ready gate on the tangle defect', () => {
  it('checkAppReady BLOCKS the truncated app resolved from the preview store', async () => {
    const chatId = 'issue-79-tangle-bad'
    storePreview(chatId, TANGLE_TRUNCATED)
    const res = await checkAppReady(chatId)
    expect(res.checked).toBe(true)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('syntax_error')
  })

  it('checkAppReady PASSES a good app resolved from the preview store', async () => {
    const chatId = 'issue-79-tangle-good'
    storePreview(chatId, GOOD_APP)
    const res = await checkAppReady(chatId)
    expect(res.checked).toBe(true)
    expect(res.ok).toBe(true)
  })
})
