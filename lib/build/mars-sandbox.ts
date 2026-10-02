/**
 * DigitalOcean Managed Agents (M.A.R.S.) sandbox client — #875.
 *
 * A thin, typed client over the REAL M.A.R.S. REST API
 * (api.digitalocean.com/v2/agents/sessions/...), confirmed LIVE against this
 * account on 2026-09-27/28 via `doctl harness-runtime ... --trace` (doctl is
 * a convenience wrapper — this module talks to the same endpoints directly
 * with `fetch`, since coverage-runner.ts runs inside the Next.js server
 * process, not a shell that can invoke the `doctl` binary).
 *
 * CONFIRMED LIVE, EXACT SHAPES (do not trust DO's docs pages over this —
 * these were captured directly, the same way gitea-client.ts's own doc
 * comments record real, checked API quirks):
 *
 *   Create:  POST /v2/agents/sessions
 *            Content-Type: application/x-yaml
 *            body = a FLAT manifest, e.g.:
 *              name: <name>
 *              agent: opencode
 *              size: mars-1vcpu-1gb
 *              egress:
 *                allow_hosts: [registry.npmjs.org, api.npmjs.org]
 *            -> 200 { "session": { "session_id", "name", "agent_kind",
 *               "status", "sandbox_id", "created_at", "config_id", ... } }
 *
 *            Sizing note: the top-level field is `size` (confirmed live,
 *            2026-09-27 — accepted with a 200). Two other guesses were
 *            confirmed WRONG live: `sandbox: {sizeSlug: ...}` 400s with
 *            "field \"sandbox\" is not part of the flat format"; `template:
 *            {sizeSlug: ...}` 400s because `template` is a STRING field (the
 *            name/ID of a team custom template, unrelated to sizing) not an
 *            object — do not resurrect either of those shapes.
 *
 *            IMPORTANT — session_id vs sandbox_id: every other call below
 *            (exec/upload/download/remove) is keyed on `session_id`, NOT
 *            `sandbox_id`. These are two different UUIDs in the response and
 *            are easy to confuse (confirmed the hard way during live
 *            investigation — using sandbox_id anywhere else 404s with
 *            "session not found").
 *
 *   Exec:    POST /v2/agents/sessions/{session_id}/sandbox/exec
 *            body: { "argv": ["cmd", "arg1", ...] }
 *            -> 200 { "exit_code": number, "stdout": string, "stderr"?:
 *               string, "duration_ms": number }
 *            No shell — argv is executed directly (mirrors the existing
 *            local runCommand's `shell: false`, so no quoting/injection
 *            surface changes). No persistent shell between calls — no `cd`,
 *            use an absolute workdir per call (this client always does).
 *
 *   Upload (a REAL S3-multipart-style flow, NOT a single call — confirmed
 *   live via `doctl harness-runtime upload --trace`, and materially more
 *   involved than DO's own `--help` text implies):
 *     1. POST /v2/agents/sessions/{session_id}/workspace/transfers
 *        body: { "direction":"upload", "path":<dest under /workspace>,
 *          "is_archive":bool, "size_bytes":number, "sha256":<hex> }
 *        -> 201 { "transfer_id", "status":"pending", "upload_id",
 *           "part_size":16777216, "expires_at" }
 *     2. POST .../transfers/{transfer_id}/part-upload-urls
 *        body: { "part_numbers": [1, 2, ...] }  (one part per part_size
 *        chunk of the payload — a small tar like coverage-runner's FileMaps
 *        is always a single part)
 *        -> 200 { "part_urls": [{ "part_number", "upload_url" (a presigned
 *           DigitalOcean Spaces/S3 PUT URL, ~1h expiry) }] }
 *     3. PUT the raw bytes of each part directly to its presigned
 *        `upload_url` (NOT back to api.digitalocean.com — this hits
 *        *.digitaloceanspaces.com with no additional auth headers, the
 *        signature is embedded in the URL's query string).
 *     4. POST .../transfers/{transfer_id}/commit  body: { "sha256" }
 *        -> 202 { "transfer_id", "status":"in_progress", "size_bytes" }
 *     5. Poll GET .../transfers/{transfer_id} until
 *        { "status":"completed", "bytes_written", "sha256" } (observed
 *        ~1-2s for a few KB archive).
 *
 *   Download (symmetric, also NOT a single call):
 *     1. POST /v2/agents/sessions/{session_id}/workspace/transfers
 *        body: { "direction":"download", "path":<src under /workspace> }
 *        -> 202 { "transfer_id", "status":"pending" }
 *     2. Poll GET .../transfers/{transfer_id} until
 *        { "status":"completed", "bytes_written", "sha256",
 *          "download_url": <presigned GET URL>, "expires_at" }
 *     3. GET the presigned `download_url` directly (again, Spaces/S3, no
 *        extra auth) to fetch the raw bytes.
 *
 *   Remove:  DELETE /v2/agents/sessions/{session_id} -> 204 No Content
 *
 * WHY `agent: opencode`, not a bare/no-agent sandbox: `agent: none` is
 * rejected by the API ("not a known adapter") despite `doctl`'s own --help
 * text implying a `--agent none` bare-sandbox mode exists — that mode is not
 * actually reachable through the current manifest schema (confirmed live,
 * 2026-09-27). `agent: custom` IS a real bare-sandbox adapter, but requires
 * an `image` field naming a team custom OCI template (`doctl harness-runtime
 * template create`) — real infra to build and maintain that this issue's
 * scope does not justify. `agent: claude-code` requires ANTHROPIC_API_KEY
 * just to START the session, even with no prompt ever sent — an unnecessary
 * paid-LLM dependency for what is just `npm install && vitest`.
 * `agent: opencode` is the one harness that creates a real, working sandbox
 * with NO secret required as long as no `--prompt` is sent (confirmed live:
 * a real opencode session went SESSION_STATUS_READY with zero secrets
 * configured) — so it is used here purely as a sandbox host; its own agent
 * loop is never invoked.
 *
 * Mirrors this repo's house style (lib/git/gitea-client.ts): config captured
 * at module load from env, a `configured()` guard so an unconfigured deploy
 * degrades gracefully (never throws), every network call time-boxed.
 */

