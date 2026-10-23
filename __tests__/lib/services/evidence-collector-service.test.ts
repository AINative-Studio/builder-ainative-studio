import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

/**
 * Unit tests for EvidenceCollectorService: spawns a command, captures
 * stdout/stderr, extracts framework-specific metadata (test/build/coverage
 * patterns), and persists evidence + artifacts. I/O boundaries mocked:
 * `child_process.spawn` (via a fake EventEmitter-based ChildProcess),
 * `fs.promises`, and `@/lib/db`.
 */

const dbMock = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({ evidence: {}, artifacts: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a, b) => ({ a, b })) }))

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
}))
vi.mock('fs', () => ({ promises: fsMock }))

/** A minimal fake ChildProcess: stdout/stderr are EventEmitters, the process itself emits 'close'. */
class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

let fakeChild: FakeChildProcess
const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ spawn: spawnMock }))

function insertReturningChain(row: any) {
  return { values: () => ({ returning: () => Promise.resolve([row]) }) }
}
function selectWhereLimitChain(rows: any[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }
}
function selectWhereChain(rows: any[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) }
}

/** Drives a captureCommand() call to completion by emitting stdout/stderr/close on the next microtask tick. */
function completeWith(stdout: string, stderr: string, exitCode: number) {
  queueMicrotask(() => {
    if (stdout) fakeChild.stdout.emit('data', Buffer.from(stdout))
    if (stderr) fakeChild.stderr.emit('data', Buffer.from(stderr))
    fakeChild.emit('close', exitCode)
  })
}

describe('EvidenceCollectorService.captureCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.mkdir.mockResolvedValue(undefined)
    fsMock.writeFile.mockResolvedValue(undefined)
    fsMock.readFile.mockRejectedValue(new Error('ENOENT'))
    fakeChild = new FakeChildProcess()
    spawnMock.mockReturnValue(fakeChild)
  })

  it('records success evidence and stdout/stderr artifacts when the command exits 0', async () => {
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'ev-1' }))
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'art-1', name: 'stdout.log' }))

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('5 tests passed\n', '', 0)

    const result = await service.captureCommand('user-1', {
      type: 'test-run',
      command: 'npx vitest run',
    })

    expect(result.success).toBe(true)
    expect(result.evidence).toEqual({ id: 'ev-1' })
    expect(result.artifacts).toHaveLength(1)
  })

  it('records failure evidence when the command exits non-zero', async () => {
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'ev-fail' }))
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'art-1' }))
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'art-2' }))

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('', '2 tests failed\n', 1)

    const result = await service.captureCommand('user-1', {
      type: 'test-run',
      command: 'npx vitest run',
    })

    expect(result.success).toBe(false)
  })

  it('records failure evidence when the spawned process itself errors (e.g. command not found)', async () => {
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'ev-err' }))

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    queueMicrotask(() => {
      fakeChild.emit('error', new Error('spawn ENOENT'))
    })

    const result = await service.captureCommand('user-1', {
      type: 'build',
      command: 'nonexistent-binary',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('ENOENT')
  })

  it('omits stdout/stderr from the stored evidence record when captureOutput is false', async () => {
    let evidenceInput: any
    dbMock.insert
      .mockImplementationOnce(() => ({
        values: (input: any) => {
          evidenceInput = input
          return { returning: () => Promise.resolve([{ id: 'ev-1' }]) }
        },
      }))
      .mockReturnValue(insertReturningChain({ id: 'art-1' }))

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('some output', '', 0)

    await service.captureCommand('user-1', {
      type: 'test-run',
      command: 'npx vitest run',
      captureOutput: false,
    })

    // captureOutput only governs what's persisted on the evidence row
    // itself — artifact saving (governed separately by captureArtifacts,
    // which still defaults true) is unaffected.
    expect(evidenceInput.stdout).toBeUndefined()
    expect(evidenceInput.stderr).toBeUndefined()
  })

  it('skips artifact creation entirely when captureArtifacts is false', async () => {
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'ev-1' }))

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('lots of output', '', 0)

    const result = await service.captureCommand('user-1', {
      type: 'test-run',
      command: 'npx vitest run',
      captureArtifacts: false,
    })

    expect(result.artifacts).toEqual([])
    expect(dbMock.insert).toHaveBeenCalledTimes(1)
  })

  it('invokes onProgress with incremental stdout/stderr chunks', async () => {
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'ev-1' }))
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'art-1' }))

    const onProgress = vi.fn()
    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('building...\n', '', 0)

    await service.captureCommand('user-1', {
      type: 'build',
      command: 'npm run build',
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledWith({ stdout: 'building...\n' })
  })

  it('rejects the inner spawn promise with a timeout error after the configured timeout elapses', async () => {
    vi.useFakeTimers()
    dbMock.insert.mockReturnValueOnce(insertReturningChain({ id: 'ev-timeout' }))

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    const promise = service.captureCommand('user-1', {
      type: 'build',
      command: 'npm run build',
      timeout: 1000,
    })

    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result.success).toBe(false)
    expect(result.error).toContain('timeout')
    expect(fakeChild.kill).toHaveBeenCalled()

    vi.useRealTimers()
  })
})

