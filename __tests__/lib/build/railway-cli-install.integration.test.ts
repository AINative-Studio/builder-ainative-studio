import { describe, it, expect } from 'vitest'
import { ensureRailwayCli, isSupportedPlatform } from '@/lib/build/railway-cli-install'
import { spawnSync } from 'child_process'

/**
 * #380 — REAL end-to-end integration test: a genuine network download of the
 * actual railwayapp/cli release binary + a genuine `--version` execution. No
 * mocking — this is the one test that proves the installer really works on
 * the exact platform (CI's ubuntu-latest = linux x64) that production also
 * runs on, confirmed via `railway ssh --service builder-ainative-studio --
 * node -p "process.platform + ' ' + process.arch"` this session.
 *
 * Kept in its own file so the fast pure-logic suite
 * (railway-cli-install.test.ts) isn't held up by a real network round trip,
 * mirroring coverage-runner.test.ts/.integration.test.ts's established split.
 *
 * Skips itself (rather than failing) on a non-linux/x64 machine — local dev
 * on macOS/arm64 never needs this path (it already has `railway` on PATH via
 * an interactive login), and this module explicitly refuses to attempt a
 * download it knows won't match the platform.
 */

describe('ensureRailwayCli — real download + real execution', () => {
  it.skipIf(!isSupportedPlatform())('downloads the real railway CLI binary and it genuinely runs --version', async () => {
    const result = await ensureRailwayCli()

    expect(result.ok).toBe(true)
    expect(result.binaryPath).toBeTruthy()

    // Don't just trust the module's own internal verification — independently
    // re-run --version here via a separate spawnSync call.
    const check = spawnSync(result.binaryPath!, ['--version'], { encoding: 'utf8' })
    expect(check.status).toBe(0)
    expect(check.stdout.length).toBeGreaterThan(0)
  }, 60_000)

  it.skipIf(!isSupportedPlatform())('second call is fast (cached) — no second network round trip needed', async () => {
    const first = await ensureRailwayCli()
    expect(first.ok).toBe(true)

    const start = Date.now()
    const second = await ensureRailwayCli()
    const elapsed = Date.now() - start

    expect(second).toEqual(first)
    // A cache hit is a filesystem existsSync check, not a network call —
    // should resolve in low single-digit milliseconds, not the seconds a
    // real download takes. Generous bound to absorb CI scheduling jitter.
    expect(elapsed).toBeLessThan(2_000)
  }, 60_000)
})
