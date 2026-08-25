import { describe, it, expect } from 'vitest'
import {
  isRenderable,
  extractRenderableCode,
  validateJavaScriptCode,
  findUnresolvedComponents,
} from '@/lib/code-validator'

/**
 * builder#77 — pre-deploy PARSE GATE corpus.
 *
 * A broken generated app must NOT be marked ready / deployed. These tests feed the
 * gate KNOWN-GOOD and KNOWN-BAD generated code and assert the bad code is rejected
 * (with a machine-readable reason) while the good code passes. The centerpiece is
 * the "quad" college-social-app regression: it used <MessageCircle> (a real lucide
 * icon the preview runtime provides) which the validator's icon catalog omitted, so
 * a working app was flagged "unresolved component" and shipped as a Syntax-Error
 * page. That icon is now in the catalog; this locks it in.
 */

// A minimal, VALID single-page app (parses, all components resolvable).
const GOOD_APP = `function App() {
  const [count, setCount] = useState(0)
  return (
    <Card>
      <CardContent>
        <h1>Counter</h1>
        <p>{count}</p>
        <Button onClick={() => setCount(count + 1)}>Increment</Button>
      </CardContent>
    </Card>
  )
}`

// The exact defect class from the quad app: a lucide icon the RUNTIME provides but
// the validator catalog previously omitted. Must now be treated as renderable.
const QUAD_ICON_APP = `function App() {
  const [posts, setPosts] = useState([])
  return (
    <div className="min-h-screen">
      <button><MessageCircle className="w-5 h-5" /><span>Comment</span></button>
      <button><Heart className="w-5 h-5" /><span>Like</span></button>
      <button><Share2 className="w-5 h-5" /><span>Share</span></button>
      {posts.map(p => (
        <Card key={p.id}><CardContent>{p.content || ''}</CardContent></Card>
      ))}
    </div>
  )
}`

describe('builder#77 parse gate — known-GOOD generated code passes', () => {
  it('accepts a valid single-page app', () => {
    const r = isRenderable(GOOD_APP)
    expect(r.ok).toBe(true)
    expect(r.reason).toBeUndefined()
  })

  it('accepts the quad app class using MessageCircle (regression)', () => {
    // The precise root cause: MessageCircle is a real lucide icon the preview
    // runtime declares (const MessageCircle = _getIcon("MessageCircle")), so it
    // must be recognized as available — not flagged as an unresolved component.
    expect(findUnresolvedComponents(QUAD_ICON_APP)).toEqual([])
    const r = isRenderable(QUAD_ICON_APP)
    expect(r.ok).toBe(true)
  })

  it('accepts a markdown-fenced app (renderer extraction)', () => {
    const fenced = '```jsx\n' + GOOD_APP + '\n```'
    expect(isRenderable(fenced).ok).toBe(true)
  })

  it('accepts a multi-file blob (App.tsx main file)', () => {
    const multi = `// --- FILE: src/App.tsx ---\n${GOOD_APP}\n// --- FILE: src/util.ts ---\nexport const x = 1\n`
    expect(isRenderable(multi).ok).toBe(true)
  })
})

describe('builder#77 parse gate — known-BAD generated code is rejected', () => {
  it('rejects empty content as empty (not a syntax error)', () => {
    const r = isRenderable('')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('empty')
  })

  it('rejects non-code prose as no_renderable_code', () => {
    const r = isRenderable('Here is your app, enjoy!')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_renderable_code')
  })

  it('rejects a hard syntax error (unterminated string)', () => {
    const bad = `function App() {\n  const label = "unterminated\n  return <div>{label}</div>\n}`
    const r = isRenderable(bad)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('syntax_error')
  })

  it('rejects an unexpected-token syntax error (not autofixable)', () => {
    // A doubled operator the autofix pipeline does not repair — parses as a hard
    // "Unexpected token" the Sandpack-strict runtime would also throw on.
    const bad = `function App() {\n  const x = 1 + * 2\n  return <div>{x}</div>\n}`
    const r = isRenderable(bad)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('syntax_error')
  })

  it('rejects a hallucinated component (used but never defined)', () => {
    const bad = `function App() {\n  return <div><TotallyMadeUpWidget /></div>\n}`
    const r = isRenderable(bad)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unresolved_component')
  })

  it('rejects an object rendered directly as a React child (#184)', () => {
    const bad = `function App() {\n  const meta = { title: 'x', count: 3 }\n  return <div>{meta}</div>\n}`
    const r = isRenderable(bad)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('object_as_child')
  })

  it('rejects an undefined variable reference (#191)', () => {
    const bad = `function App() {\n  return <div>{sensorReadings.length}</div>\n}`
    const r = isRenderable(bad)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('undefined_reference')
  })
})

describe('builder#77 — MessageCircle icon catalog sync', () => {
  it('validateJavaScriptCode passes MessageCircle at the generation seam', () => {
    // Generation-path validation does NOT strip imports, so pre-fix this returned
    // valid:false with "<MessageCircle> is used but not defined" — the quad bug.
    const r = validateJavaScriptCode(QUAD_ICON_APP, { importsStripped: false })
    expect(r.valid).toBe(true)
  })
})

describe('builder#77 — extractRenderableCode mirrors the preview renderer', () => {
  it('extracts the main file from a multi-file blob', () => {
    const multi = `// --- FILE: App.tsx ---\n${GOOD_APP}\n`
    const extracted = extractRenderableCode(multi)
    expect(extracted).toContain('function App()')
    expect(extracted).not.toContain('--- FILE:')
  })

  it('extracts code from a markdown fence', () => {
    const fenced = '```tsx\n' + GOOD_APP + '\n```'
    expect(extractRenderableCode(fenced)).toContain('function App()')
  })

  it('returns raw code untouched when there is no wrapper', () => {
    expect(extractRenderableCode(GOOD_APP)).toContain('function App()')
  })
})
