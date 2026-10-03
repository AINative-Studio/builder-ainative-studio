import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRun = vi.fn()
const mockWrite = vi.fn()
const mockRead = vi.fn()
const mockKill = vi.fn()
const mockCreate = vi.fn()

vi.mock('e2b', async () => {
  const actual = await vi.importActual<typeof import('e2b')>('e2b')
  return {
    ...actual,
    Sandbox: {
      create: (...args: any[]) => mockCreate(...args),
    },
  }
})

import { isE2BEnabled, runSequenceInE2BSandbox } from '@/lib/build/e2b-sandbox'
import { CommandExitError } from 'e2b'

describe('e2b-sandbox (#875) — isolated execution for untrusted generated code', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockKill.mockResolvedValue(true)
    mockCreate.mockResolvedValue({
      commands: { run: mockRun },
      files: { write: mockWrite, read: mockRead },
      kill: mockKill,
    })
  })

  it('isE2BEnabled requires a real API key present', () => {
    expect(isE2BEnabled({ E2B_API_KEY: 'x' } as any)).toBe(true)
    expect(isE2BEnabled({} as any)).toBe(false)
  })

  it('writes the FileMap then runs each command in order', async () => {
    mockRun
      .mockResolvedValueOnce({ exitCode: 0 }) // mkdir
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'installed', stderr: '' }) // step 1
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'ran', stderr: '' }) // step 2
    mockRead.mockResolvedValue('{"total":{"statements":{"pct":87}}}')

    const result = await runSequenceInE2BSandbox(
      { 'package.json': '{}' },
      [
        { command: 'npm', args: ['install'] },
        { command: 'npm', args: ['test'] },
      ],
      { timeoutMs: 5000, readBack: ['coverage.json'] },
    )

    expect(mockWrite).toHaveBeenCalledWith([
      { path: '/home/user/app/package.json', data: '{}' },
    ])
    expect(result.commandResults).toHaveLength(2)
    expect(result.commandResults[0].exitCode).toBe(0)
    expect(result.commandResults[1].exitCode).toBe(0)
    expect(result.files['coverage.json']).toBe('{"total":{"statements":{"pct":87}}}')
    expect(mockKill).toHaveBeenCalled()
  })

  it('stops the sequence early when a command exits non-zero', async () => {
    // A non-zero exit is THROWN by the real SDK as CommandExitError, never
    // resolved normally — see the dedicated CommandExitError test below for
    // why that distinction matters.
    mockRun
      .mockResolvedValueOnce({ exitCode: 0 }) // mkdir
      .mockRejectedValueOnce(new CommandExitError({
        exitCode: 1, stdout: '', stderr: 'install failed', error: 'exit status 1',
      } as any)) // step 1 fails

    const result = await runSequenceInE2BSandbox(
      { 'package.json': '{}' },
      [
        { command: 'npm', args: ['install'] },
        { command: 'npm', args: ['test'] },
      ],
      { timeoutMs: 5000 },
    )

    expect(result.commandResults).toHaveLength(1)
    expect(result.commandResults[0].exitCode).toBe(1)
    expect(mockKill).toHaveBeenCalled()
  })

  it('reports sandboxError and never throws when Sandbox.create itself fails', async () => {
    mockCreate.mockRejectedValue(new Error('E2B auth failed: invalid API key'))

    const result = await runSequenceInE2BSandbox(
      { 'package.json': '{}' },
      [{ command: 'npm', args: ['install'] }],
      { timeoutMs: 5000 },
    )

    expect(result.sandboxError).toMatch(/invalid API key/)
    expect(result.commandResults).toEqual([])
    expect(mockKill).not.toHaveBeenCalled()
  })

  it('extracts the real exitCode/stdout/stderr from a thrown CommandExitError (#875 — caught live 2026-10-02)', async () => {
    // Verified against the real E2B SDK: a non-zero exit (e.g. a genuinely
    // failing vitest run) does NOT return a normal CommandResult — it THROWS
    // CommandExitError. Treating that as a generic crash would silently lose
    // the real exit code and all test output, making every real test
    // failure indistinguishable from a sandbox crash.
    mockRun
      .mockResolvedValueOnce({ exitCode: 0 }) // mkdir
      .mockRejectedValueOnce(new CommandExitError({
        exitCode: 1,
        stdout: 'Tests  1 failed (1)',
        stderr: '',
        error: 'exit status 1',
      } as any))

    const result = await runSequenceInE2BSandbox(
      { 'package.json': '{}' },
      [{ command: 'npx', args: ['vitest', 'run'] }],
      { timeoutMs: 5000 },
    )

    expect(result.commandResults[0].exitCode).toBe(1)
    expect(result.commandResults[0].stdout).toBe('Tests  1 failed (1)')
    expect(result.commandResults[0].timedOut).toBe(false)
  })

  it('always kills the sandbox even when a command throws mid-sequence', async () => {
    mockRun
      .mockResolvedValueOnce({ exitCode: 0 }) // mkdir
      .mockRejectedValueOnce(new Error('sandbox timeout'))

    const result = await runSequenceInE2BSandbox(
      { 'package.json': '{}' },
      [{ command: 'npm', args: ['install'] }],
      { timeoutMs: 5000 },
    )

    expect(result.commandResults[0].exitCode).toBeNull()
    expect(result.commandResults[0].timedOut).toBe(true)
    expect(mockKill).toHaveBeenCalled()
  })

  it('leaves a readBack path absent (not empty string) when the file genuinely cannot be read', async () => {
    mockRun
      .mockResolvedValueOnce({ exitCode: 0 }) // mkdir
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
    mockRead.mockRejectedValue(new Error('ENOENT'))

    const result = await runSequenceInE2BSandbox(
      { 'package.json': '{}' },
      [{ command: 'npm', args: ['install'] }],
      { timeoutMs: 5000, readBack: ['missing.json'] },
    )

    expect(result.files['missing.json']).toBeUndefined()
    expect('missing.json' in result.files).toBe(false)
  })

  it('skips files.write entirely for an empty FileMap', async () => {
    mockRun.mockResolvedValue({ exitCode: 0 })

    await runSequenceInE2BSandbox({}, [{ command: 'echo', args: ['hi'] }], { timeoutMs: 5000 })

    expect(mockWrite).not.toHaveBeenCalled()
  })
})