const DO_API_TOKEN = process.env.DIGITALOCEAN_API_TOKEN || process.env.DO_API_TOKEN || ''
const DO_API_BASE = 'https://api.digitalocean.com/v2/agents/sessions'

/** Sandbox size for coverage runs — smallest available (confirmed via
 *  `doctl harness-runtime sizes list`: mars-1vcpu-1gb/2vcpu-2gb/2vcpu-4gb/
 *  4vcpu-8gb/16vcpu-32gb). A founder's own test suite (npm install + vitest
 *  on a small generated app) does not need more than the smallest tier. */
export const MARS_SANDBOX_SIZE = 'mars-1vcpu-1gb'

/** Hosts a coverage run's `npm install` + test execution genuinely needs.
 *  Nothing else — this is the egress allowlist baked onto every session
 *  this module creates, so a founder's cloned/uploaded test code (and any
 *  postinstall hook) cannot reach arbitrary network destinations. */
export const MARS_EGRESS_ALLOWLIST = ['registry.npmjs.org', 'api.npmjs.org']

/** Per-call HTTP timeout for session lifecycle calls (create/remove/transfer
 *  metadata) — NOT the coverage test-run timeout itself, which is passed
 *  explicitly to execInSandbox via its own `timeoutMs`. */
const HTTP_TIMEOUT_MS = 30_000

/** Real, observed session-creation latency for the `opencode` harness on the
 *  smallest sandbox size (2026-09-27/28 live trials): ~14s. Bounded higher
 *  here to absorb normal variance without being unbounded. */
const CREATE_WAIT_TIMEOUT_MS = 90_000

export function configured(): boolean {
  return Boolean(DO_API_TOKEN)
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${DO_API_TOKEN}`,
    Accept: 'application/json',
    ...extra,
  }
}

export interface MarsSession {
  sessionId: string
  sandboxId: string
  status: string
}

export interface MarsExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

/**
 * Create a fresh, isolated M.A.R.S. sandbox session with the egress
 * allowlist applied. Returns null when unconfigured (caller falls back to
 * local spawn) — THROWS on a genuine API failure so a real outage is visible
 * to the resolver rather than silently mis-attributed to "no coverage."
 */
export async function createSandboxSession(
  namePrefix = 'builder-coverage',
): Promise<MarsSession | null> {
  if (!configured()) return null

  const name = `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const manifest = [
    `name: ${name}`,
    'agent: opencode',
    `size: ${MARS_SANDBOX_SIZE}`,
    'egress:',
    '  allow_hosts:',
    ...MARS_EGRESS_ALLOWLIST.map((h) => `    - ${h}`),
  ].join('\n')

  const res = await fetch(DO_API_BASE, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/x-yaml' }),
    body: manifest,
    signal: AbortSignal.timeout(CREATE_WAIT_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`mars createSandboxSession failed: ${res.status} ${text}`.slice(0, 500))
  }
  const body = (await res.json()) as { session?: { session_id: string; sandbox_id: string; status: string } }
  const session = body?.session
  if (!session?.session_id) {
    throw new Error('mars createSandboxSession: response missing session_id')
  }
  return { sessionId: session.session_id, sandboxId: session.sandbox_id, status: session.status }
}

