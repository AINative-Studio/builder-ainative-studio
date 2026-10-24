import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * company-repo-355.test.ts already covers the pure helpers (formatCommitMessage,
 * buildCommitPlan, validateFileMap, toFileMapForCommit) thoroughly, per its own
 * comment: "network calls are thin + time-boxed; integration-tested against a
 * live Gitea when GITEA_* are configured." That left the network-touching
 * exported functions — provisionCompanyRepo, commitRegeneration,
 * grantHumanWrite, and the internal pushFilesToRepo they all funnel through —
 * entirely uncovered in CI (28.57% file coverage). This file mocks gitea-client,
 * app-registry, and fetch at the boundary to exercise those flows without a
 * live Gitea instance.
 */

vi.mock('@/lib/git/gitea-client', () => ({
  configured: vi.fn(),
  provisionCompanyRepo: vi.fn(),
  addCollaborator: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: vi.fn(),
  resolveAppVerified: vi.fn(),
  setAppGitRepo: vi.fn(),
  isRegistryLookupUnverified: (err: unknown) =>
    err instanceof Error && err.name === 'RegistryLookupUnverifiedError',
}))

import {
  configured,
  provisionCompanyRepo as giteaProvisionRepo,
  addCollaborator,
} from '@/lib/git/gitea-client'
import { resolveApp, resolveAppVerified, setAppGitRepo } from '@/lib/build/app-registry'
import {
  provisionCompanyRepo,
  commitRegeneration,
  grantHumanWrite,
} from '@/lib/git/company-repo'

const VALID_FILES = { 'App.tsx': 'export default function App() { return null }' }

/**
 * A CONFIRMED resolveAppVerified() answer (#1494) — a real entry, or a real
 * "no such company". commitRegeneration and grantHumanWrite read through
 * resolveAppVerified so an unverified read (`{ entry: null, verified: false }`,
 * spelled out at its use sites) is logged as itself instead of masquerading as
 * "no repo yet" / "no git org". provisionCompanyRepo's own idempotency
 * pre-flight still uses plain resolveApp (deliberately out of #1494's scope —
 * gitea-client's ensureOrg/createRepo are independently idempotent).
 */
const verifiedApp = (entry: Record<string, unknown> | null) => ({ entry, verified: true })

