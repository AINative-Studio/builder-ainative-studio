/**
 * Deployable project scaffold generator (#381, part of the per-company
 * dedicated-hosting pipeline).
 *
 * A company's Gitea repo holds only what Cody actually generated — verified
 * this session against the real (only) two repos on the instance: each is a
 * single `src/App.tsx`, no package.json, no Dockerfile, no Next.js router
 * shell. `railway up` needs a genuinely buildable project on disk. This
 * module fills in exactly the files a real generation is missing, reusing
 * the SAME dependency/config baseline `lib/export/project-exporter.ts`
 * already established for the ZIP-download path (kept in sync deliberately
 * — same target stack, different delivery mechanism).
 *
 * Confirmed real generation shape (lib/professional-prompt.ts's OUTPUT
 * FORMAT section + the AIKit/shadcn import paths it mandates):
 *  - `src/App.tsx` is the required main component (default export).
 *  - AIKit (`./components/aikit`) and shadcn/ui (`./components/ui/*`)
 *    primitives are generated INLINE as real files in the payload, not
 *    npm-installed — the scaffold must NOT add an "aikit" package.
 *  - The underlying libraries those inlined files themselves import
 *    (@radix-ui/*, class-variance-authority, clsx, tailwind-merge,
 *    lucide-react, recharts) ARE real npm dependencies and must be present.
 *  - Nothing in the generation output ever emits `app/page.tsx` — the
 *    Next.js App Router entry that actually mounts `src/App.tsx` — so the
 *    scaffold must supply it.
 *
 * PURE module: given a FileMap, returns a new FileMap with the gaps filled.
 * No I/O — writing to disk is the caller's job (mirrors coverage-runner.ts's
 * FileMap-in/FileMap-out convention, not a repeat of its I/O).
 */

export interface FileMap {
  [relativePath: string]: string
}

/** Same fixed dependency set project-exporter.ts already ships for the ZIP
 *  path — kept identical on purpose, not re-derived, so both delivery paths
 *  produce a project that installs the same way. */
const SCAFFOLD_PACKAGE_JSON = {
  name: 'ainative-company-app',
  version: '1.0.0',
  private: true,
  scripts: {
    build: 'next build',
    start: 'next start -p ${PORT:-3000}',
  },
  dependencies: {
    next: '15.5.14',
    react: '19.1.0',
    'react-dom': '19.1.0',
    'lucide-react': '^0.540.0',
    recharts: '^3.2.1',
    clsx: '^2.1.1',
    'tailwind-merge': '^2.5.5',
    'class-variance-authority': '^0.7.0',
    '@radix-ui/react-accordion': '^1.2.12',
    '@radix-ui/react-avatar': '^1.1.10',
    '@radix-ui/react-checkbox': '^1.3.3',
    '@radix-ui/react-collapsible': '^1.1.12',
    '@radix-ui/react-dialog': '^1.1.15',
    '@radix-ui/react-dropdown-menu': '^2.1.16',
    '@radix-ui/react-hover-card': '^1.1.15',
    '@radix-ui/react-label': '^2.1.7',
    '@radix-ui/react-popover': '^1.1.15',
    '@radix-ui/react-progress': '^1.1.7',
    '@radix-ui/react-radio-group': '^1.3.8',
    '@radix-ui/react-scroll-area': '^1.2.10',
    '@radix-ui/react-select': '^2.2.6',
    '@radix-ui/react-separator': '^1.1.7',
    '@radix-ui/react-slot': '^1.2.3',
    '@radix-ui/react-tabs': '^1.1.13',
    '@radix-ui/react-toast': '^1.2.15',
    '@radix-ui/react-tooltip': '^1.2.8',
  },
  devDependencies: {
    typescript: '^5',
    '@types/react': '^19',
    '@types/react-dom': '^19',
    tailwindcss: '^4',
    '@tailwindcss/postcss': '^4',
    postcss: '^8.4.0',
  },
} as const

const SCAFFOLD_TSCONFIG = `{
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
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
`

const SCAFFOLD_NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = { output: 'standalone' }
module.exports = nextConfig
`

const SCAFFOLD_TAILWIND_CONFIG = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}', './app/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
`

const SCAFFOLD_POSTCSS_CONFIG = `module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
`

