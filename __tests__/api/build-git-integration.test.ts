/**
 * Unit tests for git integration modules (#349).
 *
 * Tests the PURE functions and logic that are wired into the build flow.
 * The route handlers call these modules; these tests verify the modules work.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Test the pure functions from company-repo
import {
  formatCommitMessage,
  buildCommitPlan,
  validateFileMap,
  type FileMap,
} from '@/lib/git/company-repo'

describe('Git integration modules (#349)', () => {
  describe('formatCommitMessage', () => {
    it('should format initial commit message', () => {
      const msg = formatCommitMessage({
        isInitial: true,
        slug: 'acme-corp',
      })
      expect(msg).toBe('Initial commit: acme-corp')
    })

    it('should format regeneration message without task', () => {
      const msg = formatCommitMessage({
        isInitial: false,
        slug: 'acme-corp',
      })
      expect(msg).toBe('Regeneration: acme-corp')
    })

    it('should format regeneration message with task label', () => {
      const msg = formatCommitMessage({
        isInitial: false,
        slug: 'acme-corp',
        taskLabel: 'Add dashboard',
      })
      expect(msg).toBe('Regeneration (Add dashboard): acme-corp')
    })
  })

  describe('buildCommitPlan', () => {
    const files: FileMap = {
      'App.tsx': 'export default function App() {}',
      'utils.ts': 'export const helper = () => {}',
    }

    it('should build plan for initial commit', () => {
      const plan = buildCommitPlan({
        files,
        isInitial: true,
        slug: 'test-app',
      })
      expect(plan.isInitial).toBe(true)
      expect(plan.message).toBe('Initial commit: test-app')
      expect(plan.files).toHaveLength(2)
      expect(plan.files[0].path).toBe('App.tsx')
      expect(plan.files[0].content).toBe('export default function App() {}')
    })

    it('should build plan for regeneration', () => {
      const plan = buildCommitPlan({
        files,
        isInitial: false,
        slug: 'test-app',
        taskLabel: 'Fix bug',
      })
      expect(plan.isInitial).toBe(false)
      expect(plan.message).toBe('Regeneration (Fix bug): test-app')
    })
  })

  describe('validateFileMap', () => {
    it('should accept valid file map with App.tsx', () => {
      const result = validateFileMap({
        'App.tsx': 'export default function App() {}',
      })
      expect(result.valid).toBe(true)
    })

    it('should accept valid file map with App.jsx', () => {
      const result = validateFileMap({
        'App.jsx': 'export default function App() {}',
      })
      expect(result.valid).toBe(true)
    })

    it('should accept valid file map with index.tsx', () => {
      const result = validateFileMap({
        'index.tsx': 'export default function App() {}',
      })
      expect(result.valid).toBe(true)
    })

    it('should reject empty file map', () => {
      const result = validateFileMap({})
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('files map is empty')
    })

    it('should reject file map without entry file', () => {
      const result = validateFileMap({
        'utils.ts': 'export const x = 1',
      })
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('missing entry file')
    })

    it('should reject null/undefined', () => {
      const result = validateFileMap(null as any)
      expect(result.valid).toBe(false)
    })
  })

  describe('integration wiring verification', () => {
    it('provision route imports git module', async () => {
      // Verify the import statement exists in the route
      const fs = await import('fs')
      const routeContent = fs.readFileSync(
        'app/api/build/provision/route.ts',
        'utf-8'
      )
      expect(routeContent).toContain('provisionCompanyRepo')
      expect(routeContent).toContain('@/lib/git/company-repo')
      expect(routeContent).toContain('gitProvisioned')
    })

    it('register-app route imports git module', async () => {
      const fs = await import('fs')
      const routeContent = fs.readFileSync(
        'app/api/build/register-app/route.ts',
        'utf-8'
      )
      expect(routeContent).toContain('commitRegeneration')
      expect(routeContent).toContain('provisionCompanyRepo')
      expect(routeContent).toContain('@/lib/git/company-repo')
      expect(routeContent).toContain('gitCommitted')
    })
  })
})
