/**
 * #342 — Plan + bounded self-review turns in the codegen loop.
 *
 * Covers:
 *   - the pure plan-review module (scratch-file matching, prompt block, headroom)
 *   - claude-agent integration: the spawned CLI gets the plan/review system
 *     prompt, the Read tool (needed for the review pass), and maxTurns headroom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter, Readable } from 'stream'
import {
  PLAN_FILE,
  AGENT_SCRATCH_FILES,
  isAgentScratchFile,
  PLAN_REVIEW_TURN_HEADROOM,
  planReviewPromptBlock,
} from '../../lib/agent/plan-review'

// ---------------------------------------------------------------------------
// Pure module
// ---------------------------------------------------------------------------

describe('plan-review module (#342)', () => {
  it('names the plan file .cody-plan.md', () => {
    expect(PLAN_FILE).toBe('.cody-plan.md')
    expect(AGENT_SCRATCH_FILES.has(PLAN_FILE)).toBe(true)
  })

  describe('isAgentScratchFile', () => {
    it('matches scratch files at the root', () => {
      expect(isAgentScratchFile('.cody-plan.md')).toBe(true)
      expect(isAgentScratchFile('.cody-analysis.md')).toBe(true)
    })

    it('matches scratch files by basename at any depth', () => {
      expect(isAgentScratchFile('src/.cody-plan.md')).toBe(true)
      expect(isAgentScratchFile('/tmp/builder-sessions/x/.cody-plan.md')).toBe(true)
    })

    it('does NOT match app files', () => {
      expect(isAgentScratchFile('src/App.tsx')).toBe(false)
      expect(isAgentScratchFile('README.md')).toBe(false)
      expect(isAgentScratchFile('package.json')).toBe(false)
      expect(isAgentScratchFile('')).toBe(false)
    })

    it('does NOT match files that merely contain the scratch name', () => {
      expect(isAgentScratchFile('my.cody-plan.md.bak')).toBe(false)
      expect(isAgentScratchFile('cody-plan.md')).toBe(false)
    })
  })

  describe('planReviewPromptBlock', () => {
    const block = planReviewPromptBlock()

    it('instructs writing the plan file FIRST', () => {
      expect(block).toContain(PLAN_FILE)
      expect(block).toMatch(/FIRST action/i)
      expect(block).toMatch(/checklist/i)
    })

    it('instructs updating the plan as work progresses', () => {
      expect(block).toMatch(/Update it as you go/i)
    })

    it('carves the plan file out of the no-new-files rule', () => {
      expect(block).toMatch(/exception/i)
      expect(block).toMatch(/never shipped/i)
    })

    it('bounds the review to exactly ONE pass', () => {
      expect(block).toMatch(/exactly ONE pass/i)
      expect(block).toMatch(/Do NOT start a second review pass/i)
    })

    it('review pass covers plan conformance, imports, JSX, and stubs', () => {
      expect(block).toMatch(/imports between files resolve/i)
      expect(block).toMatch(/JSX tags balanced/i)
      expect(block).toMatch(/placeholder|TODO|stub/i)
    })
  })

  it('turn headroom is small and positive (plan write + one ~3-turn review pass)', () => {
    expect(PLAN_REVIEW_TURN_HEADROOM).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// claude-agent integration (spawn-arg level)
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn()
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

vi.mock('../../lib/agent/worktree-manager', () => ({
  createWorktree: vi.fn().mockResolvedValue('/tmp/builder-sessions/plan-review-test'),
  getWorktreeFiles: vi.fn().mockResolvedValue({
    'src/App.tsx': 'export default function App() { return <div>ok</div> }',
  }),
  getWorktreePath: vi.fn().mockReturnValue('/tmp/builder-sessions/plan-review-test'),
}))

import { runHeadlessAgent } from '../../lib/agent/claude-agent'

function mockProcess(): any {
  const proc = new EventEmitter() as any
  proc.stdout = Readable.from([
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n',
  ])
  proc.stderr = Readable.from(['\n'])
  proc.stdin = { end: vi.fn() }
  proc.exitCode = null
  proc.kill = vi.fn()
  setTimeout(() => {
    proc.exitCode = 0
    proc.emit('exit', 0)
  }, 10)
  return proc
}

describe('claude-agent wiring for plan + review (#342)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, USE_CLAUDE_AGENT: 'true' }
    mockSpawn.mockReset()
    mockSpawn.mockImplementation(() => mockProcess())
  })

  afterEach(() => {
    process.env = originalEnv
  })

  async function drain(gen: AsyncGenerator<unknown>) {
    for await (const _e of gen) {
      /* drain */
    }
  }

  it('appends the plan/review block to the system prompt', async () => {
    await drain(runHeadlessAgent('build a thing', 'plan-review-test'))

    const args = mockSpawn.mock.calls[0][1] as string[]
    const idx = args.indexOf('--append-system-prompt')
    expect(idx).toBeGreaterThan(-1)
    const prompt = args[idx + 1]
    expect(prompt).toContain('.cody-plan.md')
    expect(prompt).toContain('SELF-REVIEW (exactly ONE pass')
    // Base workspace rules must still be present, before the plan block
    expect(prompt).toContain('You are building a React component')
    expect(prompt.indexOf('You are building a React component')).toBeLessThan(
      prompt.indexOf('.cody-plan.md'),
    )
  })

  it('caller systemPrompt still lands after the plan/review block', async () => {
    await drain(
      runHeadlessAgent('build a thing', 'plan-review-test', {
        systemPrompt: 'EXTRA-CALLER-PROMPT',
      }),
    )

    const args = mockSpawn.mock.calls[0][1] as string[]
    const prompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(prompt).toContain('EXTRA-CALLER-PROMPT')
    expect(prompt.indexOf('SELF-REVIEW')).toBeLessThan(prompt.indexOf('EXTRA-CALLER-PROMPT'))
  })

  it('grants Read in the default allowed tools (review pass re-reads files)', async () => {
    await drain(runHeadlessAgent('build a thing', 'plan-review-test'))

    const args = mockSpawn.mock.calls[0][1] as string[]
    const toolIdx = args.indexOf('--allowedTools')
    expect(toolIdx).toBeGreaterThan(-1)
    const tools = args.slice(toolIdx + 1).filter((a) => !a.startsWith('--'))
    expect(tools).toContain('Read')
    expect(tools).toContain('Write')
    expect(tools).toContain('Edit')
    // No shell, no exploring
    expect(tools).not.toContain('Bash')
    expect(tools).not.toContain('Glob')
  })

  it('adds PLAN_REVIEW_TURN_HEADROOM on top of the default 12 turns', async () => {
    await drain(runHeadlessAgent('build a thing', 'plan-review-test'))

    const args = mockSpawn.mock.calls[0][1] as string[]
    const idx = args.indexOf('--max-turns')
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe(String(12 + PLAN_REVIEW_TURN_HEADROOM))
  })

  it('adds headroom on top of a caller-provided maxTurns (chat-ws passes 12/8)', async () => {
    await drain(runHeadlessAgent('build a thing', 'plan-review-test', { maxTurns: 8 }))

    const args = mockSpawn.mock.calls[0][1] as string[]
    const idx = args.indexOf('--max-turns')
    expect(args[idx + 1]).toBe(String(8 + PLAN_REVIEW_TURN_HEADROOM))
  })

  it('planReview: false (repair runs) skips the block AND the headroom', async () => {
    await drain(
      runHeadlessAgent('fix a thing', 'plan-review-test', { maxTurns: 6, planReview: false }),
    )

    const args = mockSpawn.mock.calls[0][1] as string[]
    const prompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(prompt).not.toContain('.cody-plan.md')
    expect(prompt).not.toContain('SELF-REVIEW')
    const idx = args.indexOf('--max-turns')
    expect(args[idx + 1]).toBe('6')
  })

  it('verify-loop repair options opt OUT of plan/review (#342)', async () => {
    const { buildVerifyAgentOptions } = await import('../../lib/agent/verify-loop')
    expect(buildVerifyAgentOptions().planReview).toBe(false)
  })
})
