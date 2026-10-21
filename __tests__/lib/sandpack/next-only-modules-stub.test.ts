import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Follow-up to #1151/PR #1152 (next/image, next/link): other Next.js-only
 * module specifiers (next/navigation, next/font/google|local, next/dynamic,
 * next/script) carry the identical whole-compile-crash risk when they show
 * up in an ordinary generated file, since Sandpack's preview sandbox never
 * declares `next` as a real dependency. See #1154.
 */
describe('fixJsxErrors — stubs remaining Next.js-only module specifiers (#1154)', () => {
  it('stubs next/navigation hooks to inert equivalents', () => {
    const fixed = fixJsxErrors(
      [
        "import { useRouter, usePathname, useSearchParams } from 'next/navigation'",
        'export default function Nav() {',
        '  const router = useRouter()',
        '  const pathname = usePathname()',
        '  return <button onClick={() => router.push("/about")}>{pathname}</button>',
        '}',
      ].join('\n'),
    )
    expect(fixed).not.toContain("from 'next/navigation'")
    expect(fixed).toContain('const useRouter =')
    expect(fixed).toContain('const usePathname =')
    expect(fixed).toContain('const useSearchParams =')
    // The stubbed useRouter() result must still support the shape real
    // generated code calls (router.push(...)) without throwing.
    expect(fixed).toContain('push: () => {}')
  })

  it('preserves an aliased next/navigation import under its local name', () => {
    const fixed = fixJsxErrors("import { useRouter as useAppRouter } from 'next/navigation'\nconst r = useAppRouter()")
    expect(fixed).toContain('const useAppRouter =')
    expect(fixed).not.toContain('const useRouter =')
  })

  it('stubs next/font/google factory functions to an object with className/style/variable', () => {
    const fixed = fixJsxErrors(
      [
        "import { Inter, Roboto_Mono } from 'next/font/google'",
        "const inter = Inter({ subsets: ['latin'] })",
        'export default function App() {',
        '  return <div className={inter.className}>hi</div>',
        '}',
      ].join('\n'),
    )
    expect(fixed).not.toContain("from 'next/font/google'")
    expect(fixed).toContain('const Inter =')
    expect(fixed).toContain('const Roboto_Mono =')
    expect(fixed).toContain("className: ''")
  })

  it('stubs next/font/local the same way as next/font/google', () => {
    const fixed = fixJsxErrors("import { localFont } from 'next/font/local'\nconst f = localFont({ src: './a.woff2' })")
    expect(fixed).not.toContain("from 'next/font/local'")
    expect(fixed).toContain('const localFont =')
  })

  it('stubs next/dynamic default import to an inert placeholder factory', () => {
    const fixed = fixJsxErrors(
      [
        "import dynamic from 'next/dynamic'",
        "const Heavy = dynamic(() => import('./Heavy'), { ssr: false })",
        'export default function App() { return <Heavy /> }',
      ].join('\n'),
    )
    expect(fixed).not.toContain("from 'next/dynamic'")
    expect(fixed).toContain('const dynamic =')
  })

  it('stubs next/script default import to a no-op component', () => {
    const fixed = fixJsxErrors(
      [
        "import Script from 'next/script'",
        'export default function App() { return <Script src="https://example.com/a.js" /> }',
      ].join('\n'),
    )
    expect(fixed).not.toContain("from 'next/script'")
    expect(fixed).toContain('const Script =')
  })

  it('leaves a file with no Next.js-only imports completely untouched', () => {
    const code = "import React from 'react'\nexport default function App() { return <div>hi</div> }"
    expect(fixJsxErrors(code)).toContain(code)
  })
})
