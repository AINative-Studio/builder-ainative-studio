/**
 * Lazy, runtime-only Railway CLI installer (#380).
 *
 * `company-deploy.ts` (#381) shells out to the `railway` binary, but the
 * deployed `builder-ainative-studio` container does not have it — confirmed
 * via `railway ssh --service builder-ainative-studio -- which railway` →
 * `command not found`. Deliberately NOT fixed via `railway.json`/Railpack
 * build config: that config controls the WHOLE app's build, and a mistake
 * there risks breaking every deploy of builder itself, not just this one
 * feature (see #380's GitHub comments for the full reasoning).
 *
 * Instead: on first use, download the official Railway CLI release binary
 * (confirmed real asset naming via the GitHub API — railwayapp/cli publishes
 * `railway-v{VERSION}-x86_64-unknown-linux-gnu.tar.gz` containing a single
 * `railway` executable; verified this session against the actual deployed
 * container, which reports linux/x64) to a writable /tmp path, verify it
 * actually runs, and cache it for the life of the container. A redeploy
 * naturally resets /tmp, so the next first-use just re-downloads — no stale
 * state carries across deploys.
 *
 * Concurrency-safe: a promise cache means two near-simultaneous callers (e.g.
 * two paid signups deploying at once) share one in-flight install rather than
 * racing two downloads. The download itself lands at a temp filename inside
 * the same directory and is atomically renamed into place, so a reader can
 * never observe a partially-written binary.
 */

import { spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import zlib from 'zlib'

const INSTALL_DIR = path.join(os.tmpdir(), 'railway-cli')
const BINARY_PATH = path.join(INSTALL_DIR, 'railway')

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/railwayapp/cli/releases/latest'
const DOWNLOAD_TIMEOUT_MS = 60_000
const VERSION_CHECK_TIMEOUT_MS = 10_000

/** Only linux/x64 is supported — the one platform the real deployed container
 *  runs on (confirmed via SSH this session). Any other platform is a caller
 *  error (local dev never needs this — it already has `railway` on PATH via
 *  an interactive login), so this fails fast with a clear reason rather than
 *  attempting a download that would never match. PURE. */
export function isSupportedPlatform(): boolean {
  return process.platform === 'linux' && process.arch === 'x64'
}

/** Build the real GitHub release asset URL for linux x64 from a release tag
 *  (e.g. "v5.45.10"). PURE — no network. */
export function assetUrlForTag(tag: string): string {
  return `https://github.com/railwayapp/cli/releases/download/${tag}/railway-${tag}-x86_64-unknown-linux-gnu.tar.gz`
}

export interface InstallResult {
  ok: boolean
  binaryPath?: string
  reason?: string
}

let inFlight: Promise<InstallResult> | null = null

async function fetchWithTimeout(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, headers })
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve the latest release tag via the GitHub API — never hardcode a
 *  version, so this doesn't silently go stale. */
async function resolveLatestTag(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(GITHUB_LATEST_RELEASE_URL, VERSION_CHECK_TIMEOUT_MS, {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ainative-builder',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name?: string }
    return typeof data.tag_name === 'string' && data.tag_name ? data.tag_name : null
  } catch {
    return null
  }
}

/** Run the installed binary's own `--version` to prove it's genuinely
 *  executable — never trust a download that merely "landed on disk." */
function verifyBinaryRuns(binaryPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(binaryPath, ['--version'], { shell: false })
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill('SIGKILL')
        resolve(false)
      }
    }, timeoutMs)
    child.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(code === 0)
      }
    })
    child.on('error', () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(false)
      }
    })
  })
}

/**
 * Extract the single `railway` regular-file entry from a USTAR archive
 * buffer. Deliberately minimal (no external `tar` dependency) — the real
 * railwayapp/cli release asset was downloaded and inspected this session:
 * it is always exactly ONE regular-file entry named `railway`, standard
 * 512-byte USTAR headers, file data padded to a 512-byte boundary. This
 * function only needs to handle that one confirmed shape, not general tar
 * archives with directories/symlinks/multiple entries. PURE.
 */
