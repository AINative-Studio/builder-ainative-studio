/**
 * Worktree Manager — Per-session isolated workspaces for headless agent builds.
 *
 * Each chat session gets its own directory under /tmp/builder-sessions/<chatId>/
 * containing a scaffold project that the Claude Code agent writes into.
 *
 * This is NOT a git worktree (no git repo dependency) — it is a plain directory
 * with a scaffold. The name "worktree" follows the PRD terminology for an
 * isolated per-session workspace.
 */

import { mkdir, rm, readdir, readFile, writeFile, stat } from 'fs/promises'
import { join, relative, extname } from 'path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSIONS_ROOT = process.env.BUILDER_SESSIONS_ROOT || '/tmp/builder-sessions'

/** File extensions to include when reading back the worktree contents. */
const READABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.html',
  '.json',
  '.md',
  '.svg',
])

/** Maximum total file size we will read back (10 MB safety limit). */
const MAX_TOTAL_READ_BYTES = 10 * 1024 * 1024

/** Maximum number of files we will read back. */
const MAX_FILE_COUNT = 500

// ---------------------------------------------------------------------------
// Scaffold templates — written into every new worktree
// ---------------------------------------------------------------------------

const SCAFFOLD_PACKAGE_JSON = JSON.stringify(
  {
    name: 'builder-session',
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
    },
    dependencies: {
      react: '^19.1.0',
      'react-dom': '^19.1.0',
      'lucide-react': '^0.540.0',
      recharts: '^2.15.0',
      'tailwind-merge': '^2.5.5',
      clsx: '^2.1.1',
    },
    devDependencies: {
      '@types/react': '^19',
      '@types/react-dom': '^19',
      '@vitejs/plugin-react': '^4.5.2',
      autoprefixer: '^10.4.21',
      postcss: '^8.5.6',
      tailwindcss: '^4',
      typescript: '^5.8.3',
      vite: '^6.3.5',
    },
  },
  null,
  2,
)

const SCAFFOLD_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      isolatedModules: true,
      moduleDetection: 'force',
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: false,
      noUnusedParameters: false,
      noFallthroughCasesInSwitch: true,
      paths: {
        '@/*': ['./src/*'],
      },
    },
    include: ['src'],
  },
  null,
  2,
)

const SCAFFOLD_APP_TSX = `import { useState } from 'react'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <h1 className="text-2xl font-bold text-gray-900">
        Builder Session
      </h1>
    </div>
  )
}
`

const SCAFFOLD_INDEX_CSS = `@import "tailwindcss";
`

const SCAFFOLD_MAIN_TSX = `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`

const SCAFFOLD_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Builder Session</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the filesystem path for a given chat session.
 */
export function getWorktreePath(chatId: string): string {
  // Sanitize chatId to prevent path traversal
  if (!chatId || chatId === '.' || chatId === '..') {
    throw new Error(`Invalid chatId: ${chatId}`)
  }
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(SESSIONS_ROOT, safe)
}

/**
 * Creates an isolated worktree directory with the scaffold project files.
 * Returns the absolute path to the created directory.
 *
 * Idempotent: if the directory already exists, returns its path without
 * overwriting existing files (the agent may have already written into it).
 */
export async function createWorktree(chatId: string): Promise<string> {
  const dir = getWorktreePath(chatId)
  const srcDir = join(dir, 'src')

  // Check if it already exists (idempotent)
  try {
    const s = await stat(dir)
    if (s.isDirectory()) {
      return dir
    }
  } catch {
    // Does not exist — create it
  }

  // Create directory structure
  await mkdir(srcDir, { recursive: true })

  // Write scaffold files
  const files: Array<[string, string]> = [
    [join(dir, 'package.json'), SCAFFOLD_PACKAGE_JSON],
    [join(dir, 'tsconfig.json'), SCAFFOLD_TSCONFIG],
    [join(dir, 'index.html'), SCAFFOLD_INDEX_HTML],
    [join(srcDir, 'App.tsx'), SCAFFOLD_APP_TSX],
    [join(srcDir, 'main.tsx'), SCAFFOLD_MAIN_TSX],
    [join(srcDir, 'index.css'), SCAFFOLD_INDEX_CSS],
  ]

  await Promise.all(files.map(([path, content]) => writeFile(path, content, 'utf-8')))

  return dir
}

/**
 * Removes the worktree directory and all its contents.
 * Safe to call even if the directory does not exist.
 */
export async function cleanupWorktree(chatId: string): Promise<void> {
  const dir = getWorktreePath(chatId)
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // Ignore errors — directory may already be gone
  }
}

/**
 * Reads all source files from the worktree and returns them as a flat
 * Record<relativePath, fileContent> map.
 *
 * Only includes files with extensions in READABLE_EXTENSIONS.
 * Respects MAX_TOTAL_READ_BYTES and MAX_FILE_COUNT safety limits.
 */
export async function getWorktreeFiles(
  chatId: string,
): Promise<Record<string, string>> {
  const dir = getWorktreePath(chatId)
  const result: Record<string, string> = {}
  let totalBytes = 0
  let fileCount = 0

  async function walk(current: string): Promise<void> {
    if (fileCount >= MAX_FILE_COUNT || totalBytes >= MAX_TOTAL_READ_BYTES) {
      return
    }

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (fileCount >= MAX_FILE_COUNT || totalBytes >= MAX_TOTAL_READ_BYTES) {
        break
      }

      const fullPath = join(current, entry.name)

      if (entry.isDirectory()) {
        // Skip node_modules, .git, dist, build directories
        if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
          continue
        }
        await walk(fullPath)
      } else if (entry.isFile()) {
        const ext = extname(entry.name)
        if (!READABLE_EXTENSIONS.has(ext)) {
          continue
        }

        try {
          const content = await readFile(fullPath, 'utf-8')
          if (totalBytes + content.length > MAX_TOTAL_READ_BYTES) {
            break
          }
          const relPath = relative(dir, fullPath)
          result[relPath] = content
          totalBytes += content.length
          fileCount++
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(dir)
  return result
}

/**
 * Lists all active session directories under SESSIONS_ROOT.
 * Useful for monitoring and cleanup.
 */
export async function listWorktrees(): Promise<string[]> {
  try {
    const entries = await readdir(SESSIONS_ROOT, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}
