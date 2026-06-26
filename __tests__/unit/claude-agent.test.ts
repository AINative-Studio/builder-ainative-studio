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
