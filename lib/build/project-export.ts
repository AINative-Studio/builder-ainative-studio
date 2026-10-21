/**
 * Project export (#1187) — download a real, working project ZIP.
 *
 * Before this: the only "export" wiring in the live `/build` product was
 * `/api/build/export` (#63.C), which downloads a company's ZeroDB DATA (JSON/
 * CSV) — never the app's own source code. The code-export machinery that
 * *did* exist (`lib/services/export.service.ts`, `/api/export/[id]`,
 * `components/export-button.tsx`) was never reachable from `/build` at all —
 * it's wired only into the dead legacy `/chats` + `/home` chat UI — and even
 * there it fabricated a generic Next.js shell around the single-file
 * `generated_code` string (`generateAppPage()` literally does
 * `export default function Home() { return (${generation.generated_code}) }`),
 * not the founder's actual multi-file app. A founder clicking "Export" on a
 * real multi-file company got a reconstructed approximation, never their own
 * files.
 *
 * This module builds the ZIP from the SAME real files a company's live
 * preview is built from: `resolveStoredApp(chatId).files` — the exact
 * multi-file map `lib/sandpack/build-files.ts` (`buildSandpackFiles`) feeds
 * to the real Sandpack preview (#291). When a company has no multi-file map
 * (older single-file apps, Babel preview path) we fall back to wrapping the
 * single `code` string — honestly labelled, never claimed as multi-file.
 *
 * Real project scaffolding (package.json / tsconfig.json / tailwind.config.ts
 * / README.md) is synthesized ONLY for files the generation didn't already
 * produce — a real generated file always wins over a synthesized default.
 * AINative agent discovery files (robots.txt / sitemap.xml / llms.txt /
 * ai-plugin.json) are added the same way, via the same
 * `generateAINativeFileSet()` already used for the live `/build/{slug}/...`
 * discovery routes (`lib/build/discovery-files.ts`) — not a second,
 * divergent implementation.
 */

import JSZip from 'jszip'
import { generateAINativeFileSet } from '@/lib/ainative-file-generator'

/** What the caller already knows about the company, used to personalize scaffolding. */
export interface ProjectExportMeta {
  name: string
  slug: string
  tagline?: string
  domain?: string
}

/** Input to buildProjectZip: the real stored app (code + optional multi-file map). */
export interface StoredAppForExport {
  code: string
  files?: Record<string, string> | null
}

export interface ProjectExportResult {
  /** The built ZIP, ready to stream as an attachment. */
  zip: Uint8Array
  /** Whether the export used the real multi-file map (true) or the single-file fallback (false). */
  multiFile: boolean
  /** Number of real generated files included (excludes synthesized scaffolding). */
  generatedFileCount: number
}

const DEFAULT_PACKAGE_JSON = (projectName: string) => ({
  name: projectName,
  version: '0.1.0',
  private: true,
  scripts: {
    dev: 'next dev',
    build: 'next build',
    start: 'next start',
    lint: 'next lint',
  },
  dependencies: {
    next: '^15.0.0',
    react: '^18.3.0',
    'react-dom': '^18.3.0',
    'lucide-react': '^0.400.0',
    clsx: '^2.1.0',
    'tailwind-merge': '^2.2.0',
  },
  devDependencies: {
    typescript: '^5.4.0',
    '@types/node': '^20.0.0',
    '@types/react': '^18.3.0',
    '@types/react-dom': '^18.3.0',
    tailwindcss: '^3.4.0',
    postcss: '^8.4.0',
    autoprefixer: '^10.4.0',
  },
})

const DEFAULT_NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {}
module.exports = nextConfig
`

const DEFAULT_TAILWIND_CONFIG = `import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './src/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config
`

const DEFAULT_POSTCSS_CONFIG = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`

const DEFAULT_TSCONFIG = `{
  "compilerOptions": {
    "target": "es2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
`

const DEFAULT_GITIGNORE = `node_modules/
.next/
.env
.env.local
*.log
`

/** Slugify a name into a valid npm package name. Pure. */
export function toPackageName(name: string): string {
  const safe = String(name || 'ainative-app')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || 'ainative-app'
}

/** Strip a leading slash so a Sandpack-style path ("/App.tsx") becomes a real file path ("App.tsx"). Pure. */
export function normalizeZipPath(path: string): string {
  let p = String(path || '')
  if (p.startsWith('/')) p = p.slice(1)
  return p
}

/**
 * Real multi-file apps store duplicate entries for the same logical file
 * (lib/sandpack/build-files.ts mirrors /src/X <-> /X so same-level relative
 * imports always resolve inside Sandpack's bundler). A real on-disk project
 * must not contain both copies — that would be confusing and is not what
 * `npm run dev` expects. Prefer the /src/... copy when both exist (the
 * canonical generated location); otherwise keep whichever one is present.
 */
export function dedupeMirroredPaths(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const keys = Object.keys(files)
  const srcKeys = new Set(keys.filter((k) => k.startsWith('/src/')))
  for (const key of keys) {
    if (key.startsWith('/src/')) {
      out[key] = files[key]
      continue
    }
    const mirrored = `/src${key.startsWith('/') ? key : `/${key}`}`
    if (srcKeys.has(mirrored) && files[mirrored] === files[key]) {
      // Identical mirrored copy already included via its /src/ path — skip the root dup.
      continue
    }
    out[key] = files[key]
  }
  return out
}

