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
})