/** How long to poll a transfer before giving up — a small (few-hundred-KB)
 *  generated-app tar should complete in 1-2s (observed live); bounded much
 *  higher to absorb real network variance without hanging forever. */
const TRANSFER_POLL_TIMEOUT_MS = 60_000
const TRANSFER_POLL_INTERVAL_MS = 500

interface TransferStatus {
  transfer_id: string
  status: string
  bytes_written?: number
  sha256?: string
  download_url?: string
  error_message?: string
}

async function pollTransfer(sessionId: string, transferId: string): Promise<TransferStatus> {
  const deadline = Date.now() + TRANSFER_POLL_TIMEOUT_MS
  for (;;) {
    const res = await fetch(
      `${DO_API_BASE}/${encodeURIComponent(sessionId)}/workspace/transfers/${encodeURIComponent(transferId)}`,
      { method: 'GET', headers: headers(), signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`mars pollTransfer failed: ${res.status} ${text}`.slice(0, 500))
    }
    const body = (await res.json()) as TransferStatus
    if (body.status === 'completed') return body
    if (body.status === 'failed' || body.status === 'expired') {
      // CONFIRMED LIVE (2026-09-27): a download of a path that does not
      // exist in the workspace surfaces here as status:"failed" with a
      // generic error_message — NOT as a 404 on the create call. Callers
      // distinguishing "not found" from "real transport failure" (see
      // downloadFile below) rely on this poll throwing rather than the
      // create call returning 404.
      throw new Error(
        `mars transfer ${transferId} ended in status "${body.status}"` +
        (body.error_message ? `: ${body.error_message}` : ''),
      )
    }
    if (Date.now() > deadline) {
      throw new Error(`mars transfer ${transferId} did not complete within ${TRANSFER_POLL_TIMEOUT_MS}ms (last status: ${body.status})`)
    }
    await new Promise((r) => setTimeout(r, TRANSFER_POLL_INTERVAL_MS))
  }
}

/**
 * Upload a FileMap into a session's /workspace, as a single tar archive
 * extracted server-side (mirrors `doctl harness-runtime upload --archive`).
 * Real, confirmed protocol (see this module's header doc comment): create
 * the transfer, request a presigned part-upload URL, PUT the bytes directly
 * to DigitalOcean Spaces, commit, then poll until `completed`. Building the
 * tar itself is the caller's job (coverage-runner already writes a FileMap
 * to a local temp dir for the existing local-spawn path — the sandboxed path
 * tars that same directory) — this function is a pure "bytes in, workspace
 * path out" interface with no opinion on tar construction.
 *
 * A generated app's coverage-run payload is always small (source files, no
 * node_modules) — this deliberately does NOT implement true multi-part
 * upload (chunking across multiple `part_numbers`) since every real call
 * site fits in a single part; it requests exactly one part and throws if the
 * payload would need more than one (a hard ceiling that surfaces loudly
 * rather than silently truncating).
 */
export async function uploadArchive(
  sessionId: string,
  destPath: string,
  tarBytes: Buffer,
): Promise<void> {
  const crypto = await import('crypto')
  const sha256 = crypto.createHash('sha256').update(tarBytes).digest('hex')

  const createRes = await fetch(`${DO_API_BASE}/${encodeURIComponent(sessionId)}/workspace/transfers`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      direction: 'upload',
      path: destPath,
      is_archive: true,
      size_bytes: tarBytes.byteLength,
      sha256,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '')
    throw new Error(`mars uploadArchive (create transfer) failed: ${createRes.status} ${text}`.slice(0, 500))
  }
  const created = (await createRes.json()) as { transfer_id: string; part_size: number }
  const partSize = created.part_size || tarBytes.byteLength
  if (tarBytes.byteLength > partSize) {
    throw new Error(
      `mars uploadArchive: payload ${tarBytes.byteLength} bytes exceeds single-part size ${partSize} — ` +
      `multi-part chunking is not implemented (no real call site has needed it)`,
    )
  }

  const urlsRes = await fetch(
    `${DO_API_BASE}/${encodeURIComponent(sessionId)}/workspace/transfers/${encodeURIComponent(created.transfer_id)}/part-upload-urls`,
    {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ part_numbers: [1] }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    },
  )
  if (!urlsRes.ok) {
    const text = await urlsRes.text().catch(() => '')
    throw new Error(`mars uploadArchive (part-upload-urls) failed: ${urlsRes.status} ${text}`.slice(0, 500))
  }
  const urlsBody = (await urlsRes.json()) as { part_urls: { part_number: number; upload_url: string }[] }
  const uploadUrl = urlsBody.part_urls?.[0]?.upload_url
  if (!uploadUrl) throw new Error('mars uploadArchive: response missing part upload_url')

  // Presigned URL — no Authorization header, the signature is in the query
  // string. This request goes directly to DigitalOcean Spaces, not the
  // agents API.
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(tarBytes),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (!putRes.ok) {
    throw new Error(`mars uploadArchive (PUT to presigned URL) failed: ${putRes.status}`)
  }

  const commitRes = await fetch(
    `${DO_API_BASE}/${encodeURIComponent(sessionId)}/workspace/transfers/${encodeURIComponent(created.transfer_id)}/commit`,
    {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sha256 }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    },
  )
  if (!commitRes.ok) {
    const text = await commitRes.text().catch(() => '')
    throw new Error(`mars uploadArchive (commit) failed: ${commitRes.status} ${text}`.slice(0, 500))
  }

  await pollTransfer(sessionId, created.transfer_id)
}

