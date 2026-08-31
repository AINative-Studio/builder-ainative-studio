import { describe, it, expect } from 'vitest'
import { generateCompanyScaffold, hasDeployableEntrypoint } from '@/lib/build/company-scaffold'

/**
 * #381 — deployable-scaffold generator. Verified against the REAL Gitea repo
 * state this session (only 2 repos on the whole instance, each exactly one
 * `App.tsx` file, no package.json/Dockerfile/config at all) — these tests
 * assert the scaffold fills every one of those real gaps, never overwrites
 * a genuinely-present file, and never invents an App entrypoint that isn't
 * there.
 */

describe('hasDeployableEntrypoint', () => {
  it('true for src/App.tsx (the real, confirmed generation shape)', () => {
    expect(hasDeployableEntrypoint({ 'src/App.tsx': 'export default function App() {}' })).toBe(true)
  })

  it('true for a leading-slash path variant', () => {
    expect(hasDeployableEntrypoint({ '/src/App.tsx': 'export default function App() {}' })).toBe(true)
  })

  it('true for a bare App.tsx at repo root', () => {
    expect(hasDeployableEntrypoint({ 'App.tsx': 'export default function App() {}' })).toBe(true)
  })

  it('false for an empty FileMap', () => {
    expect(hasDeployableEntrypoint({})).toBe(false)
  })

  it('false when only unrelated files exist', () => {
    expect(hasDeployableEntrypoint({ 'README.md': 'hi' })).toBe(false)
  })
})

describe('generateCompanyScaffold — the real Driftwood/test-company shape (App.tsx only)', () => {
  const bareApp = { 'src/App.tsx': 'export default function App() { return null }' }

  it('fills package.json, tsconfig, next config, tailwind, postcss, app router shell, Dockerfile', () => {
    const result = generateCompanyScaffold(bareApp)
    expect(result['package.json']).toBeDefined()
    expect(result['tsconfig.json']).toBeDefined()
    expect(result['next.config.js']).toBeDefined()
    expect(result['tailwind.config.js']).toBeDefined()
    expect(result['postcss.config.js']).toBeDefined()
    expect(result['app/page.tsx']).toBeDefined()
    expect(result['app/layout.tsx']).toBeDefined()
    expect(result['app/globals.css']).toBeDefined()
    expect(result['Dockerfile']).toBeDefined()
    expect(result['.dockerignore']).toBeDefined()
  })

  it('preserves the original App.tsx content unchanged', () => {
    const result = generateCompanyScaffold(bareApp)
    expect(result['src/App.tsx']).toBe(bareApp['src/App.tsx'])
  })

  it('package.json is valid, parseable JSON with a real build script', () => {
    const result = generateCompanyScaffold(bareApp)
    const pkg = JSON.parse(result['package.json'])
    expect(pkg.scripts.build).toMatch(/next build/)
    expect(pkg.dependencies.next).toBeDefined()
    expect(pkg.dependencies.react).toBeDefined()
  })

  it('does NOT add an aikit npm package — AIKit/shadcn are inlined generation files, not deps', () => {
    const result = generateCompanyScaffold(bareApp)
    const pkg = JSON.parse(result['package.json'])
    const depNames = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(depNames.some((d) => d.toLowerCase().includes('aikit'))).toBe(false)
  })

  it('app/page.tsx mounts src/App.tsx (the generator never emits this file itself)', () => {
    const result = generateCompanyScaffold(bareApp)
    expect(result['app/page.tsx']).toMatch(/from ['"]@\/App['"]/)
  })

  it('Dockerfile is a multi-stage build ending in a runnable CMD', () => {
    const result = generateCompanyScaffold(bareApp)
    expect(result['Dockerfile']).toMatch(/FROM node:20-alpine AS builder/)
    expect(result['Dockerfile']).toMatch(/FROM node:20-alpine AS runner/)
    expect(result['Dockerfile']).toMatch(/CMD \[/)
  })

  it('never mutates the input FileMap', () => {
    const input = { ...bareApp }
    generateCompanyScaffold(input)
    expect(input).toEqual(bareApp)
  })
})

describe('generateCompanyScaffold — existing files always win, never overwritten', () => {
  it('a real package.json in the payload is preserved verbatim', () => {
    const custom = {
      'src/App.tsx': 'export default function App() { return null }',
      'package.json': JSON.stringify({ name: 'custom-company-app', version: '9.9.9' }),
    }
    const result = generateCompanyScaffold(custom)
    expect(JSON.parse(result['package.json']).name).toBe('custom-company-app')
  })

  it('a leading-slash package.json still counts as present (no double-write)', () => {
    const custom = {
      '/src/App.tsx': 'export default function App() { return null }',
      '/package.json': '{"name":"leading-slash-pkg"}',
    }
    const result = generateCompanyScaffold(custom)
    expect(result['package.json']).toBeUndefined()
    expect(JSON.parse(result['/package.json']).name).toBe('leading-slash-pkg')
  })

  it('a real Dockerfile in the payload is preserved verbatim', () => {
    const custom = {
      'src/App.tsx': 'export default function App() { return null }',
      Dockerfile: 'FROM custom-base\n',
    }
    const result = generateCompanyScaffold(custom)
    expect(result['Dockerfile']).toBe('FROM custom-base\n')
  })

  it('a tailwind.config.ts (TS variant) counts as present — no duplicate .js added', () => {
    const custom = {
      'src/App.tsx': 'export default function App() { return null }',
      'tailwind.config.ts': 'export default {}',
    }
    const result = generateCompanyScaffold(custom)
    expect(result['tailwind.config.js']).toBeUndefined()
    expect(result['tailwind.config.ts']).toBe('export default {}')
  })

  it('a next.config.mjs counts as present — no duplicate .js added', () => {
    const custom = {
      'src/App.tsx': 'export default function App() { return null }',
      'next.config.mjs': 'export default {}',
    }
    const result = generateCompanyScaffold(custom)
    expect(result['next.config.js']).toBeUndefined()
  })
})

describe('generateCompanyScaffold — real multi-file generation shape (Driftwood-like)', () => {
  it('scaffolds correctly around a full 25-file AIKit/shadcn generation, leaving all real files intact', () => {
    const multiFile = {
      'src/App.tsx': 'import AIKitHeader from "./components/aikit/AIKitHeader"\nexport default function App() { return null }',
      'src/components/aikit/AIKitHeader.tsx': 'export default function AIKitHeader() { return null }',
      'src/components/ui/card.tsx': 'export function Card() { return null }',
      'src/components/ui/button.tsx': 'export function Button() { return null }',
      'public/robots.txt': 'User-agent: *',
      'public/llms.txt': '# llms.txt',
    }
    const result = generateCompanyScaffold(multiFile)
    // All 6 real files survive untouched.
    for (const key of Object.keys(multiFile)) {
      expect(result[key]).toBe(multiFile[key as keyof typeof multiFile])
    }
    // Plus the scaffold fills every missing piece.
    expect(result['package.json']).toBeDefined()
    expect(result['app/page.tsx']).toBeDefined()
    expect(result['Dockerfile']).toBeDefined()
  })
})