describe('EvidenceCollectorService metadata extraction (via captureCommand output)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.mkdir.mockResolvedValue(undefined)
    fsMock.writeFile.mockResolvedValue(undefined)
    fsMock.readFile.mockRejectedValue(new Error('ENOENT'))
    fakeChild = new FakeChildProcess()
    spawnMock.mockReturnValue(fakeChild)
  })

  it('extracts testsPassed/testsFailed/totalTests from a vitest-shaped output', async () => {
    let capturedInput: any
    dbMock.insert
      .mockImplementationOnce(() => ({
        values: (input: any) => {
          capturedInput = input
          return { returning: () => Promise.resolve([{ id: 'ev-1' }]) }
        },
      }))
      .mockReturnValue({ values: () => ({ returning: () => Promise.resolve([{ id: 'art-x' }]) }) })

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('12 passed\n2 failed\n1 skipped\n15 total\n', '', 1)

    const result = await service.captureCommand('user-1', {
      type: 'test-run',
      command: 'npx vitest run',
    })

    expect(capturedInput.metadata.testsPassed).toBe(12)
    expect(capturedInput.metadata.testsFailed).toBe(2)
    expect(capturedInput.metadata.testsSkipped).toBe(1)
    expect(capturedInput.metadata.totalTests).toBe(15)
  })

  it('extracts coveragePercent from a standard "All files | NN" coverage table', async () => {
    let capturedInput: any
    dbMock.insert
      .mockImplementationOnce(() => ({
        values: (input: any) => {
          capturedInput = input
          return { returning: () => Promise.resolve([{ id: 'ev-1' }]) }
        },
      }))
      .mockReturnValue({ values: () => ({ returning: () => Promise.resolve([{ id: 'art-x' }]) }) })

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('All files | 87.65 | 80 | 90 | 87.65 |\n', '', 0)

    const result = await service.captureCommand('user-1', {
      type: 'coverage',
      command: 'npx vitest run --coverage',
    })

    expect(capturedInput.metadata.coveragePercent).toBe(87.65)
  })

  it('marks buildSuccess false and extracts error/warning counts for a failed build', async () => {
    let capturedInput: any
    dbMock.insert
      .mockImplementationOnce(() => ({
        values: (input: any) => {
          capturedInput = input
          return { returning: () => Promise.resolve([{ id: 'ev-1' }]) }
        },
      }))
      .mockReturnValue({ values: () => ({ returning: () => Promise.resolve([{ id: 'art-x' }]) }) })

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('', '3 errors\n5 warnings\nBuild failed\n', 1)

    const result = await service.captureCommand('user-1', {
      type: 'build',
      command: 'npm run build',
    })

    expect(capturedInput.metadata.buildSuccess).toBe(false)
    expect(capturedInput.metadata.buildErrors).toBe(3)
    expect(capturedInput.metadata.buildWarnings).toBe(5)
  })

  it('detects the vitest framework from the command string', async () => {
    let capturedInput: any
    dbMock.insert
      .mockImplementationOnce(() => ({
        values: (input: any) => {
          capturedInput = input
          return { returning: () => Promise.resolve([{ id: 'ev-1' }]) }
        },
      }))
      .mockReturnValue({ values: () => ({ returning: () => Promise.resolve([{ id: 'art-x' }]) }) })

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService('/tmp/evidence-test')

    completeWith('ok\n', '', 0)

    await service.captureCommand('user-1', { type: 'test-run', command: 'npx vitest run' })
    expect(capturedInput.metadata.framework).toBe('vitest')
  })
})

