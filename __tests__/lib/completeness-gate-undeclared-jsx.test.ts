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

  // Real bug class (same family as #1696/#1704's comment-blind obedience-gate
  // checks): a comment merely MENTIONING an import/definition, or mentioning a
  // JSX tag that is never actually rendered, used to satisfy the blunt
  // whole-file regexes below and either hide a real undeclared component or
  // flag one that was never really used.
  it('still flags an undeclared component when a comment merely mentions importing it', () => {
    const files = {
      '/src/App.tsx': [
        `// TODO: import Card from './components/ui/card'`,
        `export default function App(){ return <Card/> }`,
      ].join('\n'),
      '/src/components/ui/card.tsx': `export function Card(){ return <div/> }`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual(['Card'])
  })

  it('still flags an undeclared component when a comment merely mentions "function Card() {}"', () => {
    const files = {
      '/src/App.tsx': [
        `// function Card(){ return <div/> } — placeholder note, not real code`,
        `export default function App(){ return <Card/> }`,
      ].join('\n'),
      '/src/components/ui/card.tsx': `export function Card(){ return <div/> }`,
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual(['Card'])
  })

  it('does not flag a tag that only appears inside a comment as real JSX usage', () => {
    const files = {
      '/src/App.tsx': [
        `// usage example: <Ghost/> renders a placeholder`,
        `export default function App(){ return <div/> }`,
      ].join('\n'),
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual([])
  })

  // #1998 — real live repro (companies `zova`/`fieldwright`/`eave`/`mendr`):
  // shadcn-style ui/*.tsx primitives type their props as
  // `React.ButtonHTMLAttributes<HTMLButtonElement>` etc. The JSX_TAG regex
  // matches `<HTMLButtonElement>` as if it were a real JSX tag — but a
  // generic type argument is always preceded by an identifier character
  // (`Attributes<...`), which a real JSX `<` never is.
  it('does not flag a TS generic type argument as an undeclared JSX component', () => {
    const files = {
      '/src/App.tsx': `import Button from './components/ui/button'\nexport default function App(){ return <Button/> }`,
      '/src/components/ui/button.tsx': [
        `import * as React from 'react'`,
        `export function Button({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {`,
        `  return <button className={className} {...props}>{children}</button>`,
        `}`,
      ].join('\n'),
      '/src/components/ui/input.tsx': [
        `import * as React from 'react'`,
        `export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props}/> }`,
      ].join('\n'),
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual([])
  })

  it('still flags a real undeclared component on the same line as a generic type argument', () => {
    const files = {
      '/src/App.tsx': [
        `import * as React from 'react'`,
        `function useThing(ref: React.RefObject<HTMLInputElement>) { return ref }`,
        `export default function App(){ return <Ghost/> }`,
      ].join('\n'),
    }
    expect(findUndeclaredJsxComponents(files['/src/App.tsx'], files)).toEqual(['Ghost'])
  })
})
