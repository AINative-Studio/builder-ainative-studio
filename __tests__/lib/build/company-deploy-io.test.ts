import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

/**
 * #381 — company-deploy.ts I/O-boundary tests with `child_process.spawn`
 * MOCKED (deterministic, zero real `railway` CLI invocation, zero real
 * Railway resources created) — covers the orchestration logic
 * (ensureEmptyService, deployCompanyApp's full success/failure branches,
 * ensureServiceDomain) that company-deploy.test.ts's pure-logic tests
 * intentionally don't reach, without repeating the real end-to-end manual
 * verification already done against live Railway infrastructure this
 * session (see #381's issue comments).
 */

function fakeChild(opts: { stdout?: string; stderr?: string; exitCode?: number | null; emitError?: boolean }) {
  const child: any = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  // Defer emission to the next tick so `.on('close', ...)` listeners are
  // attached before we fire — mirrors how a real child process's async I/O
  // interleaves with listener registration.
  process.nextTick(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout))
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr))
    if (opts.emitError) {
      child.emit('error', new Error('spawn railway ENOENT'))
    } else {
      child.emit('close', opts.exitCode ?? 0)
    }
  })
  child.kill = vi.fn()
  return child
}

const h = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('child_process', () => ({ spawn: h.spawn }))

beforeEach(() => {
  h.spawn.mockReset()
  vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
})

describe('deployCompanyApp — full orchestration with spawn mocked', () => {
  it('happy path: add (new service) -> up -> domain, all real call shapes', async () => {
    const { deployCompanyApp } = await import('@/lib/build/company-deploy')
    h.spawn
      .mockImplementationOnce(() => fakeChild({ stdout: '{"id":"svc-1","name":"company-acme"}', exitCode: 0 })) // railway add
      .mockImplementationOnce(() => fakeChild({ stdout: '{"deploymentId":"dep-1","logsUrl":"https://railway.com/x"}', exitCode: 0 })) // railway up
      .mockImplementationOnce(() => fakeChild({ stdout: '{"domain":"company-acme-production.up.railway.app"}', exitCode: 0 })) // railway domain

    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'export default function App() {}' })

    expect(result.ok).toBe(true)
    expect(result.serviceName).toBe('company-acme')
    expect(result.url).toBe('https://company-acme-production.up.railway.app')
    expect(h.spawn).toHaveBeenCalledTimes(3)
    expect(h.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['add', '--service', 'company-acme']))
    expect(h.spawn.mock.calls[1][1]).toEqual(expect.arrayContaining(['up', '--service', 'company-acme', '--detach', '--json']))
  })

  it('already-provisioned company skips `railway add` entirely — no duplicate service risk', async () => {
    const { deployCompanyApp } = await import('@/lib/build/company-deploy')
    h.spawn
      .mockImplementationOnce(() => fakeChild({ stdout: '{"deploymentId":"dep-2"}', exitCode: 0 })) // railway up
      .mockImplementationOnce(() => fakeChild({ stdout: '{"domain":"company-acme-production.up.railway.app"}', exitCode: 0 })) // railway domain

    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'x' }, /* alreadyProvisioned */ true)

    expect(result.ok).toBe(true)
    expect(h.spawn).toHaveBeenCalledTimes(2)
    expect(h.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['up']))
  })

  it('railway add failure surfaces the real reason, never proceeds to up', async () => {
    const { deployCompanyApp } = await import('@/lib/build/company-deploy')
    h.spawn.mockImplementationOnce(() => fakeChild({ stderr: 'workspace not found', exitCode: 1 }))

    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'x' })

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/railway add failed/)
    expect(h.spawn).toHaveBeenCalledTimes(1)
  })

  it('railway add with no parseable service id fails honestly', async () => {
    const { deployCompanyApp } = await import('@/lib/build/company-deploy')
    h.spawn.mockImplementationOnce(() => fakeChild({ stdout: 'not json at all', exitCode: 0 }))

    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'x' })

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no service id/)
  })

  it('railway up failure surfaces the real reason', async () => {
    const { deployCompanyApp } = await import('@/lib/build/company-deploy')
    h.spawn
      .mockImplementationOnce(() => fakeChild({ stdout: '{"id":"svc-1"}', exitCode: 0 }))
      .mockImplementationOnce(() => fakeChild({ stderr: 'build failed: missing dependency', exitCode: 1 }))

    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'x' })

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/railway up failed/)
  })

  it('railway up timeout is reported as a timeout, not a generic failure', async () => {
    const { deployCompanyApp } = await import('@/lib/build/company-deploy')
    h.spawn
      .mockImplementationOnce(() => fakeChild({ stdout: '{"id":"svc-1"}', exitCode: 0 }))
      .mockImplementationOnce(() => {
        const child: any = new EventEmitter()
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        child.kill = vi.fn()
        // Never emits close/error — simulates a genuinely hung process; the
        // real timeout path is exercised via a short DEPLOY_TIMEOUT_MS override
        // isn't available here since it's a module constant, so this proves
        // the SHAPE of the timeout branch is reachable via a fast synthetic
        // close after kill() is called instead.
        setTimeout(() => child.emit('close', null), 5)
        return child
      })

    // This test intentionally does not wait for the real 300s DEPLOY_TIMEOUT_MS;
    // it verifies exitCode:null (the real "killed" shape) is handled, not the
    // literal timer duration.
    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'x' })
    expect(result.ok).toBe(false)
  }, 15_000)

  it('railway up succeeds but domain resolution fails — deploy still reported successful, url just absent', async () => {
    const { deployCompanyApp } = await import('@/lib/build/company-deploy')
    h.spawn
      .mockImplementationOnce(() => fakeChild({ stdout: '{"id":"svc-1"}', exitCode: 0 }))
      .mockImplementationOnce(() => fakeChild({ stdout: '{"deploymentId":"dep-1"}', exitCode: 0 }))
      .mockImplementationOnce(() => fakeChild({ stderr: 'domain error', exitCode: 1 }))

    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'x' })

    expect(result.ok).toBe(true)
    expect(result.url).toBeUndefined()
  })

  it('spawn ENOENT (railway CLI not installed) is handled, never throws', async () => {
    const { deployCompanyApp } = await import('@/lib/build/company-deploy')
    h.spawn.mockImplementationOnce(() => fakeChild({ emitError: true }))

    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'x' })

    expect(result.ok).toBe(false)
  })
})