describe('#1201 lib/git/company-repo — network-touching functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('provisionCompanyRepo', () => {
    it('returns gitea_not_configured without any other calls when Gitea is not configured', async () => {
      vi.mocked(configured).mockReturnValue(false)

      const result = await provisionCompanyRepo({
        workspaceId: 'ws-1',
        slug: 'my-co',
        files: VALID_FILES,
      })

      expect(result).toEqual({ ok: false, reason: 'gitea_not_configured' })
      expect(resolveApp).not.toHaveBeenCalled()
    })

    it('rejects an invalid file map before touching the registry or Gitea', async () => {
      vi.mocked(configured).mockReturnValue(true)

      const result = await provisionCompanyRepo({
        workspaceId: 'ws-1',
        slug: 'my-co',
        files: { 'styles.css': 'body{}' },
      })

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('missing entry file')
      expect(resolveApp).not.toHaveBeenCalled()
    })

    it('short-circuits as already_provisioned when the app already has a gitRepoId', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveApp).mockResolvedValue({
        gitRepoId: 'repo-1',
        gitRepoUrl: 'https://gitea.example/org/repo.git',
        gitOrg: 'org-1',
      } as never)

      const result = await provisionCompanyRepo({
        workspaceId: 'ws-1',
        slug: 'my-co',
        files: VALID_FILES,
      })

      expect(result).toEqual({
        ok: true,
        gitRepoUrl: 'https://gitea.example/org/repo.git',
        gitRepoId: 'repo-1',
        gitOrg: 'org-1',
        reason: 'already_provisioned',
      })
      expect(giteaProvisionRepo).not.toHaveBeenCalled()
    })

    it('returns gitea_provision_failed when org/repo creation fails', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveApp).mockResolvedValue(null)
      vi.mocked(giteaProvisionRepo).mockResolvedValue(null)

      const result = await provisionCompanyRepo({
        workspaceId: 'ws-1',
        slug: 'my-co',
        files: VALID_FILES,
      })

      expect(result).toEqual({ ok: false, reason: 'gitea_provision_failed' })
    })

    it('provisions the repo, pushes the initial commit, and records it in the registry on full success', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveApp).mockResolvedValue(null)
      vi.mocked(giteaProvisionRepo).mockResolvedValue({
        org: { username: 'org-1' },
        repo: { name: 'my-co', id: 42 },
      } as never)
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 201 } as Response)
      vi.mocked(setAppGitRepo).mockResolvedValue(true as never)

      const result = await provisionCompanyRepo({
        workspaceId: 'ws-1',
        slug: 'my-co',
        files: VALID_FILES,
      })

      expect(result.ok).toBe(true)
      expect(result.gitRepoId).toBe('42')
      expect(result.gitOrg).toBe('org-1')
      expect(setAppGitRepo).toHaveBeenCalledWith(
        'my-co',
        expect.objectContaining({ gitRepoId: '42', gitOrg: 'org-1' })
      )
    })

    it('returns initial_commit_failed (but keeps the repo handle) when the push fails', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveApp).mockResolvedValue(null)
      vi.mocked(giteaProvisionRepo).mockResolvedValue({
        org: { username: 'org-1' },
        repo: { name: 'my-co', id: 42 },
      } as never)
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response)

      const result = await provisionCompanyRepo({
        workspaceId: 'ws-1',
        slug: 'my-co',
        files: VALID_FILES,
      })

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('initial_commit_failed')
      expect(result.gitRepoId).toBe('42')
      expect(setAppGitRepo).not.toHaveBeenCalled()
    })

    it('still returns ok:true when the push succeeds but the registry write fails (logs a warning)', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveApp).mockResolvedValue(null)
      vi.mocked(giteaProvisionRepo).mockResolvedValue({
        org: { username: 'org-1' },
        repo: { name: 'my-co', id: 42 },
      } as never)
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 201 } as Response)
      vi.mocked(setAppGitRepo).mockResolvedValue(false as never)

      const result = await provisionCompanyRepo({
        workspaceId: 'ws-1',
        slug: 'my-co',
        files: VALID_FILES,
      })

      expect(result.ok).toBe(true)
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Repo created but registry update failed')
      )
    })
  })

  describe('commitRegeneration', () => {
    it('returns false when Gitea is not configured', async () => {
      vi.mocked(configured).mockReturnValue(false)
      const result = await commitRegeneration({ slug: 'my-co', files: VALID_FILES })
      expect(result).toBe(false)
    })

    it('returns false for an invalid file map', async () => {
      vi.mocked(configured).mockReturnValue(true)
      const result = await commitRegeneration({ slug: 'my-co', files: { 'x.css': 'a' } })
      expect(result).toBe(false)
      expect(resolveAppVerified).not.toHaveBeenCalled()
    })

    it('returns false when the company is CONFIRMED to have no repo provisioned yet', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockResolvedValue(verifiedApp(null) as never)

      const result = await commitRegeneration({ slug: 'my-co', files: VALID_FILES })
      expect(result).toBe(false)
      // A CONFIRMED miss is not the unverified case and must not be logged as one.
      expect(console.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('registry lookup unverified')
      )
    })

    // -----------------------------------------------------------------------
    // #1494 — an unverified registry read is not "no repo yet"
    // -----------------------------------------------------------------------
    it('still returns false on an UNVERIFIED registry read, but logs it distinguishably from "no repo yet" (#1494)', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockResolvedValue({ entry: null, verified: false } as never)

      const result = await commitRegeneration({ slug: 'my-co', files: VALID_FILES })

      // The boolean contract is deliberately unchanged — refusing to commit is
      // the safe direction either way.
      expect(result).toBe(false)
      // Safe direction: no push attempted at all.
      expect(fetch).not.toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('registry lookup unverified')
      )
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('safe to retry'))
    })

    it('treats a rejecting registry read as unverified and never throws (#1494)', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockRejectedValue(new Error('zerodb timeout'))

      await expect(
        commitRegeneration({ slug: 'my-co', files: VALID_FILES })
      ).resolves.toBe(false)
      expect(fetch).not.toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('registry lookup unverified')
      )
    })

    it('pushes a regeneration commit when a repo already exists', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockResolvedValue(
        verifiedApp({ gitRepoId: 'repo-1', gitOrg: 'org-1' }) as never
      )
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)

      const result = await commitRegeneration({
        slug: 'my-co',
        files: VALID_FILES,
        taskLabel: 'fix-button',
      })

      expect(result).toBe(true)
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/repos/org-1/my-co/contents/App.tsx'),
        expect.anything()
      )
    })

    it('returns false when the regeneration push itself fails', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockResolvedValue(verifiedApp({ gitRepoId: 'repo-1', gitOrg: 'org-1' }) as never)
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response)

      const result = await commitRegeneration({ slug: 'my-co', files: VALID_FILES })
      expect(result).toBe(false)
    })
  })

  describe('grantHumanWrite', () => {
    it('returns false when Gitea is not configured', async () => {
      vi.mocked(configured).mockReturnValue(false)
      const result = await grantHumanWrite('my-co', 'alice')
      expect(result).toBe(false)
      expect(resolveAppVerified).not.toHaveBeenCalled()
    })

    it('returns false when the company is CONFIRMED to have no git org on record', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockResolvedValue(verifiedApp(null) as never)

      const result = await grantHumanWrite('my-co', 'alice')
      expect(result).toBe(false)
      expect(console.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('registry lookup unverified')
      )
    })

    // -----------------------------------------------------------------------
    // #1494 — never grant write access on an unknown lookup
    // -----------------------------------------------------------------------
    it('refuses (false) on an UNVERIFIED registry read and logs it distinguishably from "no git org" (#1494)', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockResolvedValue({ entry: null, verified: false } as never)

      const result = await grantHumanWrite('my-co', 'alice')

      expect(result).toBe(false)
      // The whole point of the safe direction here: no access is granted on a
      // lookup we could not complete.
      expect(addCollaborator).not.toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('registry lookup unverified')
      )
    })

    it('treats a rejecting registry read as unverified and never throws (#1494)', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockRejectedValue(new Error('zerodb timeout'))

      await expect(grantHumanWrite('my-co', 'alice')).resolves.toBe(false)
      expect(addCollaborator).not.toHaveBeenCalled()
    })

    it('delegates to addCollaborator with the default "write" permission', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockResolvedValue(verifiedApp({ gitOrg: 'org-1' }) as never)
      vi.mocked(addCollaborator).mockResolvedValue(true)

      const result = await grantHumanWrite('my-co', 'alice')

      expect(result).toBe(true)
      expect(addCollaborator).toHaveBeenCalledWith('org-1', 'my-co', 'alice', 'write')
    })

    it('passes through an explicit non-default permission', async () => {
      vi.mocked(configured).mockReturnValue(true)
      vi.mocked(resolveAppVerified).mockResolvedValue(verifiedApp({ gitOrg: 'org-1' }) as never)
      vi.mocked(addCollaborator).mockResolvedValue(true)

      await grantHumanWrite('my-co', 'alice', 'read')

      expect(addCollaborator).toHaveBeenCalledWith('org-1', 'my-co', 'alice', 'read')
    })
  })
})
