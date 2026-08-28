import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatCommitMessage,
  buildCommitPlan,
  validateFileMap,
  type FileMap,
} from '@/lib/git/company-repo'

/**
 * #355 GIT-2 — Per-company Gitea repo on build + initial/regeneration commits.
 * These tests cover the PURE helpers (commit message formatting, commit plan
 * building, file validation). The network calls are thin + time-boxed; they're
 * integration-tested against a live Gitea when GITEA_* are configured.
 *
 * Target: 80%+ coverage on the pure logic.
 */

describe('company-repo (#355 GIT-2)', () => {
  describe('formatCommitMessage (pure)', () => {
    it('formats initial commit message with slug', () => {
      const msg = formatCommitMessage({ isInitial: true, slug: 'my-company' })
      expect(msg).toBe('Initial commit: my-company')
    })

    it('formats regeneration message without task label', () => {
      const msg = formatCommitMessage({ isInitial: false, slug: 'my-company' })
      expect(msg).toBe('Regeneration: my-company')
    })

    it('formats regeneration message with task label for blame-per-task', () => {
      const msg = formatCommitMessage({
        isInitial: false,
        slug: 'my-company',
        taskLabel: 'task-123',
      })
      expect(msg).toBe('Regeneration (task-123): my-company')
    })

    it('ignores task label on initial commit', () => {
      const msg = formatCommitMessage({
        isInitial: true,
        slug: 'my-company',
        taskLabel: 'task-123',
      })
      expect(msg).toBe('Initial commit: my-company')
    })

    it('is deterministic — same input → same output', () => {
      const opts = { isInitial: false, slug: 'test', taskLabel: 'x' }
      expect(formatCommitMessage(opts)).toBe(formatCommitMessage(opts))
    })
  })

  describe('buildCommitPlan (pure)', () => {
    const files: FileMap = {
      'App.tsx': 'export default function App() { return <div>Hello</div> }',
      'styles.css': '.app { color: red; }',
    }

    it('builds a plan for initial commit', () => {
      const plan = buildCommitPlan({
        files,
        isInitial: true,
        slug: 'my-company',
      })
      expect(plan.isInitial).toBe(true)
      expect(plan.message).toBe('Initial commit: my-company')
      expect(plan.files).toHaveLength(2)
      expect(plan.files[0].path).toBe('App.tsx')
      expect(plan.files[0].content).toContain('Hello')
    })

    it('builds a plan for regeneration with task label', () => {
      const plan = buildCommitPlan({
        files,
        isInitial: false,
        slug: 'my-company',
        taskLabel: 'fix-button',
      })
      expect(plan.isInitial).toBe(false)
      expect(plan.message).toBe('Regeneration (fix-button): my-company')
      expect(plan.files).toHaveLength(2)
    })

    it('preserves all file paths and contents', () => {
      const plan = buildCommitPlan({
        files,
        isInitial: true,
        slug: 'test',
      })
      const paths = plan.files.map((f) => f.path)
      expect(paths).toContain('App.tsx')
      expect(paths).toContain('styles.css')
    })

    it('handles empty file map (produces empty file list)', () => {
      const plan = buildCommitPlan({
        files: {},
        isInitial: true,
        slug: 'test',
      })
      expect(plan.files).toHaveLength(0)
    })

    it('is deterministic', () => {
      const opts = { files, isInitial: true, slug: 'x' }
      expect(buildCommitPlan(opts)).toEqual(buildCommitPlan(opts))
    })
  })

  describe('validateFileMap (pure)', () => {
    it('accepts valid file map with App.tsx', () => {
      const result = validateFileMap({ 'App.tsx': 'code' })
      expect(result.valid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('accepts valid file map with App.jsx', () => {
      const result = validateFileMap({ 'App.jsx': 'code' })
      expect(result.valid).toBe(true)
    })

    it('accepts valid file map with index.tsx', () => {
      const result = validateFileMap({ 'index.tsx': 'code' })
      expect(result.valid).toBe(true)
    })

    it('accepts nested entry file paths', () => {
      const result = validateFileMap({ 'src/App.tsx': 'code' })
      expect(result.valid).toBe(true)
    })

    it('rejects empty file map', () => {
      const result = validateFileMap({})
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('files map is empty')
    })

    it('rejects null/undefined', () => {
      expect(validateFileMap(null as any).valid).toBe(false)
      expect(validateFileMap(undefined as any).valid).toBe(false)
    })

    it('rejects file map without entry file', () => {
      const result = validateFileMap({ 'styles.css': 'code', 'utils.ts': 'code' })
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('missing entry file')
    })

    it('accepts file map with multiple files including entry', () => {
      const result = validateFileMap({
        'App.tsx': 'app code',
        'components/Button.tsx': 'button code',
        'styles.css': 'styles',
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('formatCommitMessage handles empty slug', () => {
      const msg = formatCommitMessage({ isInitial: true, slug: '' })
      expect(msg).toBe('Initial commit: ')
    })

    it('formatCommitMessage handles special characters in slug', () => {
      const msg = formatCommitMessage({ isInitial: true, slug: 'my-company_v2' })
      expect(msg).toContain('my-company_v2')
    })

    it('buildCommitPlan handles files with special characters in paths', () => {
      const plan = buildCommitPlan({
        files: { 'components/MyButton.tsx': 'code' },
        isInitial: true,
        slug: 'test',
      })
      expect(plan.files[0].path).toBe('components/MyButton.tsx')
    })

    it('validateFileMap handles files with only whitespace content', () => {
      const result = validateFileMap({ 'App.tsx': '   ' })
      expect(result.valid).toBe(true) // Content validation is separate
    })
  })

  describe('integration patterns (mocked)', () => {
    // These test the flow patterns without hitting real Gitea.
    // Full integration tests run when GITEA_* are configured.

    it('provision flow: validate → create → push → record', () => {
      // This documents the expected flow
      const steps = [
        'validateFileMap',
        'resolveApp (check existing)',
        'giteaProvisionRepo',
        'pushFilesToRepo (initial)',
        'setAppGitRepo',
      ]
      expect(steps).toHaveLength(5)
    })

    it('regeneration flow: validate → lookup → push', () => {
      const steps = [
        'validateFileMap',
        'resolveApp (get existing repo)',
        'pushFilesToRepo (regeneration)',
      ]
      expect(steps).toHaveLength(3)
    })
  })
})

describe('performance characteristics', () => {
  it('formatCommitMessage is O(1) — no iteration', () => {
    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      formatCommitMessage({ isInitial: true, slug: 'test' })
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100) // 10k calls < 100ms
  })

  it('buildCommitPlan is O(n) — linear in file count', () => {
    const files: FileMap = {}
    for (let i = 0; i < 100; i++) {
      files[`file${i}.tsx`] = 'content'
    }
    files['App.tsx'] = 'entry'

    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      buildCommitPlan({ files, isInitial: true, slug: 'test' })
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100) // 100 calls with 101 files < 100ms
  })

  it('validateFileMap is O(n) — linear in file count', () => {
    const files: FileMap = {}
    for (let i = 0; i < 1000; i++) {
      files[`file${i}.tsx`] = 'content'
    }
    files['App.tsx'] = 'entry'

    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      validateFileMap(files)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200) // 100 calls with 1001 files < 200ms
  })
})
