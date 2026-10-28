import { describe, it, expect } from 'vitest'
import {
  findUnresolvedComponents,
  validateJavaScriptCode,
} from '@/lib/code-validator'

/**
 * builder#76 — a component used in JSX but never defined/imported and not a
 * known-available primitive renders as "Element type is invalid: … undefined"
 * in Sandpack. The Babel parse can't catch it; findUnresolvedComponents does.
 */
describe('findUnresolvedComponents (#76)', () => {
  it('flags a hallucinated component (<Header/>) with no source', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ return <div><Header/><Todo/></div>; }',
    ].join('\n')
    const out = findUnresolvedComponents(code)
    expect(out).toContain('Header')
    expect(out).toContain('Todo')
  })

  it('does NOT flag a locally-defined component', () => {
    const code = [
      "import React from 'react'",
      'function Header(){ return <h1>Hi</h1>; }',
      'export default function App(){ return <div><Header/></div>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('does NOT flag an imported component', () => {
    const code = [
      "import React from 'react'",
      "import { CustomThing } from './custom'",
      'export default function App(){ return <CustomThing/>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('does NOT flag known AIKit / shadcn primitives (available without import)', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){',
      '  return <Card><CardHeader><CardTitle>x</CardTitle></CardHeader><MetricCard/><Button/><AIKitSidebar/></Card>;',
      '}',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  // Round 4 of the same drift class as #1277/#1278/#1281 (fixed in
  // component-verifier.ts's AVAILABLE_COMPONENTS and component-detector.ts's
  // NON_ROOT_NAMES, but not here): these real shadcn primitives were
  // missing from this file's own KNOWN_AVAILABLE_COMPONENTS set.
  it('does NOT flag DialogOverlay/CircularProgress/Toast*/RadioGroup*', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){',
      '  return <div><Dialog><DialogOverlay/></Dialog><CircularProgress/>',
      '    <Toast><ToastTitle/><ToastDescription/></Toast>',
      '    <RadioGroup><RadioGroupItem/></RadioGroup></div>;',
      '}',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  // Same drift class as #1277/#1278/#1281: real shadcn primitives missing
  // from this file's own KNOWN_AVAILABLE_COMPONENTS set.
  it('does NOT flag DropdownMenu*/ScrollBar/Tooltip* shadcn primitives', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){',
      '  return <DropdownMenu><DropdownMenuTrigger/><DropdownMenuContent>',
      '    <DropdownMenuItem/><DropdownMenuLabel/><DropdownMenuSeparator/>',
      '  </DropdownMenuContent></DropdownMenu>;',
      '}',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
    const code2 = [
      "import React from 'react'",
      'export default function App(){',
      '  return <div><ScrollBar/><Tooltip><TooltipTrigger/><TooltipContent/><TooltipProvider/></Tooltip></div>;',
      '}',
    ].join('\n')
    expect(findUnresolvedComponents(code2)).toEqual([])
  })

  // #1281: VideoPlayer/StreamingText/MediaGallery are real AIKit primitives
  // (see lib/sandpack/aikit-bundle.ts) that were missing from this file's own
  // KNOWN_AVAILABLE_COMPONENTS set, unlike the five sibling lists elsewhere
  // in the codebase (already fixed by #1248) -- a generated app using one of
  // these would get false-flagged as a hallucinated/unresolved component.
  it('does NOT flag VideoPlayer/StreamingText/MediaGallery (#1281)', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){',
      '  return <div><VideoPlayer src="x"/><StreamingText text="x"/><MediaGallery items={[]}/></div>;',
      '}',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  // #1304: the reverse of the round 1-4 drift class above. 'SheetTrigger',
  // 'SheetContent' and 'Toggle' aren't real anywhere (not in
  // lib/sandpack/shadcn-bundle.ts, not lucide icons, not in the preview
  // route's own knownComponents safety net) -- unlike 'Sheet'/'Command',
  // which are real lucide icon names and get rescued by the preview
  // runtime's catch-all icon loader even with no explicit const. Before the
  // fix this file's KNOWN_AVAILABLE_COMPONENTS falsely claimed all of them
  // were safe, so a generated app using Sheet/Toggle shipped a silent dead
  // placeholder div instead of retrying generation.
  it('flags SheetTrigger/SheetContent/Toggle as unresolved (#1304)', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){',
      '  return <div><Sheet><SheetTrigger/><SheetContent/></Sheet><Toggle/></div>;',
      '}',
    ].join('\n')
    const out = findUnresolvedComponents(code)
    expect(out).toContain('SheetTrigger')
    expect(out).toContain('SheetContent')
    expect(out).toContain('Toggle')
    expect(out).not.toContain('Sheet')
  })

  it('does NOT flag React built-ins (Fragment, Suspense)', () => {
    const code = 'export default function App(){ return <Suspense><Fragment/></Suspense>; }'
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('ignores lowercase HTML tags entirely', () => {
    const code = 'export default function App(){ return <div><section><span/></section></div>; }'
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('resolves a component defined in another file of multi-file output', () => {
    const code = [
      '// --- FILE: App.tsx ---',
      "import React from 'react'",
      'export default function App(){ return <Sidebar/>; }',
      '// --- FILE: Sidebar.tsx ---',
      'export function Sidebar(){ return <nav/>; }',
    ].join('\n')
    // Sidebar is defined in the second file — must not be flagged.
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('handles destructured components (const { X } = ...)', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ const { Row } = someLib; return <Row/>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  // A flat `[^}]*` capture on the destructuring brace can't balance a NESTED
  // pattern — it stops at the inner `}`, so the whole clause fails to match
  // and the bound name never becomes "available", flagging a perfectly real
  // component as unresolved.
  it('handles a NESTED destructuring pattern (const { theme: { Icon } } = ...)', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ const { theme: { Icon } } = useTheme(); return <Icon/>; }',
    ].join('\n')
    expect(findUnresolvedComponents(code)).toEqual([])
  })

  it('validateJavaScriptCode rejects code with a hallucinated component', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ return <div><Header/></div>; }',
    ].join('\n')
    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/Element type is invalid.*Header/i)
  })

  it('validateJavaScriptCode passes clean code using known primitives', () => {
    const code = [
      "import React from 'react'",
      'export default function App(){ return <Card><Button>Go</Button></Card>; }',
    ].join('\n')
    expect(validateJavaScriptCode(code).valid).toBe(true)
  })

  // #91: the /preview/[id] Babel renderer strips imports and injects components
  // as globals. On that path every component looks "unresolved" — that caller
  // passes importsStripped:true so the #76 check is skipped and valid apps are
  // not wrongly rejected.
  it('does NOT flag components when importsStripped:true (globals-injection context)', () => {
    const code = [
      'function App(){ return <div><ThumbsUp/><BarChart/><Badge>x</Badge><CustomWidget/></div>; }',
      'export default App;',
    ].join('\n')
    expect(validateJavaScriptCode(code, { importsStripped: true }).valid).toBe(true)
  })

  // The generation path does NOT strip imports, so #76 still catches a
  // hallucinated component even when the snippet happens to have no import line.
  it('STILL flags a hallucinated component on the default (non-stripped) path', () => {
    const noImport = 'export default function App(){ return <div><Header/></div>; }'
    const r1 = validateJavaScriptCode(noImport)
    expect(r1.valid).toBe(false)
    expect(r1.error).toMatch(/Header/)

    const withImport = "import React from 'react'\nexport default function App(){ return <div><Header/></div>; }"
    const r2 = validateJavaScriptCode(withImport)
    expect(r2.valid).toBe(false)
    expect(r2.error).toMatch(/Header/)
  })
})
