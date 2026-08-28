import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdir, writeFile, readFile, stat, rm } from 'fs/promises'
import { join } from 'path'
import {
  createWorktree,
  cleanupWorktree,
  getWorktreeFiles,
  getWorktreePath,
} from '../../lib/agent/worktree-manager'

// Use a unique test root to avoid collisions with real sessions
const TEST_SESSION_ROOT = '/tmp/builder-sessions'

describe('worktree-manager', () => {
  const testChatId = `test-wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  afterEach(async () => {
    // Clean up test worktree
    await cleanupWorktree(testChatId).catch(() => {})
  })

  describe('getWorktreePath', () => {
    it('returns a path under the sessions root', () => {
      const path = getWorktreePath('my-chat-123')
      expect(path).toBe(join(TEST_SESSION_ROOT, 'my-chat-123'))
    })

    it('sanitizes chatId to prevent path traversal', () => {
      const path = getWorktreePath('../../../etc/passwd')
      expect(path).not.toContain('..')
      expect(path).toContain('______etc_passwd')
    })

    it('throws on empty chatId', () => {
      expect(() => getWorktreePath('')).toThrow('Invalid chatId')
    })

    it('throws on dot-prefixed chatId', () => {
      expect(() => getWorktreePath('.')).toThrow('Invalid chatId')
    })
  })

  describe('createWorktree', () => {
    it('creates a directory with scaffold files', async () => {
      const path = await createWorktree(testChatId)

      expect(path).toBe(getWorktreePath(testChatId))

      // Check directory exists
      const s = await stat(path)
      expect(s.isDirectory()).toBe(true)

      // Check scaffold files
      const pkg = await readFile(join(path, 'package.json'), 'utf-8')
      const parsed = JSON.parse(pkg)
      expect(parsed.name).toBe('builder-session')
      expect(parsed.dependencies.react).toBeDefined()
      expect(parsed.dependencies['lucide-react']).toBeDefined()
      expect(parsed.dependencies.recharts).toBeDefined()

      const tsconfig = await readFile(join(path, 'tsconfig.json'), 'utf-8')
      expect(JSON.parse(tsconfig).compilerOptions.jsx).toBe('react-jsx')

      const appTsx = await readFile(join(path, 'src', 'App.tsx'), 'utf-8')
      expect(appTsx).toContain('export default function App')

      const mainTsx = await readFile(join(path, 'src', 'main.tsx'), 'utf-8')
      expect(mainTsx).toContain('createRoot')

      const indexCss = await readFile(join(path, 'src', 'index.css'), 'utf-8')
      expect(indexCss).toContain('tailwindcss')

      const indexHtml = await readFile(join(path, 'index.html'), 'utf-8')
      expect(indexHtml).toContain('id="root"')
    })

    it('is idempotent — does not overwrite existing files', async () => {
      const path = await createWorktree(testChatId)

      // Write a custom file
      await writeFile(join(path, 'src', 'App.tsx'), 'custom content', 'utf-8')

      // Create again — should not overwrite
      const path2 = await createWorktree(testChatId)
      expect(path2).toBe(path)

      const content = await readFile(join(path, 'src', 'App.tsx'), 'utf-8')
      expect(content).toBe('custom content')
    })
  })

  describe('cleanupWorktree', () => {
    it('removes the worktree directory', async () => {
      const path = await createWorktree(testChatId)
      await cleanupWorktree(testChatId)

      await expect(stat(path)).rejects.toThrow()
    })

    it('does not throw if worktree does not exist', async () => {
      await expect(cleanupWorktree('nonexistent-chat-xyz')).resolves.not.toThrow()
    })
  })

  describe('getWorktreeFiles', () => {
    it('returns scaffold files as a flat map', async () => {
      await createWorktree(testChatId)

      const files = await getWorktreeFiles(testChatId)

      expect(files['package.json']).toBeDefined()
      expect(files['tsconfig.json']).toBeDefined()
      expect(files['src/App.tsx']).toBeDefined()
      expect(files['src/main.tsx']).toBeDefined()
      expect(files['src/index.css']).toBeDefined()
      expect(files['index.html']).toBeDefined()
    })

    it('returns empty map for nonexistent worktree', async () => {
      const files = await getWorktreeFiles('does-not-exist-xyz')
      expect(files).toEqual({})
    })

    it('skips node_modules directory', async () => {
      const path = await createWorktree(testChatId)

      // Create a fake node_modules file
      const nmDir = join(path, 'node_modules', 'fake-pkg')
      await mkdir(nmDir, { recursive: true })
      await writeFile(join(nmDir, 'index.ts'), 'export default 42', 'utf-8')

      const files = await getWorktreeFiles(testChatId)
      expect(Object.keys(files).some((k) => k.includes('node_modules'))).toBe(false)
    })

    it('only includes files with readable extensions', async () => {
      const path = await createWorktree(testChatId)

      // Write files with various extensions
      await writeFile(join(path, 'data.bin'), Buffer.from([0x00, 0x01]))
      await writeFile(join(path, 'image.png'), Buffer.from([0x89, 0x50]))
      await writeFile(join(path, 'notes.md'), '# Notes', 'utf-8')
      await writeFile(join(path, 'styles.css'), 'body {}', 'utf-8')

      const files = await getWorktreeFiles(testChatId)

      expect(files['notes.md']).toBeDefined()
      expect(files['styles.css']).toBeDefined()
      expect(files['data.bin']).toBeUndefined()
      expect(files['image.png']).toBeUndefined()
    })

    it('excludes agent scratch files (.cody-plan.md, .cody-analysis.md) from the output map (#342)', async () => {
      const path = await createWorktree(testChatId)

      await writeFile(join(path, '.cody-plan.md'), '# Plan\n- [x] build it', 'utf-8')
      await writeFile(join(path, '.cody-analysis.md'), '# Analysis', 'utf-8')
      // A real markdown file must still be collected — only scratch names are excluded
      await writeFile(join(path, 'README.md'), '# App readme', 'utf-8')

      const files = await getWorktreeFiles(testChatId)

      expect(files['.cody-plan.md']).toBeUndefined()
      expect(files['.cody-analysis.md']).toBeUndefined()
      expect(files['README.md']).toBeDefined()
    })

    it('excludes agent scratch files even in subdirectories (#342)', async () => {
      const path = await createWorktree(testChatId)
      const sub = join(path, 'src')
      await writeFile(join(sub, '.cody-plan.md'), '# nested plan', 'utf-8')

      const files = await getWorktreeFiles(testChatId)
      expect(Object.keys(files).some((k) => k.endsWith('.cody-plan.md'))).toBe(false)
    })

    it('includes newly added tsx/ts files from subdirectories', async () => {
      const path = await createWorktree(testChatId)

      const componentsDir = join(path, 'src', 'components')
      await mkdir(componentsDir, { recursive: true })
      await writeFile(
        join(componentsDir, 'Counter.tsx'),
        'export function Counter() { return <div>0</div> }',
        'utf-8',
      )

      const files = await getWorktreeFiles(testChatId)
      expect(files['src/components/Counter.tsx']).toContain('Counter')
    })
  })
})
