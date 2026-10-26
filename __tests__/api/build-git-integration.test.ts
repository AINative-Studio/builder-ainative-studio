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

    // #1543: a new repo must land in the founder's own workspace org, not
    // the single shared platform org every company's repo was previously
    // filed under (ensureOrg(BUILDER_WORKSPACE_ID) unconditionally — see
    // lib/git/gitea-client.ts, which was always correctly generic; every
    // call site just hardcoded the shared constant instead of the real,
    // already-resolved session.workspaceId). Asserted as source-text wiring,
    // matching this file's own convention for this route (see the test
    // immediately above) — the resolution logic itself (priority order,
    // every fallback) is unit-tested directly in register-app-core.test.ts's
    // "workspace org resolution (#1543)" suite.
    it('provision route resolves the Gitea org from the real session workspaceId, not just the shared constant', async () => {
      const fs = await import('fs')
      const routeContent = fs.readFileSync(
        'app/api/build/provision/route.ts',
        'utf-8'
      )
      const gitProvisionBlock = routeContent.slice(
        routeContent.indexOf('Provision per-company Gitea repo'),
        routeContent.indexOf('Provision per-company Gitea repo') + 2000,
      )
      expect(gitProvisionBlock).toContain('(session as any)?.workspaceId')
      expect(gitProvisionBlock).toContain('BUILDER_WORKSPACE_ID')
    })

    // #1015: the commit itself moved OUT of the route body and into the shared
    // lib/build/register-app-core.ts, so the server-side reconciliation sweep
    // (for companies whose browser died before Preview.tsx ever called this
    // route) re-drives the identical logic instead of a second copy of it. The
    // wiring this test exists to protect is unchanged — it is just one level of
    // indirection away now — so assert the real chain end to end rather than a
    // single file's source text.
    it('register-app route is wired to the git commit path via the shared core module', async () => {
      const fs = await import('fs')
      const routeContent = fs.readFileSync(
        'app/api/build/register-app/route.ts',
        'utf-8'
      )
      expect(routeContent).toContain('@/lib/build/register-app-core')
      expect(routeContent).toContain('runGitCommit')
      expect(routeContent).toContain('gitCommitted')

      const coreContent = fs.readFileSync('lib/build/register-app-core.ts', 'utf-8')
      expect(coreContent).toContain('commitRegeneration')
      expect(coreContent).toContain('provisionCompanyRepo')
      expect(coreContent).toContain('@/lib/git/company-repo')
    })
  })
})
