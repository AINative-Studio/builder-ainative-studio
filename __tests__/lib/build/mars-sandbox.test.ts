import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

/**
 * lib/build/mars-sandbox — DigitalOcean Managed Agents (M.A.R.S.) sandbox
 * client (#875). All `fetch` calls are mocked with the EXACT request/response
 * shapes confirmed live against api.digitalocean.com via
 * `doctl harness-runtime ... --trace` during this issue's investigation
 * (2026-09-27/28) — see mars-sandbox.ts's own header doc comment for the
 * full real-call transcript these mocks mirror.
 *
 * Module-level config (DIGITALOCEAN_API_TOKEN) is captured at import time
 * (mirrors lib/git/gitea-client.ts's own configured() pattern) — every test
 * that needs a specific configured()/unconfigured() state uses
 * vi.resetModules() + a fresh dynamic import, same pattern as other
 * configured()-guarded modules in this repo's test suite.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status?: number; json?: object; arrayBuffer?: ArrayBuffer }> | { ok: boolean; status?: number; json?: object; arrayBuffer?: ArrayBuffer }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = await impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ?? {}),
      text: async () => JSON.stringify(r.json ?? {}),
      arrayBuffer: async () => r.arrayBuffer ?? new ArrayBuffer(0),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('configured()', () => {
  it('is false when DIGITALOCEAN_API_TOKEN is unset — falls back gracefully, never throws', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', '')
    vi.stubEnv('DO_API_TOKEN', '')
    const mars = await import('@/lib/build/mars-sandbox')
    expect(mars.configured()).toBe(false)
  })

  it('is true when DIGITALOCEAN_API_TOKEN is set', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    const mars = await import('@/lib/build/mars-sandbox')
    expect(mars.configured()).toBe(true)
  })
})

describe('createSandboxSession', () => {
  it('returns null when unconfigured, without making any fetch call', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', '')
    vi.stubEnv('DO_API_TOKEN', '')
    const fn = mockFetch(() => ({ ok: true }))
    const mars = await import('@/lib/build/mars-sandbox')
    const result = await mars.createSandboxSession()
    expect(result).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('posts a flat YAML manifest to POST /v2/agents/sessions and returns session_id/sandbox_id/status', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fn = mockFetch((url, init) => {
      capturedUrl = url
      capturedInit = init
      return {
        ok: true,
        json: {
          session: {
            session_id: '01a0e6ae-6130-7bae-8fa7-6828b4929df9',
            sandbox_id: '01a0e6ae-61a3-7408-ad4b-19f744a51890',
            status: 'SESSION_STATUS_READY',
          },
        },
      }
    })
    const mars = await import('@/lib/build/mars-sandbox')
    const session = await mars.createSandboxSession()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(capturedUrl).toBe('https://api.digitalocean.com/v2/agents/sessions')
    expect(capturedInit?.method).toBe('POST')
    expect((capturedInit?.headers as Record<string, string>)['Content-Type']).toBe('application/x-yaml')
    const body = String(capturedInit?.body)
    expect(body).toContain('agent: opencode')
    expect(body).toContain(`size: ${mars.MARS_SANDBOX_SIZE}`)
    expect(body).toContain('registry.npmjs.org')
    expect(session).toEqual({
      sessionId: '01a0e6ae-6130-7bae-8fa7-6828b4929df9',
      sandboxId: '01a0e6ae-61a3-7408-ad4b-19f744a51890',
      status: 'SESSION_STATUS_READY',
    })
  })

  it('throws with the real error body on a non-ok create response', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    mockFetch(() => ({
      ok: false,
      status: 400,
      json: { error: { code: 400, message: 'agentspec: custom runtime ("agent: custom") requires image' } },
    }))
    const mars = await import('@/lib/build/mars-sandbox')
    await expect(mars.createSandboxSession()).rejects.toThrow(/400/)
  })
})

describe('execInSandbox', () => {
  it('posts argv to /sandbox/exec and returns the real exit_code/stdout/duration_ms shape', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    let capturedUrl = ''
    let capturedBody: string | undefined
    mockFetch((url, init) => {
      capturedUrl = url
      capturedBody = String(init?.body)
      return { ok: true, json: { exit_code: 0, stdout: 'hello from mars v20.20.2\n', duration_ms: 227 } }
    })
    const mars = await import('@/lib/build/mars-sandbox')
    const result = await mars.execInSandbox('sess-123', ['node', '-e', 'console.log(1)'], { workdir: '/workspace/app' })
    expect(capturedUrl).toBe('https://api.digitalocean.com/v2/agents/sessions/sess-123/sandbox/exec')
    expect(JSON.parse(capturedBody!)).toEqual({ argv: ['node', '-e', 'console.log(1)'], workdir: '/workspace/app' })
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'hello from mars v20.20.2\n',
      stderr: '',
      timedOut: false,
      durationMs: 227,
    })
  })

  it('returns a non-zero exit code without throwing — a failing founder test is a real result, not a transport error', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    mockFetch(() => ({ ok: true, json: { exit_code: 1, stdout: '', stderr: 'test failed', duration_ms: 500 } }))
    const mars = await import('@/lib/build/mars-sandbox')
    const result = await mars.execInSandbox('sess-123', ['npx', 'vitest', 'run'])
    expect(result.exitCode).toBe(1)
    expect(result.timedOut).toBe(false)
  })

  it('reports timedOut:true (never throws) when the call is aborted past timeoutMs', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }))
    const mars = await import('@/lib/build/mars-sandbox')
    const result = await mars.execInSandbox('sess-123', ['sleep', '999'], { timeoutMs: 100 })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  })

  it('THROWS on a genuine transport failure distinct from a timeout', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND api.digitalocean.com') }))
    const mars = await import('@/lib/build/mars-sandbox')
    await expect(mars.execInSandbox('sess-123', ['npm', 'install'])).rejects.toThrow(/ENOTFOUND/)
  })
})

describe('uploadArchive', () => {
  it('drives the real 4-step transfer protocol: create -> part-upload-urls -> PUT presigned -> commit -> poll completed', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    const calls: string[] = []
    const fn = mockFetch((url, init) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.endsWith('/workspace/transfers') && init?.method === 'POST') {
        return { ok: true, status: 201, json: { transfer_id: 'xfer-1', status: 'pending', upload_id: 'up-1', part_size: 16_777_216 } }
      }
      if (url.endsWith('/part-upload-urls')) {
        return { ok: true, json: { part_urls: [{ part_number: 1, upload_url: 'https://ric1.digitaloceanspaces.com/presigned-put' }] } }
      }
      if (url === 'https://ric1.digitaloceanspaces.com/presigned-put') {
        return { ok: true, status: 200, json: {} }
      }
      if (url.endsWith('/commit')) {
        return { ok: true, status: 202, json: { transfer_id: 'xfer-1', status: 'in_progress' } }
      }
      if (url.endsWith('/transfers/xfer-1')) {
        return { ok: true, json: { transfer_id: 'xfer-1', status: 'completed', bytes_written: 12, sha256: 'abc' } }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const mars = await import('@/lib/build/mars-sandbox')
    await mars.uploadArchive('sess-123', 'app', Buffer.from('hello tar!!!'))
    // Real ordering: create transfer, request part urls, PUT to Spaces, commit, then poll.
    expect(calls[0]).toBe('POST https://api.digitalocean.com/v2/agents/sessions/sess-123/workspace/transfers')
    expect(calls[1]).toBe('POST https://api.digitalocean.com/v2/agents/sessions/sess-123/workspace/transfers/xfer-1/part-upload-urls')
    expect(calls[2]).toBe('PUT https://ric1.digitaloceanspaces.com/presigned-put')
    expect(calls[3]).toBe('POST https://api.digitalocean.com/v2/agents/sessions/sess-123/workspace/transfers/xfer-1/commit')
    expect(calls[4]).toBe('GET https://api.digitalocean.com/v2/agents/sessions/sess-123/workspace/transfers/xfer-1')
    expect(fn).toHaveBeenCalledTimes(5)
  })

  it('throws (never silently truncates) when the payload exceeds the server-reported single part_size', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    mockFetch((url) => {
      if (url.endsWith('/workspace/transfers')) {
        return { ok: true, status: 201, json: { transfer_id: 'xfer-1', part_size: 10 } }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const mars = await import('@/lib/build/mars-sandbox')
    await expect(mars.uploadArchive('sess-123', 'app', Buffer.from('this is way more than 10 bytes')))
      .rejects.toThrow(/exceeds single-part size/)
  })
})

describe('downloadFile', () => {
  it('drives the real 3-step download protocol: create -> poll completed (with download_url) -> GET presigned', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    const calls: string[] = []
    mockFetch((url, init) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.endsWith('/workspace/transfers')) {
        return { ok: true, status: 202, json: { transfer_id: 'xfer-2', status: 'pending' } }
      }
      if (url.endsWith('/transfers/xfer-2')) {
        return {
          ok: true,
          json: {
            transfer_id: 'xfer-2',
            status: 'completed',
            bytes_written: 4,
            download_url: 'https://ric1.digitaloceanspaces.com/presigned-get',
          },
        }
      }
      if (url === 'https://ric1.digitaloceanspaces.com/presigned-get') {
        return { ok: true, arrayBuffer: new TextEncoder().encode('{}\n').buffer }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const mars = await import('@/lib/build/mars-sandbox')
    const buf = await mars.downloadFile('sess-123', 'app/.coverage-output/coverage-summary.json')
    expect(buf?.toString('utf8')).toBe('{}\n')
    expect(calls[0]).toBe('POST https://api.digitalocean.com/v2/agents/sessions/sess-123/workspace/transfers')
    expect(calls[1]).toBe('GET https://api.digitalocean.com/v2/agents/sessions/sess-123/workspace/transfers/xfer-2')
    expect(calls[2]).toBe('GET https://ric1.digitaloceanspaces.com/presigned-get')
  })

  it('returns null (not a throw) when the transfer poll ends in status:"failed" — CONFIRMED LIVE contract for a missing workspace path', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    mockFetch((url) => {
      if (url.endsWith('/workspace/transfers')) {
        return { ok: true, status: 202, json: { transfer_id: 'xfer-3', status: 'pending' } }
      }
      if (url.endsWith('/transfers/xfer-3')) {
        return { ok: true, json: { transfer_id: 'xfer-3', status: 'failed', error_message: 'the transfer failed; retry, or contact support with transfer_id xfer-3' } }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const mars = await import('@/lib/build/mars-sandbox')
    const buf = await mars.downloadFile('sess-123', 'app/does-not-exist.json')
    expect(buf).toBeNull()
  })

  it('returns null when the create call itself 404s', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    mockFetch(() => ({ ok: false, status: 404, json: { error: { message: 'session not found' } } }))
    const mars = await import('@/lib/build/mars-sandbox')
    const buf = await mars.downloadFile('sess-gone', 'app/file.json')
    expect(buf).toBeNull()
  })
})

describe('removeSandboxSession', () => {
  it('DELETEs /v2/agents/sessions/{id} and returns true on 204', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    let capturedUrl = ''
    let capturedMethod = ''
    mockFetch((url, init) => {
      capturedUrl = url
      capturedMethod = init?.method || ''
      return { ok: true, status: 204, json: {} }
    })
    const mars = await import('@/lib/build/mars-sandbox')
    const ok = await mars.removeSandboxSession('sess-123')
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.digitalocean.com/v2/agents/sessions/sess-123')
    expect(ok).toBe(true)
  })

  it('NEVER throws, even on a thrown network error — cleanup must never mask the real coverage result', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const mars = await import('@/lib/build/mars-sandbox')
    const ok = await mars.removeSandboxSession('sess-123')
    expect(ok).toBe(false)
  })

  it('returns false on a genuine non-204/404 failure status without throwing', async () => {
    vi.stubEnv('DIGITALOCEAN_API_TOKEN', 'dop_v1_test')
    mockFetch(() => ({ ok: false, status: 500, json: {} }))
    const mars = await import('@/lib/build/mars-sandbox')
    const ok = await mars.removeSandboxSession('sess-123')
    expect(ok).toBe(false)
  })
})
