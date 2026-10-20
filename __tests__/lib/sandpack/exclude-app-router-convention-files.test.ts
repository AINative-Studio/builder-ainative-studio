import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Real production bug found live (2026-10-19): tidemark (and any company
 * whose generation includes a real Next.js `/app/layout.tsx`) rendered
 * permanently unstyled in the Sandpack preview path, with zero errors
 * visible anywhere the parent page's own console could see — Sandpack's own
 * lifecycle reported `success`/`done`, so prior investigation (resource
 * contention, stale bundler cache, timeout bounds) all came up clean.
 *
 * Root cause, found by instrumenting Sandpack's own `listen()` event stream
 * (which relays the iframe's internal console via `postMessage`, invisible
 * to the parent page's normal console): a real `console`-type message
 * carried `Error: Cannot find module 'next/font/google' from
 * '/__barrel_usage_probe__.js'`. buildSandpackFiles() included
 * `/app/layout.tsx` — generated for the REAL deployed app, never the
 * preview's entry point — in the Sandpack files map with no filter at all.
 * That file imports `next/font/google`, a module that only exists in a real
 * Next.js runtime; Sandpack's plain `react-ts` template has none. Sandpack's
 * own dependency walker tried to resolve it anyway and failed, silently
 * failing the ENTIRE compile — with the failure relayed only through this
 * `console`-type lifecycle message, never as Sandpack's `error` type, which
 * is why it stayed invisible through every previous (correct) check of
 * compile success/failure.
 */
describe('buildSandpackFiles — excludes Next.js App Router convention files (#1125)', () => {
  it('excludes /app/layout.tsx — generated for the real deployed app, not the preview sandbox', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <div>hi</div> }",
      '/app/layout.tsx': `import { Inter } from 'next/font/google'\nconst inter = Inter({ subsets: ['latin'] })\nexport default function RootLayout({ children }) { return <html><body className={inter.className}>{children}</body></html> }`,
    })
    expect(built['/app/layout.tsx']).toBeUndefined()
    // Nothing referencing next/font/google should survive into the build at all.
    expect(Object.values(built).some(code => code.includes('next/font/google'))).toBe(false)
  })

  it('excludes /app/sitemap.ts and /app/robots.ts the same way', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <div>hi</div> }",
      '/app/sitemap.ts': `export default function sitemap() { return [] }`,
      '/app/robots.ts': `export default function robots() { return {} }`,
    })
    expect(built['/app/sitemap.ts']).toBeUndefined()
    expect(built['/app/robots.ts']).toBeUndefined()
  })

  it('still includes a real /app/page.tsx — only the convention files above are excluded', () => {
    const built = buildSandpackFiles({
      '/app/page.tsx': "export default function Page(){ return <div>real page</div> }",
    })
    expect(built['/app/page.tsx']).toBeDefined()
    expect(built['/app/page.tsx']).toContain('real page')
  })

  it('does not exclude a component merely named similarly (e.g. AppLayout.tsx is not layout.tsx)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <div>hi</div> }",
      '/src/components/AppLayout.tsx': "export default function AppLayout(){ return <div>layout wrapper</div> }",
    })
    expect(built['/src/components/AppLayout.tsx']).toBeDefined()
    expect(built['/components/AppLayout.tsx']).toBeDefined()
  })

  /**
   * Extended 2026-10-20 (static analysis, same root-cause class as the
   * layout.tsx bug above — see build-files.ts's own comment): sandpack-
   * bundler's collectAppBarrelUsage scans every provided file's imports,
   * reachable or not, and calling resolveAsync on an unresolvable specifier
   * anywhere silently fails the whole compile. route.ts/middleware.ts import
   * `next/server`; the image-metadata convention files import `next/og` —
   * neither exists in Sandpack's plain react-ts template.
   */
  it('excludes route.ts, middleware.ts, and instrumentation.ts (import next/server, never Sandpack-resolvable)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <div>hi</div> }",
      '/app/api/widgets/route.ts': `import { NextRequest, NextResponse } from 'next/server'\nexport async function GET(req: NextRequest) { return NextResponse.json({ ok: true }) }`,
      '/middleware.ts': `import { NextResponse } from 'next/server'\nexport function middleware() { return NextResponse.next() }`,
      '/instrumentation.ts': `export function register() {}`,
    })
    expect(built['/app/api/widgets/route.ts']).toBeUndefined()
    expect(built['/middleware.ts']).toBeUndefined()
    expect(built['/instrumentation.ts']).toBeUndefined()
    expect(Object.values(built).some(code => code.includes('next/server'))).toBe(false)
  })

  it('excludes the Next.js image-metadata convention files (import next/og, never Sandpack-resolvable)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <div>hi</div> }",
      '/app/opengraph-image.tsx': `import { ImageResponse } from 'next/og'\nexport default function OG() { return new ImageResponse(<div/>) }`,
      '/app/twitter-image.tsx': `import { ImageResponse } from 'next/og'\nexport default function Tw() { return new ImageResponse(<div/>) }`,
      '/app/icon.tsx': `import { ImageResponse } from 'next/og'\nexport default function Icon() { return new ImageResponse(<div/>) }`,
      '/app/apple-icon.tsx': `import { ImageResponse } from 'next/og'\nexport default function AppleIcon() { return new ImageResponse(<div/>) }`,
      '/app/manifest.ts': `export default function manifest() { return {} }`,
    })
    expect(built['/app/opengraph-image.tsx']).toBeUndefined()
    expect(built['/app/twitter-image.tsx']).toBeUndefined()
    expect(built['/app/icon.tsx']).toBeUndefined()
    expect(built['/app/apple-icon.tsx']).toBeUndefined()
    expect(built['/app/manifest.ts']).toBeUndefined()
    expect(Object.values(built).some(code => code.includes('next/og'))).toBe(false)
  })

  /**
   * Extended 2026-10-20 (static analysis, issue #1143 — same root-cause
   * class again): the remaining official Next.js App Router special-file
   * basenames not yet covered by the exclusion regex. None of these is ever
   * reachable from the preview's real entry ('/App.tsx') either.
   */
  it('excludes loading.tsx, error.tsx, global-error.tsx, not-found.tsx, default.tsx, and template.tsx (#1143)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <div>hi</div> }",
      '/app/loading.tsx': `export default function Loading() { return <div>Loading...</div> }`,
      '/app/error.tsx': `'use client'\nimport { useRouter } from 'next/navigation'\nexport default function Error() { const router = useRouter(); return <button onClick={() => router.refresh()}>Retry</button> }`,
      '/app/global-error.tsx': `import { Inter } from 'next/font/google'\nconst inter = Inter({ subsets: ['latin'] })\nexport default function GlobalError() { return <html><body className={inter.className}>Error</body></html> }`,
      '/app/not-found.tsx': `export default function NotFound() { return <div>404</div> }`,
      '/app/default.tsx': `export default function Default() { return null }`,
      '/app/template.tsx': `export default function Template({ children }) { return <div>{children}</div> }`,
    })
    expect(built['/app/loading.tsx']).toBeUndefined()
    expect(built['/app/error.tsx']).toBeUndefined()
    expect(built['/app/global-error.tsx']).toBeUndefined()
    expect(built['/app/not-found.tsx']).toBeUndefined()
    expect(built['/app/default.tsx']).toBeUndefined()
    expect(built['/app/template.tsx']).toBeUndefined()
    expect(Object.values(built).some(code => code.includes('next/navigation') || code.includes('next/font/google'))).toBe(false)
  })
})
