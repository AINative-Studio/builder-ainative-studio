import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter, Readable } from 'stream'

// Mock child_process.spawn before importing the module
const mockSpawn = vi.fn()
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// Mock worktree-manager
vi.mock('../../lib/agent/worktree-manager', () => ({
  createWorktree: vi.fn().mockResolvedValue('/tmp/builder-sessions/test-chat'),
  getWorktreeFiles: vi.fn().mockResolvedValue({
    'src/App.tsx': 'export default function App() { return <div>Counter</div> }',
    'package.json': '{"name":"builder-session"}',
  }),
  getWorktreePath: vi.fn().mockReturnValue('/tmp/builder-sessions/test-chat'),
}))

import { runHeadlessAgent, isClaudeAgentEnabled, type AgentEvent } from '../../lib/agent/claude-agent'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProcess(
  stdoutLines: string[],
  exitCode = 0,
  stderrLines: string[] = [],
): EventEmitter & { stdout: Readable; stderr: Readable; stdin: { end: () => void }; exitCode: number | null; kill: () => void } {
  const proc = new EventEmitter() as any
  proc.stdout = Readable.from(stdoutLines.map((l) => l + '\n'))
  proc.stderr = Readable.from(stderrLines.map((l) => l + '\n'))
  proc.stdin = { end: vi.fn() }
  proc.exitCode = null
  proc.kill = vi.fn()

  // Simulate process exit after a tick
  setTimeout(() => {
    proc.exitCode = exitCode
    proc.emit('exit', exitCode)
  }, 10)

  return proc
}

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) {
    events.push(event)
  }
  return events
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('claude-agent', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, USE_CLAUDE_AGENT: 'true' }
    mockSpawn.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('isClaudeAgentEnabled', () => {
    it('returns true when USE_CLAUDE_AGENT=true', () => {
      process.env.USE_CLAUDE_AGENT = 'true'
      expect(isClaudeAgentEnabled()).toBe(true)
    })

    it('returns false when USE_CLAUDE_AGENT is not set', () => {
      delete process.env.USE_CLAUDE_AGENT
      expect(isClaudeAgentEnabled()).toBe(false)
    })

    it('returns false when USE_CLAUDE_AGENT=false', () => {
      process.env.USE_CLAUDE_AGENT = 'false'
      expect(isClaudeAgentEnabled()).toBe(false)
    })
  })

  describe('runHeadlessAgent', () => {
    it('yields error when agent is not enabled', async () => {
      process.env.USE_CLAUDE_AGENT = 'false'

      const events = await collectEvents(
        runHeadlessAgent('test prompt', 'test-chat'),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'error',
        fatal: true,
        error: expect.stringContaining('not enabled'),
      })
    })

    it('yields build_step events for workspace initialization', async () => {
      const proc = createMockProcess([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Done' }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('test prompt', 'test-chat'),
      )

      const buildSteps = events.filter((e) => e.type === 'build_step')
      expect(buildSteps.length).toBeGreaterThanOrEqual(2)
      expect(buildSteps[0]).toMatchObject({
        type: 'build_step',
        step: 'Workspace initialized',
      })
    })

    it('spawns claude CLI with correct arguments', async () => {
      const proc = createMockProcess([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat', {
          model: 'opus',
          maxBudgetUsd: 2.0,
        }),
      )

      expect(mockSpawn).toHaveBeenCalledOnce()
      const [cmd, args, opts] = mockSpawn.mock.calls[0]

      expect(cmd).toBe('claude')
      expect(args).toContain('--print')
      expect(args).toContain('--output-format')
      expect(args).toContain('stream-json')
      expect(args).toContain('--permission-mode')
      expect(args).toContain('acceptEdits')
      expect(args).toContain('--model')
      expect(args).toContain('opus')
      expect(args).toContain('--max-budget-usd')
      expect(args).toContain('2')
      expect(args).toContain('build a counter')
      expect(opts.cwd).toBe('/tmp/builder-sessions/test-chat')
    })

    it('translates assistant text events to chunks', async () => {
      const proc = createMockProcess([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Building your counter app...' }],
          },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      const chunks = events.filter((e) => e.type === 'chunk')
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      expect(chunks[0]).toMatchObject({
        type: 'chunk',
        content: 'Building your counter app...',
      })
    })

    it('translates tool_use Write events to build_step', async () => {
      const proc = createMockProcess([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: 'src/App.tsx' },
              },
            ],
          },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      const steps = events.filter((e) => e.type === 'build_step')
      expect(steps.some((s) => s.type === 'build_step' && s.step.includes('src/App.tsx'))).toBe(true)
    })

    it('translates tool_use Bash events to build_step with command preview', async () => {
      const proc = createMockProcess([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'npm run build' },
              },
            ],
          },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      const steps = events.filter((e) => e.type === 'build_step')
      expect(steps.some((s) => s.type === 'build_step' && s.step.includes('npm run build'))).toBe(true)
    })

    it('emits chunk_progress on each assistant turn', async () => {
      const proc = createMockProcess([
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Turn 1' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Turn 2' }] },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      const progress = events.filter((e) => e.type === 'chunk_progress')
      expect(progress).toHaveLength(2)
      expect(progress[0]).toMatchObject({ type: 'chunk_progress', phase: 1 })
      expect(progress[1]).toMatchObject({ type: 'chunk_progress', phase: 2 })
    })

    it('emits files event with worktree contents on success', async () => {
      const proc = createMockProcess([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      const filesEvents = events.filter((e) => e.type === 'files')
      expect(filesEvents).toHaveLength(1)
      expect(filesEvents[0]).toMatchObject({
        type: 'files',
        files: {
          'src/App.tsx': expect.any(String),
          'package.json': expect.any(String),
        },
      })
    })

    it('emits complete event with duration', async () => {
      const proc = createMockProcess([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      const complete = events.find((e) => e.type === 'complete')
      expect(complete).toBeDefined()
      expect(complete).toMatchObject({
        type: 'complete',
        chatId: 'test-chat',
        durationMs: expect.any(Number),
      })
    })

    it('emits error event when result has is_error=true', async () => {
      const proc = createMockProcess([
        JSON.stringify({
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: 'Rate limit exceeded',
        }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      const errors = events.filter((e) => e.type === 'error')
      expect(errors.length).toBeGreaterThanOrEqual(1)
      expect(errors.some((e) => e.type === 'error' && e.error.includes('Rate limit'))).toBe(true)
    })

    it('emits fatal error on non-zero exit code', async () => {
      const proc = createMockProcess([], 1, ['something went wrong'])
      mockSpawn.mockReturnValue(proc)

      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      const fatalErrors = events.filter((e) => e.type === 'error' && e.fatal)
      expect(fatalErrors.length).toBeGreaterThanOrEqual(1)
    })

    it('passes allowed tools to CLI', async () => {
      const proc = createMockProcess([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      await collectEvents(
        runHeadlessAgent('test', 'test-chat', {
          allowedTools: ['Read', 'Write'],
        }),
      )

      const args = mockSpawn.mock.calls[0][1]
      const toolIdx = args.indexOf('--allowedTools')
      expect(toolIdx).toBeGreaterThan(-1)
      expect(args[toolIdx + 1]).toBe('Read')
      expect(args[toolIdx + 2]).toBe('Write')
    })

    it('handles malformed JSON lines gracefully', async () => {
      const proc = createMockProcess([
        'not valid json',
        '{also broken',
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      // Should not throw
      const events = await collectEvents(
        runHeadlessAgent('build a counter', 'test-chat'),
      )

      // Should still emit completion events
      const complete = events.find((e) => e.type === 'complete')
      expect(complete).toBeDefined()
    })
  })
})

// ---------------------------------------------------------------------------
// Additional tests for uncovered branches — targeting 90%+ statement coverage
// ---------------------------------------------------------------------------

import { isClaudeAgentFallbackEnabled } from '../../lib/agent/claude-agent'
import { getWorktreeFiles, createWorktree } from '../../lib/agent/worktree-manager'

// Re-use the helpers defined above but in a new describe block that still
// has access to mockSpawn via the hoisted mock.

/**
 * Creates a mock process whose stdout emits lines but then errors.
 */
function createErroringProcess(
  linesBeforeError: string[],
  errorMessage: string,
): EventEmitter & { stdout: any; stderr: any; stdin: { end: () => void }; exitCode: number | null; kill: () => void } {
  const proc = new EventEmitter() as any
  proc.stdin = { end: vi.fn() }
  proc.exitCode = null
  proc.kill = vi.fn()

  // Build a stdout that emits lines then destroys itself with an error
  const { Readable: ReadableStream } = require('stream')
  const stdout = new ReadableStream({ read() {} })
  proc.stdout = stdout

  const stderr = new ReadableStream({ read() {} })
  stderr.push(null)
  proc.stderr = stderr

  setTimeout(() => {
    for (const line of linesBeforeError) {
      stdout.push(line + '\n')
    }
    stdout.destroy(new Error(errorMessage))
    proc.exitCode = 1
    proc.emit('exit', 1)
  }, 5)

  return proc
}

/**
 * Creates a mock process where stdout emits a partial final line (no trailing newline)
 * to exercise the "remaining buffer" path.
 */
function createRemainingBufferProcess(lines: string[]): EventEmitter & { stdout: any; stderr: any; stdin: { end: () => void }; exitCode: number | null; kill: () => void } {
  const proc = new EventEmitter() as any
  proc.stdin = { end: vi.fn() }
  proc.exitCode = null
  proc.kill = vi.fn()

  const { Readable: ReadableStream } = require('stream')
  // Join lines with '\n' but do NOT add trailing newline — last line stays in buffer
  const rawData = lines.join('\n')
  proc.stdout = ReadableStream.from([rawData])

  const stderr = new ReadableStream({ read() {} })
  stderr.push(null)
  proc.stderr = stderr

  setTimeout(() => {
    proc.exitCode = 0
    proc.emit('exit', 0)
  }, 10)

  return proc
}

describe('claude-agent (extended coverage)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      USE_CLAUDE_AGENT: 'true',
    }
    mockSpawn.mockReset()
    vi.mocked(getWorktreeFiles).mockResolvedValue({
      'src/App.tsx': 'export default function App() {}',
      'package.json': '{"name":"test"}',
    })
    vi.mocked(createWorktree).mockResolvedValue('/tmp/builder-sessions/test-chat')
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // -------------------------------------------------------------------------
  // isClaudeAgentFallbackEnabled
  // -------------------------------------------------------------------------

  describe('isClaudeAgentFallbackEnabled', () => {
    it('returns true when USE_CLAUDE_AGENT_FALLBACK=true', () => {
      delete process.env.USE_CLAUDE_AGENT
      process.env.USE_CLAUDE_AGENT_FALLBACK = 'true'
      expect(isClaudeAgentFallbackEnabled()).toBe(true)
    })

    it('returns true when USE_CLAUDE_AGENT=true (even without fallback flag)', () => {
      delete process.env.USE_CLAUDE_AGENT_FALLBACK
      process.env.USE_CLAUDE_AGENT = 'true'
      expect(isClaudeAgentFallbackEnabled()).toBe(true)
    })

    it('returns true when both USE_CLAUDE_AGENT and USE_CLAUDE_AGENT_FALLBACK=true', () => {
      process.env.USE_CLAUDE_AGENT = 'true'
      process.env.USE_CLAUDE_AGENT_FALLBACK = 'true'
      expect(isClaudeAgentFallbackEnabled()).toBe(true)
    })

    it('returns false when neither flag is set', () => {
      delete process.env.USE_CLAUDE_AGENT
      delete process.env.USE_CLAUDE_AGENT_FALLBACK
      expect(isClaudeAgentFallbackEnabled()).toBe(false)
    })

    it('returns false when USE_CLAUDE_AGENT=false and USE_CLAUDE_AGENT_FALLBACK is unset', () => {
      process.env.USE_CLAUDE_AGENT = 'false'
      delete process.env.USE_CLAUDE_AGENT_FALLBACK
      expect(isClaudeAgentFallbackEnabled()).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // translateToolUse — all tool name branches
  // -------------------------------------------------------------------------

  describe('translateToolUse — all tool branches', () => {
    async function toolEvents(toolName: string, input: Record<string, unknown>): Promise<AgentEvent[]> {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      const lines = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', name: toolName, input }],
          },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ]
      proc.stdout = ReadableStream.from([lines.join('\n') + '\n'])
      const stderr = new ReadableStream({ read() {} })
      stderr.push(null)
      proc.stderr = stderr

      setTimeout(() => {
        proc.exitCode = 0
        proc.emit('exit', 0)
      }, 10)

      mockSpawn.mockReturnValue(proc)
      const events: AgentEvent[] = []
      for await (const event of runHeadlessAgent('test', 'test-chat')) {
        events.push(event)
      }
      return events
    }

    it('FileWrite produces a Writing build_step with file_path', async () => {
      const events = await toolEvents('FileWrite', { file_path: 'src/index.ts' })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Writing') && s.step.includes('src/index.ts'))).toBe(true)
    })

    it('FileWrite falls back to path when file_path missing', async () => {
      const events = await toolEvents('FileWrite', { path: 'src/utils.ts' })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Writing') && s.step.includes('src/utils.ts'))).toBe(true)
    })

    it('FileWrite defaults to "file" when neither file_path nor path', async () => {
      const events = await toolEvents('FileWrite', {})
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Writing') && s.step.includes('file'))).toBe(true)
    })

    it('Edit produces an Editing build_step', async () => {
      const events = await toolEvents('Edit', { file_path: 'src/App.tsx' })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Editing') && s.step.includes('src/App.tsx'))).toBe(true)
    })

    it('FileEdit produces an Editing build_step using path', async () => {
      const events = await toolEvents('FileEdit', { path: 'lib/utils.ts' })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Editing') && s.step.includes('lib/utils.ts'))).toBe(true)
    })

    it('FileEdit defaults to "file" when no path fields', async () => {
      const events = await toolEvents('FileEdit', {})
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Editing') && s.step.includes('file'))).toBe(true)
    })

    it('Read produces a Reading build_step', async () => {
      const events = await toolEvents('Read', { file_path: 'package.json' })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Reading') && s.step.includes('package.json'))).toBe(true)
    })

    it('FileRead produces a Reading build_step using path', async () => {
      const events = await toolEvents('FileRead', { path: 'tsconfig.json' })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Reading') && s.step.includes('tsconfig.json'))).toBe(true)
    })

    it('Glob produces a Searching files build_step with pattern', async () => {
      const events = await toolEvents('Glob', { pattern: '**/*.ts' })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Searching files') && s.step.includes('**/*.ts'))).toBe(true)
    })

    it('Glob defaults to "..." when no pattern', async () => {
      const events = await toolEvents('Glob', {})
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Searching files') && s.step.includes('...'))).toBe(true)
    })

    it('Grep produces a Searching content build_step with pattern', async () => {
      const events = await toolEvents('Grep', { pattern: 'useState' })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Searching content') && s.step.includes('useState'))).toBe(true)
    })

    it('Grep defaults to "..." when no pattern', async () => {
      const events = await toolEvents('Grep', {})
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Searching content') && s.step.includes('...'))).toBe(true)
    })

    it('unknown tool name emits generic Tool: <name> build_step', async () => {
      const events = await toolEvents('SpecialTool', {})
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step === 'Tool: SpecialTool')).toBe(true)
    })

    it('Bash truncates long commands at 80 chars', async () => {
      const longCommand = 'npm run ' + 'x'.repeat(100)
      const events = await toolEvents('Bash', { command: longCommand })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      const bashStep = steps.find((s) => s.step.startsWith('Running:'))
      expect(bashStep).toBeDefined()
      // Step should be "Running: <truncated>" — truncated portion is <= 80 chars + "Running: " prefix
      const commandPart = bashStep!.step.replace('Running: ', '')
      expect(commandPart.length).toBeLessThanOrEqual(80)
      expect(commandPart.endsWith('...')).toBe(true)
    })

    it('Bash short command is not truncated', async () => {
      const shortCommand = 'npm install'
      const events = await toolEvents('Bash', { command: shortCommand })
      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      const bashStep = steps.find((s) => s.step.startsWith('Running:'))
      expect(bashStep).toBeDefined()
      expect(bashStep!.step).toContain('npm install')
      expect(bashStep!.step.endsWith('...')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // content_block_start / content_block_delta paths
  // -------------------------------------------------------------------------

  describe('content_block_start and content_block_delta events', () => {
    it('yields chunk from content_block_start text block', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      const lines = [
        JSON.stringify({
          type: 'content_block_start',
          content_block: { type: 'text', text: 'Hello from block start' },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ]
      proc.stdout = ReadableStream.from([lines.join('\n') + '\n'])
      const stderr = new ReadableStream({ read() {} })
      stderr.push(null)
      proc.stderr = stderr
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const chunks = events.filter((e) => e.type === 'chunk')
      expect(chunks.some((c) => c.type === 'chunk' && c.content === 'Hello from block start')).toBe(true)
    })

    it('yields build_step from content_block_delta tool_use block', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      const lines = [
        JSON.stringify({
          type: 'content_block_delta',
          content_block: { type: 'tool_use', name: 'Write', input: { file_path: 'foo.ts' } },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ]
      proc.stdout = ReadableStream.from([lines.join('\n') + '\n'])
      const stderr = new ReadableStream({ read() {} })
      stderr.push(null)
      proc.stderr = stderr
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const steps = events.filter((e) => e.type === 'build_step') as Array<{ type: 'build_step'; step: string }>
      expect(steps.some((s) => s.step.includes('Writing'))).toBe(true)
    })

    it('ignores content_block_start with no text or tool_use', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      const lines = [
        JSON.stringify({
          type: 'content_block_start',
          content_block: { type: 'image' },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ]
      proc.stdout = ReadableStream.from([lines.join('\n') + '\n'])
      const stderr = new ReadableStream({ read() {} })
      stderr.push(null)
      proc.stderr = stderr
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)
      // Should complete without error
      expect(events.find((e) => e.type === 'complete')).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // Remaining buffer processing (no trailing newline)
  // -------------------------------------------------------------------------

  describe('remaining buffer after stream ends', () => {
    it('processes a final line without trailing newline', async () => {
      const proc = createRemainingBufferProcess([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
      ])
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)
      expect(events.find((e) => e.type === 'complete')).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // Stream error handling
  // -------------------------------------------------------------------------

  describe('stream error handling', () => {
    it('emits fatal error when stdout stream errors (non-aborted)', async () => {
      const proc = createErroringProcess([], 'connection reset')
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const errors = events.filter((e) => e.type === 'error' && e.fatal)
      expect(errors.length).toBeGreaterThanOrEqual(1)
      expect(errors.some((e) => e.type === 'error' && e.error.includes('Stream error'))).toBe(true)
    })

    it('emits cancelled error when stdout stream errors and signal is aborted', async () => {
      const controller = new AbortController()

      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      const stdout = new ReadableStream({ read() {} })
      proc.stdout = stdout
      const stderr = new ReadableStream({ read() {} })
      stderr.push(null)
      proc.stderr = stderr

      // Abort the signal before the stream errors
      setTimeout(() => {
        controller.abort()
        stdout.destroy(new Error('aborted stream'))
        proc.exitCode = 1
        proc.emit('exit', 1)
      }, 5)

      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat', { abortSignal: controller.signal })) {
        events.push(e)
      }

      const cancelErrors = events.filter((e) => e.type === 'error' && e.type === 'error')
      expect(cancelErrors.some((e) => e.type === 'error' && e.error.includes('cancelled'))).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Exit code handling
  // -------------------------------------------------------------------------

  describe('exit code handling', () => {
    it('emits fatal error with stderr when process exits non-zero', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from(['\n'])
      proc.stderr = ReadableStream.from(['npm ERR! missing script: build\n'])

      setTimeout(() => {
        proc.exitCode = 2
        proc.emit('exit', 2)
      }, 10)

      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const fatalErrors = events.filter((e) => e.type === 'error' && e.fatal)
      expect(fatalErrors.length).toBeGreaterThanOrEqual(1)
      expect(
        fatalErrors.some((e) => e.type === 'error' && e.error.includes('npm ERR!')),
      ).toBe(true)
    })

    it('uses lastError (from result event) when stderr is empty on non-zero exit', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Rate limit hit' }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])

      setTimeout(() => {
        proc.exitCode = 1
        proc.emit('exit', 1)
      }, 10)

      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const fatalErrors = events.filter((e) => e.type === 'error' && e.fatal)
      expect(fatalErrors.length).toBeGreaterThanOrEqual(1)
      expect(
        fatalErrors.some((e) => e.type === 'error' && e.error.includes('Rate limit hit')),
      ).toBe(true)
    })

    it('uses fallback message "Agent exited with code N" when stderr and lastError are empty', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from(['\n'])
      proc.stderr = ReadableStream.from(['\n'])

      setTimeout(() => {
        proc.exitCode = 127
        proc.emit('exit', 127)
      }, 10)

      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const fatalErrors = events.filter((e) => e.type === 'error' && e.fatal)
      expect(fatalErrors.length).toBeGreaterThanOrEqual(1)
      expect(
        fatalErrors.some((e) => e.type === 'error' && e.error.includes('127')),
      ).toBe(true)
    })

    it('resolves immediately when child.exitCode is already set at wait time', async () => {
      // Simulate a fast-exit process where exitCode is set before the promise is created
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      // Pre-set exitCode so the "if (child.exitCode !== null)" branch is taken
      proc.exitCode = 0
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])

      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      expect(events.find((e) => e.type === 'complete')).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // File collection
  // -------------------------------------------------------------------------

  describe('file collection', () => {
    it('emits files event with worktree contents', async () => {
      vi.mocked(getWorktreeFiles).mockResolvedValue({
        'src/App.tsx': 'const App = () => <div/>;',
        'src/index.ts': 'export {}',
      })

      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const filesEvents = events.filter((e) => e.type === 'files')
      expect(filesEvents).toHaveLength(1)
      const fe = filesEvents[0] as { type: 'files'; files: Record<string, string> }
      expect(fe.files['src/App.tsx']).toBe('const App = () => <div/>;')
    })

    it('does NOT emit files event when worktree returns empty object', async () => {
      vi.mocked(getWorktreeFiles).mockResolvedValue({})

      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      // No files event should be emitted when files object is empty
      const filesEvents = events.filter((e) => e.type === 'files')
      expect(filesEvents).toHaveLength(0)
    })

    it('emits non-fatal error when getWorktreeFiles throws', async () => {
      vi.mocked(getWorktreeFiles).mockRejectedValue(new Error('ENOENT: no such directory'))

      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const errors = events.filter((e) => e.type === 'error')
      expect(errors.some((e) => e.type === 'error' && !e.fatal && e.error.includes('ENOENT'))).toBe(true)
      // Should still emit complete
      expect(events.find((e) => e.type === 'complete')).toBeDefined()
    })

    it('emits non-fatal error when getWorktreeFiles rejects with non-Error', async () => {
      vi.mocked(getWorktreeFiles).mockRejectedValue('disk full')

      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const errors = events.filter((e) => e.type === 'error')
      expect(errors.some((e) => e.type === 'error' && !e.fatal && e.error.includes('disk full'))).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Complete event with duration
  // -------------------------------------------------------------------------

  describe('complete event', () => {
    it('includes chatId and positive durationMs', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('build it', 'my-session-id')) events.push(e)

      const complete = events.find((e) => e.type === 'complete') as { type: 'complete'; chatId: string; durationMs: number } | undefined
      expect(complete).toBeDefined()
      expect(complete!.chatId).toBe('my-session-id')
      expect(complete!.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  // -------------------------------------------------------------------------
  // createWorktree failure
  // -------------------------------------------------------------------------

  describe('createWorktree failure', () => {
    it('emits fatal error when createWorktree throws', async () => {
      vi.mocked(createWorktree).mockRejectedValue(new Error('git error'))

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'bad-chat')) events.push(e)

      const fatal = events.find((e) => e.type === 'error' && e.fatal)
      expect(fatal).toBeDefined()
      expect(fatal!.type === 'error' && fatal!.error.includes('git error')).toBe(true)
    })

    it('emits fatal error when createWorktree rejects with non-Error value', async () => {
      vi.mocked(createWorktree).mockRejectedValue('permission denied')

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'bad-chat')) events.push(e)

      const fatal = events.find((e) => e.type === 'error' && e.fatal)
      expect(fatal).toBeDefined()
      expect(fatal!.type === 'error' && fatal!.error.includes('permission denied')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // spawn failure
  // -------------------------------------------------------------------------

  describe('spawn failure', () => {
    it('emits fatal error when spawn throws synchronously', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('ENOENT: claude not found')
      })

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const fatal = events.find((e) => e.type === 'error' && e.fatal)
      expect(fatal).toBeDefined()
      expect(fatal!.type === 'error' && fatal!.error.includes('claude not found')).toBe(true)
    })

    it('emits fatal error when spawn throws non-Error value', async () => {
      mockSpawn.mockImplementation(() => {
        throw 'spawn failed'
      })

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const fatal = events.find((e) => e.type === 'error' && e.fatal)
      expect(fatal).toBeDefined()
      expect(fatal!.type === 'error' && fatal!.error.includes('spawn failed')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // systemPrompt option
  // -------------------------------------------------------------------------

  describe('systemPrompt option', () => {
    it('passes --append-system-prompt arg when systemPrompt is provided', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      await (async () => {
        const events: AgentEvent[] = []
        for await (const e of runHeadlessAgent('test', 'test-chat', {
          systemPrompt: 'You are a senior engineer',
        })) {
          events.push(e)
        }
      })()

      const args = mockSpawn.mock.calls[0][1] as string[]
      const idx = args.indexOf('--append-system-prompt')
      expect(idx).toBeGreaterThan(-1)
      expect(args[idx + 1]).toBe('You are a senior engineer')
    })

    it('does not pass --append-system-prompt when systemPrompt is absent', async () => {
      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      proc.stdout = ReadableStream.from([
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
      ])
      proc.stderr = ReadableStream.from(['\n'])
      setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0) }, 10)
      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat')) events.push(e)

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args.includes('--append-system-prompt')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Abort signal integration
  // -------------------------------------------------------------------------

  describe('abort signal integration', () => {
    it('kills the child process when abort signal fires', async () => {
      const controller = new AbortController()

      const proc = new EventEmitter() as any
      proc.stdin = { end: vi.fn() }
      proc.exitCode = null
      proc.kill = vi.fn()

      const { Readable: ReadableStream } = require('stream')
      const stdout = new ReadableStream({ read() {} })
      proc.stdout = stdout
      const stderr = new ReadableStream({ read() {} })
      stderr.push(null)
      proc.stderr = stderr

      // After abort, simulate clean exit (exit code 0 after SIGTERM)
      setTimeout(() => {
        controller.abort()
        stdout.push(null)
        proc.exitCode = 0
        proc.emit('exit', 0)
      }, 5)

      mockSpawn.mockReturnValue(proc)

      const events: AgentEvent[] = []
      for await (const e of runHeadlessAgent('test', 'test-chat', { abortSignal: controller.signal })) {
        events.push(e)
      }

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    })
  })
})
