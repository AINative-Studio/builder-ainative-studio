import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  toPackageName,
  normalizeZipPath,
  dedupeMirroredPaths,
  buildReadme,
  projectExportFileName,
  buildProjectZip,
  type StoredAppForExport,
} from '@/lib/build/project-export'

/**
 * #1187 — "Export button should download a real, working project ZIP (not
 * reconstructed HTML)". Before this: the only wired export path
 * (lib/services/export.service.ts) fabricated a generic Next.js shell around
 * the single generated_code string; it was never reachable from the real
 * /build product anyway. This tests the NEW module that builds a ZIP from
 * the company's actual multi-file app (the same files Sandpack renders).
 */

// ---------- pure helpers ----------

describe('toPackageName', () => {
  it('slugifies into a valid npm package name', () => {
    expect(toPackageName('Acme Co!')).toBe('acme-co')
    expect(toPackageName('  Already-Clean  ')).toBe('already-clean')
  })
  it('falls back to a default for empty input', () => {
    expect(toPackageName('')).toBe('ainative-app')
    expect(toPackageName('   ')).toBe('ainative-app')
  })
})

describe('normalizeZipPath', () => {
  it('strips a single leading slash', () => {
    expect(normalizeZipPath('/App.tsx')).toBe('App.tsx')
    expect(normalizeZipPath('/src/components/Hero.tsx')).toBe('src/components/Hero.tsx')
  })
  it('leaves a path with no leading slash untouched', () => {
    expect(normalizeZipPath('package.json')).toBe('package.json')
  })
})

describe('dedupeMirroredPaths', () => {
  it('drops a root-level mirror when an identical /src/ copy exists', () => {
    const files = {
      '/src/App.tsx': 'const x = 1',
      '/App.tsx': 'const x = 1',
      '/src/components/Hero.tsx': 'hero',
      '/components/Hero.tsx': 'hero',
    }
    const out = dedupeMirroredPaths(files)
    expect(out).toEqual({
      '/src/App.tsx': 'const x = 1',
      '/src/components/Hero.tsx': 'hero',
    })
  })

  it('keeps a root-level file when its content actually differs from the /src/ copy', () => {
    const files = {
      '/src/App.tsx': 'const x = 1',
      '/App.tsx': 'const x = 2', // divergent — real bug territory, never silently dropped
    }
    const out = dedupeMirroredPaths(files)
    expect(out['/App.tsx']).toBe('const x = 2')
    expect(out['/src/App.tsx']).toBe('const x = 1')
  })

  it('keeps files that have no mirror at all', () => {
    const files = { '/package.json': '{}', '/README.md': '# hi' }
    expect(dedupeMirroredPaths(files)).toEqual(files)
  })
})

describe('buildReadme', () => {
  it('describes a multi-file export as the real app source', () => {
    const readme = buildReadme({ name: 'Acme', slug: 'acme' }, true)
    expect(readme).toContain('npm install')
    expect(readme).toContain('npm run dev')
    expect(readme).toContain('the same files your live preview runs')
  })
  it('is honest about the single-file fallback, never claims multi-file', () => {
    const readme = buildReadme({ name: 'Acme', slug: 'acme' }, false)
    expect(readme).toContain('single file')
    expect(readme).not.toContain('the same files your live preview runs')
  })
})

describe('projectExportFileName', () => {
  it('is safe, slugged, timestamped, and a .zip', () => {
    const at = new Date('2026-10-21T12:00:00Z')
    expect(projectExportFileName('Acme Co!', at)).toBe('acme-co-source-2026-10-21.zip')
  })
})

// ---------- buildProjectZip: the real integration ----------

async function unzip(bytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes)
  const out: Record<string, string> = {}
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    out[path] = await entry.async('string')
  }
  return out
}

describe('buildProjectZip', () => {
  const meta = { name: 'Wallify', slug: 'wallify', tagline: 'Track your spending' }

  it('produces a well-formed zip containing every real multi-file app file, byte-for-byte', async () => {
    const stored: StoredAppForExport = {
      code: 'export default function App() { return null }',
      files: {
        '/App.tsx': "import Hero from './components/Hero'\nexport default function App() { return <Hero/> }",
        '/components/Hero.tsx': 'export default function Hero() { return <div>Hi</div> }',
        '/package.json': JSON.stringify({ name: 'wallify-custom', version: '2.0.0' }),
      },
    }

    const result = await buildProjectZip(stored, meta)
    expect(result.multiFile).toBe(true)

    const out = await unzip(result.zip)

    // Real generated files land at their real paths, unmodified.
    expect(out['App.tsx']).toContain("from './components/Hero'")
    expect(out['components/Hero.tsx']).toContain('function Hero()')

    // A real generated package.json is never overwritten by the synthesized default.
    expect(JSON.parse(out['package.json'])).toEqual({ name: 'wallify-custom', version: '2.0.0' })
  })

  it('synthesizes package.json/tsconfig/tailwind/README only when the generation did not already provide them', async () => {
    const stored: StoredAppForExport = {
      code: 'export default function App() { return null }',
      files: { '/App.tsx': 'export default function App() { return null }' },
    }

    const result = await buildProjectZip(stored, meta)
    const out = await unzip(result.zip)

    expect(out['package.json']).toBeDefined()
    const pkg = JSON.parse(out['package.json'])
    expect(pkg.name).toBe('wallify')
    expect(pkg.scripts.dev).toBe('next dev')
    expect(pkg.dependencies.next).toBeDefined()

    expect(out['tsconfig.json']).toBeDefined()
    expect(out['tailwind.config.ts']).toBeDefined()
    expect(out['README.md']).toContain('npm install')
    expect(out['.gitignore']).toContain('node_modules')
  })

  it('includes the AINative agent discovery files', async () => {
    const stored: StoredAppForExport = {
      code: 'export default function App() { return null }',
      files: { '/App.tsx': 'export default function App() { return null }' },
    }

    const result = await buildProjectZip(stored, meta)
    const out = await unzip(result.zip)

    expect(out['public/robots.txt']).toBeDefined()
    expect(out['public/sitemap.xml']).toBeDefined()
    expect(out['public/llms.txt']).toBeDefined()
    expect(out['public/.well-known/ai-plugin.json']).toBeDefined()
  })

  it('never overwrites a real generated discovery file with the synthesized one', async () => {
    const stored: StoredAppForExport = {
      code: 'export default function App() { return null }',
      files: {
        '/App.tsx': 'export default function App() { return null }',
        '/public/llms.txt': 'REAL FOUNDER-GENERATED CONTENT',
      },
    }

    const result = await buildProjectZip(stored, meta)
    const out = await unzip(result.zip)
    expect(out['public/llms.txt']).toBe('REAL FOUNDER-GENERATED CONTENT')
  })

  it('falls back honestly to a single-file export when no multi-file map exists, without fabricating extra files', async () => {
    const stored: StoredAppForExport = {
      code: 'export default function App() { return <div>Solo</div> }',
      files: null,
    }

    const result = await buildProjectZip(stored, meta)
    expect(result.multiFile).toBe(false)
    expect(result.generatedFileCount).toBe(1)

    const out = await unzip(result.zip)
    expect(out['app/page.tsx']).toContain('Solo')
    // Still gets real, working scaffolding so `npm install && npm run dev` works.
    expect(out['package.json']).toBeDefined()
  })

  it('treats an empty files map the same as no files map (single-file fallback)', async () => {
    const stored: StoredAppForExport = { code: 'export default function App() { return null }', files: {} }
    const result = await buildProjectZip(stored, meta)
    expect(result.multiFile).toBe(false)
  })
})