/**
 * Run one command in a session's sandbox (no shell — argv executed
 * directly, same `shell:false` contract as the existing local runCommand).
 * Never throws on a command failure/timeout — mirrors runCommand's own
 * contract of resolving with exitCode/timedOut so callers can build an
 * honest CoverageResult either way. THROWS only on a genuine transport/API
 * failure (session gone, auth failure) — a real outage, distinct from "the
 * founder's test command failed."
 */
export async function execInSandbox(
  sessionId: string,
  argv: string[],
  opts: { workdir?: string; timeoutMs?: number } = {},
): Promise<MarsExecResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const body: Record<string, unknown> = { argv }
  if (opts.workdir) body.workdir = opts.workdir

  let res: Response
  try {
    res = await fetch(`${DO_API_BASE}/${encodeURIComponent(sessionId)}/sandbox/exec`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      // +10s over the caller's own timeout: the SERVER enforces the guest
      // process bound (there is no server-side --timeout param confirmed
      // live — coverage-runner.ts's own timeoutMs is enforced client-side
      // here instead), so give the HTTP call itself a little headroom over
      // that so a slow-but-finishing command isn't cut off by OUR transport
      // timeout before the guest's own result comes back.
      signal: AbortSignal.timeout(timeoutMs + 10_000),
    })
  } catch (e) {
    // AbortError from our own timeout = the run hung past timeoutMs — an
    // honest timeout, not an API outage. Any other thrown error (network,
    // DNS) IS a genuine transport failure.
    if (e instanceof Error && e.name === 'AbortError') {
      return { exitCode: null, stdout: '', stderr: '', timedOut: true, durationMs: timeoutMs }
    }
    throw e
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`mars execInSandbox failed: ${res.status} ${text}`.slice(0, 500))
  }
  const result = (await res.json()) as { exit_code: number | null; stdout?: string; stderr?: string; duration_ms?: number }
  return {
    exitCode: result.exit_code,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut: false,
    durationMs: result.duration_ms ?? 0,
  }
}

/**
 * Download one file from a session's /workspace as raw bytes, or null if it
 * doesn't exist (a test run that never produced coverage-summary.json is a
 * normal, expected outcome — not an error). Real, confirmed protocol
 * (see this module's header doc comment): create the download transfer,
 * poll until `completed` (the completed response carries a presigned GET
 * `download_url`), then GET that URL directly. THROWS on a genuine
 * transport failure.
 */
export async function downloadFile(sessionId: string, srcPath: string): Promise<Buffer | null> {
  const createRes = await fetch(`${DO_API_BASE}/${encodeURIComponent(sessionId)}/workspace/transfers`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ direction: 'download', path: srcPath }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (createRes.status === 404) return null
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '')
    throw new Error(`mars downloadFile (create transfer) failed: ${createRes.status} ${text}`.slice(0, 500))
  }
  const created = (await createRes.json()) as { transfer_id: string }

  let final: TransferStatus
  try {
    final = await pollTransfer(sessionId, created.transfer_id)
  } catch (e) {
    // A download transfer for a file that genuinely doesn't exist in the
    // workspace fails server-side (observed as a "failed" status, not a
    // 404 on create) — treat that as "not found," not a transport error.
    return null
  }
  if (!final.download_url) return null

  const getRes = await fetch(final.download_url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
  if (!getRes.ok) {
    throw new Error(`mars downloadFile (GET presigned URL) failed: ${getRes.status}`)
  }
  const buf = Buffer.from(await getRes.arrayBuffer())
  return buf.byteLength ? buf : null
}

/**
 * Tear down a session. NEVER throws — this is called from a `finally` block
 * that must never mask the real coverage result, and a leaked session (worst
 * case: a small ongoing cost) is a far better failure mode than crashing the
 * resolver on cleanup. Returns true on a confirmed 204, false otherwise
 * (already gone, transient failure) so callers can log if they care.
 */
export async function removeSandboxSession(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${DO_API_BASE}/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: headers(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    return res.status === 204 || res.status === 404
  } catch {
    return false
  }
}
