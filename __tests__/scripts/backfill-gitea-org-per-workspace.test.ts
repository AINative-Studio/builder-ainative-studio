import { describe, it, expect } from 'vitest'

import { resolveFounderWorkspaceId } from '@/scripts/backfill-gitea-org-per-workspace-logic'
import { orgNameForWorkspace } from '@/lib/git/gitea-client'

/**
 * #1545 — the Gitea org-per-workspace migration script.
 *
 * resolveFounderWorkspaceId is the one seam this script calls to turn a
 * company's ownerEmail into a real workspaceId, and it is CURRENTLY BLOCKED
 * on builder#1555 (no core-side service-callable email->workspace lookup
 * exists yet). Its only safe behavior right now is returning null
 * unconditionally for every input — main() reads that as
 * `skipped_unresolvable_workspace` and leaves the repo exactly where it is.
 *
 * This test exists specifically to catch the real footgun class this file's
 * sibling (backfill-zerodb-keys-args.test.ts, #1013) already names: a
 * "helpful" fallback that silently WIDENS what a migration acts on — here,
 * that would mean falling back to the already-proven-untrustworthy stored
 * `AppEntry.workspaceId` (the exact same #1543 bug, just on the ZeroDB-
 * registry side) instead of truly declining to act. A stub that returns
 * null unconditionally cannot silently widen anything; this test pins that
 * behavior so a careless "convenience" edit later doesn't reintroduce it.
 */
describe('resolveFounderWorkspaceId (#1545, blocked on builder#1555)', () => {
  it('returns null unconditionally — never fabricates a workspaceId from an email alone', async () => {
    expect(await resolveFounderWorkspaceId('founder@ainative.studio')).toBeNull()
    expect(await resolveFounderWorkspaceId('another-founder@example.com')).toBeNull()
  })

  it('returns null even for an empty/garbage email — never silently matches a default', async () => {
    expect(await resolveFounderWorkspaceId('')).toBeNull()
    expect(await resolveFounderWorkspaceId('not-an-email')).toBeNull()
  })
})

/**
 * Sanity check on the org-equality comparison main() uses to decide
 * `already_correct` vs `would_transfer`/`transferred`: orgNameForWorkspace
 * must be the SAME derivation on both the "current" and "resolved" sides,
 * or the comparison is meaningless. (Pure regression guard — the function
 * itself is gitea-client.ts's, already covered by its own #354 test file;
 * this just pins the specific property this script's comparison depends on.)
 */
describe('org-name derivation used for the already-correct check', () => {
  it('is deterministic and prefixed, so comparing two derived org names is a valid equality check', () => {
    expect(orgNameForWorkspace('abc-123')).toBe(orgNameForWorkspace('abc-123'))
    expect(orgNameForWorkspace('abc-123')).not.toBe(orgNameForWorkspace('xyz-999'))
    expect(orgNameForWorkspace('abc-123')).toMatch(/^ws-/)
  })
})
