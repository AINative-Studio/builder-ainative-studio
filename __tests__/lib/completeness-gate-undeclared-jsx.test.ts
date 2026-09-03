import { describe, it, expect } from 'vitest'
import { findUndeclaredJsxComponents } from '@/lib/build/completeness-gate'

/**
 * builder#333 follow-up — the INVERSE completeness gap.
 *
 * Repro (chatId Cnpaj8K87WqxsAj3G-WBc, app 'beacon', 2026-09-02): App.tsx used
 * <AIKitHeader>/<AIKitSidebar> without importing them from './aikit', and
 * ScheduleView.tsx used <Card>/<CardContent> without importing them from
 * './ui/card' — even though both defining files WERE fully present in the
 * payload. findMissingLocalImports can't catch this (there's no declared
 * import to check); findUndeclaredJsxComponents walks JSX USAGE instead.
 */

describe('findUndeclaredJsxComponents', () => {
  it('returns [] when every JSX tag is imported', () => {
    const files = {
      '/src/App.tsx': `import Card from './components/Card'\nexport default function App(){ return <Card/> }`,
      '/src/components/Card.tsx': `export default function Card(){ return <div/> }`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual([])
  })

  it('returns [] when the JSX tag is defined in the same file', () => {
    const files = {
      '/src/App.tsx': `function Card(){ return <div/> }\nexport default function App(){ return <Card/> }`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual([])
  })

  it('flags a JSX tag used but never imported, even though its file exists elsewhere in the payload', () => {
    const files = {
      '/src/App.tsx': `import React from 'react'\nexport default function App(){ return <Card/> }`,
      '/src/components/ui/card.tsx': `export function Card(){ return <div/> }`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual(['Card'])
  })

  it('BEACON REPRO: two components each use a tag their own file never imports', () => {
    const files = {
      '/src/App.tsx': [
        `import React from 'react'`,
        `export default function App(){ return <AIKitHeader title="x"/> }`,
      ].join('\n'),
      '/src/aikit/index.tsx': `export function AIKitHeader({ title }){ return <header>{title}</header> }`,
      '/src/components/ScheduleView.tsx': [
        `import React from 'react'`,
        `export default function ScheduleView(){ return <Card><CardContent>x</CardContent></Card> }`,
      ].join('\n'),
      '/src/components/ui/card.tsx': [
        `export function Card({ children }){ return <div>{children}</div> }`,
        `export function CardContent({ children }){ return <div>{children}</div> }`,
      ].join('\n'),
    }
    const missing = findUndeclaredJsxComponents(files['/src/App.tsx'], files)
    expect(missing).toContain('AIKitHeader')
    expect(missing).toContain('Card')
    expect(missing).toContain('CardContent')
  })

  it('does not flag lowercase intrinsic HTML tags', () => {
    const files = {
      '/src/App.tsx': `export default function App(){ return <div><span/><button/></div> }`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual([])
  })

  it('does not flag known globals (React, Fragment)', () => {
    const files = {
      '/src/App.tsx': `import React, { Fragment } from 'react'\nexport default function App(){ return <Fragment><div/></Fragment> }`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual([])
  })

  it('does not flag namespaced JSX (Charts.Line) when the namespace is imported', () => {
    const files = {
      '/src/App.tsx': `import * as Charts from './charts'\nexport default function App(){ return <Charts.Line/> }`,
      '/src/charts.tsx': `export const Line = () => <svg/>`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual([])
  })

  it('checks JSX usage in EVERY source file, not just the entry', () => {
    const files = {
      '/src/App.tsx': `import Dash from './components/Dash'\nexport default function App(){ return <Dash/> }`,
      '/src/components/Dash.tsx': `export default function Dash(){ return <Widget/> }`,
      '/src/components/Widget.tsx': `export default function Widget(){ return <div/> }`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual(['Widget'])
  })

  it('does not scan non-code files', () => {
    const files = {
      '/src/App.tsx': `export default function App(){ return <div/> }`,
      '/public/llms.txt': `<Ghost/> mentioned here`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual([])
  })

  it('returns [] without a files map (single-blob payloads get no per-file JSX-usage coverage)', () => {
    const code = `export default function App(){ return <Ghost/> }`
    expect(findUndeclaredJsxComponents(code)).toEqual([])
  })

  it('resolves a concatenated // --- FILE: --- blob into per-file boundaries', () => {
    const code = [
      `// --- FILE: src/App.tsx ---`,
      `import React from 'react'`,
      `export default function App(){ return <Card/> }`,
      `// --- FILE: src/components/ui/card.tsx ---`,
      `export function Card(){ return <div/> }`,
    ].join('\n')
    expect(findUndeclaredJsxComponents(code)).toEqual(['Card'])
  })

  it('never throws on garbage input (fail-open)', () => {
    expect(findUndeclaredJsxComponents('')).toEqual([])
    expect(findUndeclaredJsxComponents('<<<not real jsx')).toEqual([])
    expect(findUndeclaredJsxComponents(null as unknown as string)).toEqual([])
  })
})
