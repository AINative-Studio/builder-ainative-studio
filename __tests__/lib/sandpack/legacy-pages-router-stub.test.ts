import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * #1174: legacy Pages Router imports (next/router, next/head, next/document,
 * next/app) carry the same whole-compile-crash risk as #1151 (next/image,
 * next/link) and #1154 (next/navigation, next/font, next/dynamic,
 * next/script) — none of these modules exist in Sandpack's plain react-ts
 * template, so an unresolvable import anywhere in the generated files
 * silently fails the whole preview compile.
 */
describe('fixJsxErrors — stubs legacy Pages Router module specifiers (#1174)', () => {
  it('stubs next/router useRouter() to an inert shape with both methods and static fields', () => {
    const fixed = fixJsxErrors(
      [
        "import { useRouter } from 'next/router'",
        'export default function Nav() {',
        '  const router = useRouter()',
        '  return <button onClick={() => router.push("/about")}>{router.pathname}</button>',
        '}',
      ].join('\n')
    )
    expect(fixed).not.toContain("from 'next/router'")
    expect(fixed).toContain('const useRouter =')
    expect(fixed).toContain('push: () => {}')
    expect(fixed).toContain("pathname: '/'")
  })

  it('preserves an aliased next/router import under its local name', () => {
    const fixed = fixJsxErrors("import { useRouter as useLegacyRouter } from 'next/router'\nconst r = useLegacyRouter()")
    expect(fixed).toContain('const useLegacyRouter =')
    expect(fixed).not.toContain('const useRouter =')
  })

  it('stubs the deprecated default Router import from next/router', () => {
    const fixed = fixJsxErrors("import Router from 'next/router'\nRouter.push('/home')")
    expect(fixed).not.toContain("from 'next/router'")
    expect(fixed).toContain('const Router =')
  })

  it('stubs a default next/head import to a component that renders null', () => {
    const fixed = fixJsxErrors(
      [
        "import Head from 'next/head'",
        'export default function Page() {',
        '  return <Head><title>Hi</title></Head>',
        '}',
      ].join('\n')
    )
    expect(fixed).not.toContain("from 'next/head'")
    expect(fixed).toContain('const Head =')
  })

  it('stubs next/document named imports to inert passthrough/null components', () => {
    const fixed = fixJsxErrors(
      "import { Html, Head, Main, NextScript } from 'next/document'\nexport default function Document() { return <Html><Head /><body><Main /><NextScript /></body></Html> }"
    )
    expect(fixed).not.toContain("from 'next/document'")
    expect(fixed).toContain('const Html =')
    expect(fixed).toContain('const Main =')
    expect(fixed).toContain('const NextScript =')
  })

  it('drops a type-only next/app AppProps import entirely', () => {
    const fixed = fixJsxErrors(
      "import type { AppProps } from 'next/app'\nexport default function App({ Component, pageProps }: AppProps) { return <Component {...pageProps} /> }"
    )
    expect(fixed).not.toContain("from 'next/app'")
    expect(fixed).not.toContain('const AppProps')
  })

  it('leaves a file with no legacy Pages Router imports completely untouched', () => {
    const code = "import React from 'react'\nexport default function App() { return <div>hi</div> }"
    expect(fixJsxErrors(code)).toContain(code)
  })

  // #1879: next/document's stub map has 4 entries, so a commented-out
  // multi-name import could expand into several output lines — only the
  // first inherits the source line's leading `//`, resurrecting the rest as
  // real code.
  it('does not resurrect a commented-out next/document import as real code', () => {
    const code = ["// import { Html, Main } from 'next/document'", 'const x = 1'].join('\n')
    const fixed = fixJsxErrors(code)
    expect(fixed).not.toMatch(/^const Main/m)
    expect(fixed).toContain('const x = 1')
  })

  // The AppProps regex's trailing `\s*;?\n?` is meant to cleanly delete a
  // real import line without leaving a blank line behind — but `\s` matches
  // `\n`, so when this import text is inside a `//` comment instead, the
  // same greedy match swallows the comment's line-ending newline and merges
  // the REAL next line into the comment, silently disabling it.
  it('does not swallow the next real line into the comment when a commented-out next/app AppProps import precedes it', () => {
    const code = "// import type { AppProps } from 'next/app'\nexport default function App(){ return <div>hi</div> }"
    const fixed = fixJsxErrors(code)
    expect(fixed).toContain("// import type { AppProps } from 'next/app'")
    expect(fixed).not.toMatch(/^\/\/.*export default function App/m)
    expect(fixed).toMatch(/^export default function App/m)
  })
})
