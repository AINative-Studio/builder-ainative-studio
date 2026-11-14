import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * #2022 — a syntactically truncated generated file reaches Sandpack's
 * bundler as-is and fails to parse/transpile the WHOLE compile, unlike a
 * missing import or undeclared JSX tag (already softened by
 * stubMissingLocalComponents()/the catch-all declare-inline patch). This
 * suite proves build-files.ts's new stubTruncatedFiles() render-time net
 * closes that gap for an already-live company whose durable files predate
 * (or otherwise bypassed) ready-gate.ts's generation-time
 * findTruncatedFiles() check (#2013/#2023).
 *
 * TRUNCATED_MID_JSX is a strict-parse-failure cutoff (an unterminated string
 * attribute, mid-JSX) -- findTruncatedFiles()'s SIGNAL 1, deliberately
 * chosen over its "zero export" SIGNAL 2 for the primary repro here: it has
 * a real `export default` already, so it proves this net catches content
 * no amount of export-repair (fixMissingExports/fixExportShapeMismatches,
 * which both run first and only ever add a missing `export` keyword) could
 * ever fix -- the content itself is not valid JS/TSX.
 */
const TRUNCATED_MID_JSX = `import React from 'react'

export default function ContactFormSection() {
  return (
    <div className="contact-form">
      <h2>Get in touch</h2>
      <form onSubmit={handleSubmit}>
        <input type="email" placeholder="Email`

describe('buildSandpackFiles — stubTruncatedFiles() render-time net for a truncated generated file (#2022)', () => {
  it('replaces a strict-parse-failure cutoff (unterminated JSX attribute) with a parseable inert stub instead of leaving broken content for Sandpack', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import ContactFormSection from './components/ContactFormSection'",
        'export default function App(){ return <ContactFormSection/> }',
      ].join('\n'),
      '/src/components/ContactFormSection.tsx': TRUNCATED_MID_JSX,
    })

    const stubbed = built['/src/components/ContactFormSection.tsx']
    expect(stubbed).toBeDefined()
    expect(stubbed).toContain('Auto-stubbed')
    expect(stubbed).toContain('export default function ContactFormSection')
    expect(stubbed).toContain('return null')
    // Must not contain the original broken, unparseable tail.
    expect(stubbed).not.toContain('placeholder="Email')
  })

  it('exports a named binding on the stub when another file imports the broken path by name', () => {
    // Cut off right after its own imports -- before any declaration exists
    // to claim, so the sibling-import-shape injector (#2029, which would
    // otherwise "correct" a named import into a default one once it sees a
    // real `export default` signature) has nothing to react to, and the
    // importer's genuinely-named import clause is what stubTruncatedFiles
    // itself has to satisfy.
    const TRUNCATED_IMPORTS_ONLY = "import React, { useState } from 'react'\nimport Input from './ui/Input'\n"
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { ContactFormSection } from './components/ContactFormSection'",
        'export default function App(){ return <ContactFormSection/> }',
      ].join('\n'),
      '/components/ContactFormSection.tsx': TRUNCATED_IMPORTS_ONLY,
    })

    const stubbed = built['/components/ContactFormSection.tsx']
    expect(stubbed).toContain('Auto-stubbed')
    expect(stubbed).toContain('export const ContactFormSection')
  })

  it('never touches a file that actually finished (parses cleanly, has a real export) — no false positive', () => {
    const FINISHED = `import React, { useState } from 'react'

export default function ContactFormSection() {
  const [submitted, setSubmitted] = useState(false)
  const handleSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)
  }
  return (
    <form onSubmit={handleSubmit}>
      <input type="email" placeholder="Email" />
    </form>
  )
}`
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import ContactFormSection from './components/ContactFormSection'",
        'export default function App(){ return <ContactFormSection/> }',
      ].join('\n'),
      '/components/ContactFormSection.tsx': FINISHED,
    })

    expect(built['/components/ContactFormSection.tsx']).not.toContain('Auto-stubbed')
    expect(built['/components/ContactFormSection.tsx']).toContain('setSubmitted(true)')
  })

  it('still renders a non-crashing page even when the truncated file IS the entrypoint itself', () => {
    const TRUNCATED_APP = `import React from 'react'

export default function App() {
  return (
    <div className="hero">
      <h1>Welcome to`
    const built = buildSandpackFiles({
      '/src/App.tsx': TRUNCATED_APP,
    })

    // Must not throw, and must produce a parseable, rendering (if empty) app
    // rather than propagating the broken content verbatim.
    expect(built['/src/App.tsx']).toContain('Auto-stubbed')
    expect(() => JSON.stringify(built)).not.toThrow()
  })

  it('leaves a component-shaped file with zero export alone when a real sibling file elsewhere already exports under its OWN name — only a path with no clean declaration-to-export match gets stubbed', () => {
    // A file with a real, finished, exported component must never be
    // touched even when unrelated truncation is happening elsewhere in the
    // same build — this is a basic "no false positive spills across files"
    // guard.
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import ContactFormSection from './components/ContactFormSection'",
        "import Footer from './components/Footer'",
        'export default function App(){ return (<div><ContactFormSection/><Footer/></div>) }',
      ].join('\n'),
      '/components/ContactFormSection.tsx': TRUNCATED_MID_JSX,
      '/components/Footer.tsx': 'export default function Footer(){ return <footer>real</footer> }',
    })

    expect(built['/components/Footer.tsx']).toContain('<footer>real</footer>')
    expect(built['/components/Footer.tsx']).not.toContain('Auto-stubbed')
    expect(built['/components/ContactFormSection.tsx']).toContain('Auto-stubbed')
  })
})