describe('EvidenceCollectorService — read paths', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getEvidence returns the matching row', async () => {
    dbMock.select.mockReturnValueOnce(selectWhereLimitChain([{ id: 'ev-1' }]))
    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService()

    expect(await service.getEvidence('ev-1')).toEqual({ id: 'ev-1' })
  })

  it('getEvidence returns null when not found', async () => {
    dbMock.select.mockReturnValueOnce(selectWhereLimitChain([]))
    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService()

    expect(await service.getEvidence('missing')).toBeNull()
  })

  it('getEvidence returns null (not throw) on a query error', async () => {
    dbMock.select.mockImplementation(() => {
      throw new Error('db down')
    })
    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService()

    expect(await service.getEvidence('ev-1')).toBeNull()
  })

  it('getArtifacts returns matching rows', async () => {
    dbMock.select.mockReturnValueOnce(selectWhereChain([{ id: 'art-1' }]))
    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService()

    expect(await service.getArtifacts('ev-1')).toEqual([{ id: 'art-1' }])
  })

  it('getArtifacts returns an empty array (not throw) on a query error', async () => {
    dbMock.select.mockImplementation(() => {
      throw new Error('db down')
    })
    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService()

    expect(await service.getArtifacts('ev-1')).toEqual([])
  })

  it('readArtifact returns the file contents when the artifact row exists', async () => {
    dbMock.select.mockReturnValueOnce(selectWhereLimitChain([{ id: 'art-1', storage_path: '/tmp/x/stdout.log' }]))
    fsMock.readFile.mockResolvedValueOnce(Buffer.from('log contents'))

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService()

    const result = await service.readArtifact('art-1')
    expect(result?.toString()).toBe('log contents')
  })

  it('readArtifact returns null when the artifact row does not exist', async () => {
    dbMock.select.mockReturnValueOnce(selectWhereLimitChain([]))
    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService()

    expect(await service.readArtifact('missing')).toBeNull()
  })

  it('readArtifact returns null (not throw) when reading the file fails', async () => {
    dbMock.select.mockReturnValueOnce(selectWhereLimitChain([{ id: 'art-1', storage_path: '/missing/path' }]))
    fsMock.readFile.mockRejectedValueOnce(new Error('ENOENT'))

    const { EvidenceCollectorService } = await import('@/lib/services/evidence-collector.service')
    const service = new EvidenceCollectorService()

    expect(await service.readArtifact('art-1')).toBeNull()
  })
})

describe('getEvidenceCollectorService', () => {
  it('returns a singleton instance across calls', async () => {
    const { getEvidenceCollectorService, EvidenceCollectorService } = await import(
      '@/lib/services/evidence-collector.service'
    )

    const a = getEvidenceCollectorService()
    const b = getEvidenceCollectorService()

    expect(a).toBe(b)
    expect(a).toBeInstanceOf(EvidenceCollectorService)
  })
})