/** Does this generated path look like a real app source/config file worth exporting as-is? Pure. */
function isRealExportableFile(path: string): boolean {
  // Everything the generation produced is real founder-owned content —
  // nothing is excluded here. (Sandpack-only concerns like skipping
  // Next.js App Router convention files are a PREVIEW-sandbox limitation,
  // not a reason to omit them from the actual exported project, which DOES
  // run a real Next.js runtime.)
  return path.length > 0
}

/**
 * Build a real, working project ZIP from a company's actual stored app.
 *
 * Multi-file path (preferred): every real generated file is written at its
 * real path, byte-for-byte. Single-file fallback: the one generated_code
 * string is wrapped into a minimal real Next.js page — the most honest
 * representation possible when no multi-file map was ever produced.
 */
export async function buildProjectZip(
  stored: StoredAppForExport,
  meta: ProjectExportMeta,
): Promise<ProjectExportResult> {
  const zip = new JSZip()
  const projectName = toPackageName(meta.slug || meta.name)

  const multiFile = Boolean(stored.files && Object.keys(stored.files).length > 0)
  const generatedFiles: Record<string, string> = {}

  if (multiFile) {
    const deduped = dedupeMirroredPaths(stored.files as Record<string, string>)
    for (const [rawPath, content] of Object.entries(deduped)) {
      if (!isRealExportableFile(rawPath)) continue
      const zipPath = normalizeZipPath(rawPath)
      if (!zipPath) continue
      generatedFiles[zipPath] = content
    }
  } else {
    // Single-file fallback: the only real content available is the one
    // generated_code string. Represent it honestly as the app's entry page.
    generatedFiles['app/page.tsx'] = stored.code || '// No generated content available.\n'
  }

  for (const [path, content] of Object.entries(generatedFiles)) {
    zip.file(path, content)
  }

  const hasPackageJson = 'package.json' in generatedFiles
  if (!hasPackageJson) {
    zip.file('package.json', JSON.stringify(DEFAULT_PACKAGE_JSON(projectName), null, 2))
  }
  if (!('tsconfig.json' in generatedFiles)) {
    zip.file('tsconfig.json', DEFAULT_TSCONFIG)
  }
  if (!('next.config.js' in generatedFiles) && !('next.config.ts' in generatedFiles) && !('next.config.mjs' in generatedFiles)) {
    zip.file('next.config.js', DEFAULT_NEXT_CONFIG)
  }
  if (
    !('tailwind.config.ts' in generatedFiles) &&
    !('tailwind.config.js' in generatedFiles)
  ) {
    zip.file('tailwind.config.ts', DEFAULT_TAILWIND_CONFIG)
  }
  if (!('postcss.config.js' in generatedFiles) && !('postcss.config.mjs' in generatedFiles)) {
    zip.file('postcss.config.js', DEFAULT_POSTCSS_CONFIG)
  }
  if (!('.gitignore' in generatedFiles)) {
    zip.file('.gitignore', DEFAULT_GITIGNORE)
  }

  // AINative agent discovery files — only fill gaps the generation didn't
  // already produce (multi-file apps commonly already have these via
  // lib/multi-file-parser.ts; never overwrite a real generated file).
  const ainativeFiles = generateAINativeFileSet(meta.tagline || meta.name || meta.slug, stored.code || '', {
    name: meta.name,
    description: meta.tagline,
    domain: meta.domain,
  })
  for (const [path, content] of Object.entries(ainativeFiles)) {
    if (path in generatedFiles) continue
    zip.file(path, content)
  }

  if (!('README.md' in generatedFiles)) {
    zip.file('README.md', buildReadme(meta, multiFile))
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return {
    zip: bytes,
    multiFile,
    generatedFileCount: Object.keys(generatedFiles).length,
  }
}

/** The README's content. Pure (no I/O) so it's independently unit-testable. */
export function buildReadme(meta: ProjectExportMeta, multiFile: boolean): string {
  const name = meta.name || meta.slug || 'Your App'
  const note = multiFile
    ? 'This is the real, complete source for your app — the same files your live preview runs.'
    : "This app was generated as a single file; it's included here as the app's entry page."
  return `# ${name}

Built with [AINative Builder](https://builder.ainative.studio). ${note}

## Getting started

\`\`\`bash
npm install
npm run dev
\`\`\`

Then open [http://localhost:3000](http://localhost:3000).

## What's included

- Your real generated application source
- A working \`package.json\` with the dependencies it needs
- Next.js, TypeScript, and Tailwind config
- AINative agent-discovery files (\`robots.txt\`, \`sitemap.xml\`, \`llms.txt\`, \`.well-known/ai-plugin.json\`)

You own 100% of this code — run it locally, modify it, deploy it anywhere, or move off AINative entirely. No lock-in.
`
}

/** A safe, timestamped download filename for a project export ZIP. Pure. */
export function projectExportFileName(slug: string, at: Date = new Date()): string {
  const safe = toPackageName(slug)
  const stamp = at.toISOString().slice(0, 10)
  return `${safe}-source-${stamp}.zip`
}