export function extractSingleFileFromTar(tarBuf: Buffer, expectedName: string): Buffer | null {
  const HEADER_SIZE = 512
  if (tarBuf.length < HEADER_SIZE) return null

  const nameField = tarBuf.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/, '')
  if (nameField !== expectedName) return null

  const typeflag = String.fromCharCode(tarBuf[156])
  // '0' or NUL both mean "regular file" per the USTAR spec.
  if (typeflag !== '0' && typeflag !== '\0') return null

  const sizeOctal = tarBuf.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim()
  const size = parseInt(sizeOctal, 8)
  if (!Number.isFinite(size) || size <= 0) return null

  const dataStart = HEADER_SIZE
  const dataEnd = dataStart + size
  if (dataEnd > tarBuf.length) return null

  return tarBuf.subarray(dataStart, dataEnd)
}

async function downloadAndExtract(url: string, destDir: string): Promise<{ ok: boolean; reason?: string }> {
  const tmpGzPath = path.join(destDir, `railway-download-${process.pid}-${Date.now()}.tar.gz`)
  const tmpBinaryPath = path.join(destDir, `railway-download-${process.pid}-${Date.now()}.bin`)
  try {
    const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS)
    if (!res.ok || !res.body) {
      return { ok: false, reason: `download failed: HTTP ${res.status}` }
    }
    await fs.mkdir(destDir, { recursive: true })
    const nodeStream = (await import('stream')).Readable.fromWeb(res.body as import('stream/web').ReadableStream)
    await pipeline(nodeStream, createWriteStream(tmpGzPath))

    const gzStat = await fs.stat(tmpGzPath).catch(() => null)
    if (!gzStat || gzStat.size === 0) {
      return { ok: false, reason: 'downloaded archive is empty' }
    }

    const gzBuf = await fs.readFile(tmpGzPath)
    const tarBuf = zlib.gunzipSync(gzBuf)
    const binary = extractSingleFileFromTar(tarBuf, 'railway')
    if (!binary) {
      return { ok: false, reason: 'archive did not contain the expected railway binary entry' }
    }

    await fs.writeFile(tmpBinaryPath, binary)
    // Atomic rename into place — a concurrent reader can never observe a
    // partially-written binary at BINARY_PATH.
    await fs.rename(tmpBinaryPath, path.join(destDir, 'railway'))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: `download/extract error: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    await fs.rm(tmpGzPath, { force: true }).catch(() => {})
    await fs.rm(tmpBinaryPath, { force: true }).catch(() => {})
  }
}

/**
 * Ensure the `railway` CLI binary is present and runnable at a known path,
 * downloading it on first call. Concurrency-safe (shared in-flight promise).
 * Never throws — always returns a structured result, honest about failure.
 */
export async function ensureRailwayCli(): Promise<InstallResult> {
  if (existsSync(BINARY_PATH)) {
    return { ok: true, binaryPath: BINARY_PATH }
  }
  if (inFlight) return inFlight

  inFlight = (async (): Promise<InstallResult> => {
    try {
      if (!isSupportedPlatform()) {
        return { ok: false, reason: `unsupported platform: ${process.platform}/${process.arch} (expected linux/x64)` }
      }

      const tag = await resolveLatestTag()
      if (!tag) {
        return { ok: false, reason: 'could not resolve latest railway CLI release tag' }
      }

      const url = assetUrlForTag(tag)
      const dl = await downloadAndExtract(url, INSTALL_DIR)
      if (!dl.ok) {
        return { ok: false, reason: dl.reason }
      }

      await fs.chmod(BINARY_PATH, 0o755).catch(() => {})

      const runs = await verifyBinaryRuns(BINARY_PATH, VERSION_CHECK_TIMEOUT_MS)
      if (!runs) {
        await fs.rm(BINARY_PATH, { force: true }).catch(() => {})
        return { ok: false, reason: 'downloaded binary failed to execute (--version check failed)' }
      }

      return { ok: true, binaryPath: BINARY_PATH }
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
