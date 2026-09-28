import { describe, it, expect } from 'vitest'

/**
 * #875 — REAL end-to-end integration test against the actual DigitalOcean
 * M.A.R.S. API: creates a real session, uploads a real tiny fixture app,
 * runs a real command inside it, downloads a real file back, and tears the
 * session down for real. No mocking.
 *
 * Gated behind DIGITALOCEAN_API_TOKEN so this never runs (and never needs
 * DO credentials) in ordinary CI — mirrors coverage-runner.integration.test.ts
 * and other real-network integration tests in this repo's convention.
 *
 * Manually verified end-to-end during this issue's live investigation
 * (2026-09-27/28) via `doctl harness-runtime ... --trace` — this test
 * exercises the SAME lifecycle through this module's own fetch-based client
 * rather than through doctl, so a regression in the client code (not just
 * the API contract) fails a real assertion.
 */

const hasToken = Boolean(process.env.DIGITALOCEAN_API_TOKEN)

describe.skipIf(!hasToken)('mars-sandbox — real DigitalOcean integration', () => {
  it('creates a session, uploads a tar, execs a real command, downloads a file, and tears down — no leaked session', async () => {
    const mars = await import('@/lib/build/mars-sandbox')
    expect(mars.configured()).toBe(true)

    const session = await mars.createSandboxSession('mars-sandbox-integration-test')
    expect(session).not.toBeNull()
    const sessionId = session!.sessionId

    try {
      // Build a tiny real tar (package.json only) the same way coverage-runner does.
      const archiver = (await import('archiver')).default
      const tarBytes: Buffer = await new Promise((resolve, reject) => {
        const archive = archiver('tar')
        const chunks: Buffer[] = []
        archive.on('data', (c: Buffer) => chunks.push(c))
        archive.on('error', reject)
        archive.on('end', () => resolve(Buffer.concat(chunks)))
        archive.append(Buffer.from(JSON.stringify({ name: 'probe', private: true })), { name: 'package.json' })
        archive.finalize()
      })

      await mars.uploadArchive(sessionId, 'app', tarBytes)

      const exec = await mars.execInSandbox(sessionId, ['node', '-e', 'console.log(1+1)'], {
        workdir: '/workspace/app',
        timeoutMs: 30_000,
      })
      expect(exec.exitCode).toBe(0)
      expect(exec.stdout.trim()).toBe('2')
      expect(exec.timedOut).toBe(false)

      const downloaded = await mars.downloadFile(sessionId, 'app/package.json')
      expect(downloaded).not.toBeNull()
      const parsed = JSON.parse(downloaded!.toString('utf8'))
      expect(parsed.name).toBe('probe')

      // Confirm the "not found" contract for real (not just mocked).
      const missing = await mars.downloadFile(sessionId, 'app/definitely-does-not-exist.json')
      expect(missing).toBeNull()
    } finally {
      const removed = await mars.removeSandboxSession(sessionId)
      expect(removed).toBe(true)
    }
  }, 120_000)
})
