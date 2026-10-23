import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const h = vi.hoisted(() => ({
  captureCommand: vi.fn(),
  getEvidenceCollectorService: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('@/lib/services/evidence-collector.service', () => ({
  getEvidenceCollectorService: h.getEvidenceCollectorService,
}))

vi.mock('child_process', () => ({
  spawn: h.spawn,
}))

import { CommandInterceptor, createCommandInterceptor, executeAndCapture } from '@/lib/utils/command-interceptor'

function makeFakeChild() {
  const child: any = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

// executeWithoutCapture does `await import('child_process')` before calling
// spawn, so callers must let that microtask resolve before emitting events
// on the fake child - otherwise the emit fires before any listener attaches.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

describe('lib/utils/command-interceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getEvidenceCollectorService.mockReturnValue({ captureCommand: h.captureCommand })
  })

  describe('analyzeCommand()', () => {
    it('detects a vitest run command as a test-run', () => {
      const interceptor = new CommandInterceptor('user-1')
      const result = interceptor.analyzeCommand('npx vitest run __tests__/foo.test.ts')
      expect(result).toMatchObject({ type: 'test-run', shouldCapture: true })
    })

    it('detects vitest --coverage as coverage', () => {
      const interceptor = new CommandInterceptor('user-1')
      const result = interceptor.analyzeCommand('npx vitest --coverage')
      expect(result.type).toBe('coverage')
      expect(result.shouldCapture).toBe(true)
    })

    it('detects npm run build as a build command', () => {
      const interceptor = new CommandInterceptor('user-1')
      const result = interceptor.analyzeCommand('npm run build')
      expect(result.type).toBe('build')
    })

    it('detects tsc as type-check', () => {
      const interceptor = new CommandInterceptor('user-1')
      const result = interceptor.analyzeCommand('npx tsc --noEmit')
      expect(result.type).toBe('type-check')
    })

    it('detects eslint as lint', () => {
      const interceptor = new CommandInterceptor('user-1')
      const result = interceptor.analyzeCommand('npx eslint .')
      expect(result.type).toBe('lint')
    })

    it('detects railway up as a deployment', () => {
      const interceptor = new CommandInterceptor('user-1')
      const result = interceptor.analyzeCommand('railway up --service builder')
      expect(result.type).toBe('deployment')
    })

    it('returns shouldCapture: false and type command-execution for an unmatched command', () => {
      const interceptor = new CommandInterceptor('user-1')
      const result = interceptor.analyzeCommand('ls -la')
      expect(result).toEqual({
        original: 'ls -la',
        type: 'command-execution',
        shouldCapture: false,
      })
    })

    it('includes the matched pattern source in metadata', () => {
      const interceptor = new CommandInterceptor('user-1')
      const result = interceptor.analyzeCommand('pytest --cov')
      expect(result.metadata?.pattern).toBeTruthy()
    })
  })

  describe('executeWithCapture()', () => {
    it('delegates to the evidence collector when the command matches a capture pattern', async () => {
      h.captureCommand.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
      const interceptor = new CommandInterceptor('user-1')

      const result = await interceptor.executeWithCapture('npx vitest run')

      expect(h.captureCommand).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'test-run', command: 'npx vitest run', captureOutput: true, captureArtifacts: true }),
      )
      expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 })
    })

    it('executes without capture for a non-matching command and falls through to spawn', async () => {
      const child = makeFakeChild()
      h.spawn.mockReturnValue(child)
      const interceptor = new CommandInterceptor('user-1')

      const promise = interceptor.executeWithCapture('ls -la')
      await flush()
      child.stdout.emit('data', Buffer.from('file1\n'))
      child.emit('close', 0)

      const result = await promise
      expect(result).toEqual({ stdout: 'file1\n', stderr: '', exitCode: 0 })
      expect(h.captureCommand).not.toHaveBeenCalled()
    })

    it('respects forceCapture even for a non-matching command', async () => {
      h.captureCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
      const interceptor = new CommandInterceptor('user-1')

      await interceptor.executeWithCapture('ls -la', { forceCapture: true, evidenceType: 'build' })

      expect(h.captureCommand).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'build' }),
      )
    })

    it('bypasses capture entirely when the interceptor is disabled, even for a matching command', async () => {
      const child = makeFakeChild()
      h.spawn.mockReturnValue(child)
      const interceptor = new CommandInterceptor('user-1')
      interceptor.setEnabled(false)

      const promise = interceptor.executeWithCapture('npx vitest run')
      await flush()
      child.emit('close', 0)

      await promise
      expect(h.captureCommand).not.toHaveBeenCalled()
      expect(h.spawn).toHaveBeenCalled()
    })

    it('passes cwd and env options through to spawn for uncaptured commands', async () => {
      const child = makeFakeChild()
      h.spawn.mockReturnValue(child)
      const interceptor = new CommandInterceptor('user-1')

      const promise = interceptor.executeWithCapture('ls', { cwd: '/tmp/x', env: { FOO: 'bar' } })
      await flush()
      child.emit('close', 0)
      await promise

      const [, , spawnOpts] = h.spawn.mock.calls[0]
      expect(spawnOpts.cwd).toBe('/tmp/x')
      expect(spawnOpts.env.FOO).toBe('bar')
    })

    it('rejects when the spawned process emits an error', async () => {
      const child = makeFakeChild()
      h.spawn.mockReturnValue(child)
      const interceptor = new CommandInterceptor('user-1')

      const promise = interceptor.executeWithCapture('ls -la')
      await flush()
      const err = new Error('spawn failed')
      child.emit('error', err)

      await expect(promise).rejects.toThrow('spawn failed')
    })

    it('collects stderr output and a non-zero exit code', async () => {
      const child = makeFakeChild()
      h.spawn.mockReturnValue(child)
      const interceptor = new CommandInterceptor('user-1')

      const promise = interceptor.executeWithCapture('false')
      await flush()
      child.stderr.emit('data', Buffer.from('error output'))
      child.emit('close', 1)

      const result = await promise
      expect(result).toEqual({ stdout: '', stderr: 'error output', exitCode: 1 })
    })

    it('defaults exit code to 0 when close emits null', async () => {
      const child = makeFakeChild()
      h.spawn.mockReturnValue(child)
      const interceptor = new CommandInterceptor('user-1')

      const promise = interceptor.executeWithCapture('true')
      await flush()
      child.emit('close', null)

      const result = (await promise) as { stdout: string; stderr: string; exitCode: number }
      expect(result.exitCode).toBe(0)
    })
  })

  describe('pattern management', () => {
    it('addPattern registers a new capture pattern that analyzeCommand picks up', () => {
      const interceptor = new CommandInterceptor('user-1')
      interceptor.addPattern(/custom-cmd/, 'deployment')

      const result = interceptor.analyzeCommand('run custom-cmd now')
      expect(result.type).toBe('deployment')
      expect(result.shouldCapture).toBe(true)
    })

    it('removePattern removes a pattern so it no longer matches (must pass the exact registered RegExp instance, since Map keys are compared by reference)', () => {
      const interceptor = new CommandInterceptor('user-1')
      const eslintPattern = [...interceptor.getPatterns().keys()].find((p) => p.source === 'eslint')
      expect(eslintPattern).toBeDefined()

      interceptor.removePattern(eslintPattern!)

      const result = interceptor.analyzeCommand('npx eslint .')
      expect(result.shouldCapture).toBe(false)
    })

    it('getPatterns returns a copy, not the live map', () => {
      const interceptor = new CommandInterceptor('user-1')
      const patterns = interceptor.getPatterns()
      patterns.clear()

      // Original patterns should still match since getPatterns returned a copy
      const result = interceptor.analyzeCommand('npx eslint .')
      expect(result.shouldCapture).toBe(true)
    })
  })

  describe('factory helpers', () => {
    it('createCommandInterceptor returns a CommandInterceptor instance', () => {
      const interceptor = createCommandInterceptor('user-2')
      expect(interceptor).toBeInstanceOf(CommandInterceptor)
    })

    it('executeAndCapture creates an interceptor and executes the command', async () => {
      h.captureCommand.mockResolvedValue({ stdout: 'done', stderr: '', exitCode: 0 })

      const result = await executeAndCapture('user-3', 'npx vitest run')

      expect(h.captureCommand).toHaveBeenCalledWith('user-3', expect.objectContaining({ command: 'npx vitest run' }))
      expect(result).toEqual({ stdout: 'done', stderr: '', exitCode: 0 })
    })
  })
})
