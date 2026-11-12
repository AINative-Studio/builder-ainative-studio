import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * #1151: next/image and next/link don't exist in Sandpack's plain react-ts
 * preview template (no `next` dependency is ever declared — see
 * components/chat/sandpack-preview.tsx's customSetup.dependencies), but the
 * generation model reaches for both routinely since the real deployed app
 * target is Next.js. An unresolvable import anywhere in the generated files
 * silently fails sandpack-bundler's whole-app compile, same mechanism as
 * #1124/#1125's layout.tsx/next-font bug — just via an ordinary component
 * file this time, not an excludable App Router convention file.
 */
describe('buildSandpackFiles — next/image and next/link stubbed inline (#1151)', () => {
  it('stubs a default next/image import as an inline <img> passthrough', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `import Image from 'next/image'\nexport default function App(){ return <Image src="/hero.png" alt="Hero" width={800} height={400} /> }`,
    })
    const app = built['/App.tsx']
    expect(app).not.toContain("from 'next/image'")
    expect(app).toContain('const Image =')
    expect(app).toContain('<img')
  })

  it('stubs a default next/link import as an inline <a> passthrough', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `import Link from 'next/link'\nexport default function App(){ return <Link href="/pricing">Pricing</Link> }`,
    })
    const app = built['/App.tsx']
    expect(app).not.toContain("from 'next/link'")
    expect(app).toContain('const Link =')
    expect(app).toContain('<a href=')
  })

  it('unwraps a next/image static-import object src ({ src: "..." }) to a plain string', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `import Image from 'next/image'\nexport default function App(){ return <Image src={logo} alt="Logo" /> }`,
    })
    expect(built['/App.tsx']).toContain("typeof src === 'object'")
  })

  it('handles an aliased default import name for both modules', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `import NextImage from 'next/image'\nimport NextLink from 'next/link'\nexport default function App(){ return <div><NextImage src="/a.png" alt="a" /><NextLink href="/b">b</NextLink></div> }`,
    })
    const app = built['/App.tsx']
    expect(app).toContain('const NextImage =')
    expect(app).toContain('const NextLink =')
  })

  it('leaves a file with no next/image or next/link import untouched', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `export default function App(){ return <div>hi</div> }`,
    })
    expect(built['/App.tsx']).not.toContain('const Image =')
    expect(built['/App.tsx']).not.toContain('const Link =')
  })

  it('drops next/image-only props (fill, priority) that are invalid plain <img> DOM attributes', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `import Image from 'next/image'\nexport default function App(){ return <Image src="/hero.png" alt="Hero" fill priority /> }`,
    })
    expect(built['/App.tsx']).toContain('fill, priority')
  })

  // #1887: a commented-out example import with trailing same-line comment
  // text must not be rewritten — the real import below it should be stubbed
  // instead, and the comment line must stay a single, intact comment.
  it('leaves a commented-out next/image import with trailing text untouched and stubs the real import below it', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `// import NextImg from 'next/image'  (old approach)\nimport Image from 'next/image'\nexport default function App(){ return <Image src="/a.png" alt="a" /> }`,
    })
    const app = built['/App.tsx']
    expect(app).toContain("// import NextImg from 'next/image'  (old approach)")
    expect(app).not.toMatch(/^\(old approach\)/m)
    expect(app).toContain('const Image =')
  })

  it('leaves a commented-out next/link import with trailing text untouched and stubs the real import below it', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `// import OldLink from 'next/link'  (deprecated)\nimport Link from 'next/link'\nexport default function App(){ return <Link href="/pricing">Pricing</Link> }`,
    })
    const app = built['/App.tsx']
    expect(app).toContain("// import OldLink from 'next/link'  (deprecated)")
    expect(app).not.toMatch(/^\(deprecated\)/m)
    expect(app).toContain('const Link =')
  })

  it('does not stub a next/image import mentioned only inside a comment', () => {
    const built = buildSandpackFiles({
      '/App.tsx': `// import NextImg from 'next/image'\nexport default function App(){ return <div>hi</div> }`,
    })
    const app = built['/App.tsx']
    expect(app).not.toContain('const NextImg =')
  })
})