/** Mounts the generated src/App.tsx as the App Router's index page. Never
 *  emitted by the generator (confirmed: no generation output this session
 *  contained app/page.tsx), so this is always the scaffold's job. */
const SCAFFOLD_APP_PAGE = `import App from '@/App'

export default function Page() {
  return <App />
}
`

const SCAFFOLD_APP_LAYOUT = `import './globals.css'

export const metadata = { title: 'AINative Company App' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`

const SCAFFOLD_GLOBALS_CSS = `@import "tailwindcss";
`

const SCAFFOLD_DOCKERFILE = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev=false
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
`

const SCAFFOLD_DOCKERIGNORE = `node_modules
.next
.git
*.log
`

/** Has a real file at this path, tolerating a leading slash either present or not
 *  (fetchRepoFiles/generation payloads are inconsistent about the leading '/'). */
function hasFile(files: FileMap, relPath: string): boolean {
  return Object.prototype.hasOwnProperty.call(files, relPath) ||
    Object.prototype.hasOwnProperty.call(files, `/${relPath}`)
}

/**
 * Fill in every file a company's generated payload is missing to become a
 * genuinely buildable Next.js project. PURE — never mutates the input,
 * never touches disk. Existing files always win: a company's own generated
 * config (however unlikely today) is never overwritten by the scaffold.
 */
export function generateCompanyScaffold(files: FileMap): FileMap {
  const scaffolded: FileMap = { ...files }

  if (!hasFile(files, 'package.json')) {
    scaffolded['package.json'] = JSON.stringify(SCAFFOLD_PACKAGE_JSON, null, 2)
  }
  if (!hasFile(files, 'tsconfig.json')) {
    scaffolded['tsconfig.json'] = SCAFFOLD_TSCONFIG
  }
  if (!hasFile(files, 'next.config.js') && !hasFile(files, 'next.config.mjs')) {
    scaffolded['next.config.js'] = SCAFFOLD_NEXT_CONFIG
  }
  if (!hasFile(files, 'tailwind.config.js') && !hasFile(files, 'tailwind.config.ts')) {
    scaffolded['tailwind.config.js'] = SCAFFOLD_TAILWIND_CONFIG
  }
  if (!hasFile(files, 'postcss.config.js')) {
    scaffolded['postcss.config.js'] = SCAFFOLD_POSTCSS_CONFIG
  }
  if (!hasFile(files, 'app/page.tsx')) {
    scaffolded['app/page.tsx'] = SCAFFOLD_APP_PAGE
  }
  if (!hasFile(files, 'app/layout.tsx')) {
    scaffolded['app/layout.tsx'] = SCAFFOLD_APP_LAYOUT
  }
  if (!hasFile(files, 'app/globals.css')) {
    scaffolded['app/globals.css'] = SCAFFOLD_GLOBALS_CSS
  }
  if (!hasFile(files, 'Dockerfile')) {
    scaffolded['Dockerfile'] = SCAFFOLD_DOCKERFILE
  }
  if (!hasFile(files, '.dockerignore')) {
    scaffolded['.dockerignore'] = SCAFFOLD_DOCKERIGNORE
  }
  // The Dockerfile's runner stage always `COPY --from=builder /app/public
  // ./public` (standard Next.js layout) — that COPY fails the whole build if
  // no file under public/ exists at all (confirmed empirically this session:
  // "checksum of ref ...: /app/public: not found"). Next.js itself doesn't
  // create this directory; ensure at least one file lives there so it's
  // always real on disk, whether or not the company's own repo has assets.
  const hasPublicFile = Object.keys(files).some((p) => p.replace(/^\/+/, '').startsWith('public/'))
  if (!hasPublicFile) {
    scaffolded['public/.gitkeep'] = ''
  }

  return scaffolded
}

/**
 * True when a FileMap has no `src/App.tsx` (or `App.tsx`) at all — the one
 * thing the scaffold genuinely cannot invent. A company with nothing but
 * scaffold-fillable gaps is a real, deployable app; a company with no App
 * component isn't deployable yet, regardless of scaffolding. PURE.
 */
export function hasDeployableEntrypoint(files: FileMap): boolean {
  return hasFile(files, 'src/App.tsx') || hasFile(files, 'App.tsx')
}
