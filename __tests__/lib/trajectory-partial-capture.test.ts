/**
 * #343 — trajectory steps:[] capture fix.
 *
 * Root cause (verified against a live cody 0.12.82 stream dump): cody only
 * emits a complete `assistant` event when a message FINISHES. A run killed
 * mid-turn (budget / max-turns / abort) emitted zero assistant events, so
 * every such prod trajectory landed with steps:[] despite real tool calls.
 * The fix: spawn with --include-partial-messages and reconstruct the in-flight
 * turn from {type:'stream_event', event:{...}} chunks; the complete assistant
 * event supersedes partials when it does arrive.
 *
 * Event shapes below are copied from the real smoke dump (raw stream-json from
 * @ainative/cody-cli 0.12.82 on Bedrock Sonnet 4.6) — not invented.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { TrajectoryCapture } from '@/lib/agent/trajectory-capture'

function tmpWorktree(): string {
  // Static-app shape → autoVerify takes the fast no-npm path.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-test-'))
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<html><body><h1>app</h1><script>console.log(1)</script>${'x'.repeat(300)}</body></html>`,
  )
  return dir
}

/** Real cody 0.12.82 complete-message shapes (from the live smoke dump). */
const completeAssistantToolUse = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_bdrk_01HBxY343wmFDyoxEnZqU7ZW',
        name: 'Edit',
        input: { file_path: '/tmp/ws/src/App.tsx', old_string: 'a', new_string: 'b' },
      },
    ],
  },
  parent_tool_use_id: null,
  session_id: 's1',
  uuid: 'u1',
}

const completeUserToolResult = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      { tool_use_id: 'toolu_bdrk_01HBxY343wmFDyoxEnZqU7ZW', type: 'tool_result', content: 'The file has been updated' },
    ],
  },
  session_id: 's1',
  uuid: 'u2',
}

const resultEvent = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 1000,
  num_turns: 3,
  total_cost_usd: 0.12,
  stop_reason: 'end_turn',
}

describe('TrajectoryCapture — complete cody 0.12.82 stream (regression guard)', () => {
  it('captures tool_use + tool_result steps from complete events', async () => {
    const cap = new TrajectoryCapture('chat1', 'build a counter', 'us.anthropic.claude-sonnet-4-6')
    cap.observe({ type: 'system', subtype: 'init' })
    cap.observe(completeAssistantToolUse)
    cap.observe(completeUserToolResult)
    cap.observe(resultEvent)

    const dir = tmpWorktree()
    const record = await cap.finalize(dir, Date.now() - 500)
    expect(record.steps.length).toBe(2)
    expect(record.steps[0]).toMatchObject({ role: 'assistant', tool: 'Edit' })
    expect(record.steps[1]).toMatchObject({ role: 'tool_result' })
    expect(record.num_turns).toBe(3)
    expect(record.stop_reason).toBe('end_turn')
    expect(record.is_error).toBe(false)
  })
})

describe('TrajectoryCapture — partial stream_event reconstruction (#343 fix)', () => {
  const partialToolTurn = [
    { type: 'stream_event', event: { type: 'message_start', message: { usage: {} } }, session_id: 's1', uuid: 'p1' },
    {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_x', name: 'mcp__zerodb__zerodb_create_table', input: {} },
      },
      session_id: 's1',
      uuid: 'p2',
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"table_name":' } },
      session_id: 's1',
      uuid: 'p3',
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"tasks"}' } },
      session_id: 's1',
      uuid: 'p4',
    },
  ]

  it('a run killed mid-turn still yields steps (the prod steps:[] bug)', async () => {
    const cap = new TrajectoryCapture('chat2', 'build a task app', 'us.anthropic.claude-sonnet-4-6')
    for (const e of partialToolTurn) cap.observe(e)
    // Killed: NO complete assistant event, result reports an error.
    cap.observe({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 1, stop_reason: 'max_budget_usd' })

    const record = await cap.finalize(tmpWorktree(), Date.now())
    expect(record.steps.length).toBe(1)
    expect(record.steps[0]).toMatchObject({
      role: 'assistant',
      tool: 'mcp__zerodb__zerodb_create_table',
      toolInput: { table_name: 'tasks' },
      partial: true,
    })
    expect(record.stop_reason).toBe('max_budget_usd')
    expect(record.is_error).toBe(true)
  })

  it('captures partial text deltas too', async () => {
    const cap = new TrajectoryCapture('chat3', 'x', 'm')
    cap.observe({ type: 'stream_event', event: { type: 'message_start', message: {} } })
    cap.observe({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'I will seed ' } } })
    cap.observe({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'the tasks table.' } } })
    const record = await cap.finalize(tmpWorktree(), Date.now())
    expect(record.steps.length).toBe(1)
    expect(record.steps[0]).toMatchObject({ role: 'assistant', text: 'I will seed the tasks table.', partial: true })
  })

  it('the complete assistant event SUPERSEDES its partials (no double-record)', async () => {
    const cap = new TrajectoryCapture('chat4', 'x', 'm')
    for (const e of partialToolTurn) cap.observe(e)
    // Message completed normally — complete event carries the same tool call.
    cap.observe({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_x', name: 'mcp__zerodb__zerodb_create_table', input: { table_name: 'tasks' } }],
      },
    })
    cap.observe(resultEvent)
    const record = await cap.finalize(tmpWorktree(), Date.now())
    expect(record.steps.length).toBe(1)
    expect(record.steps[0].partial).toBeUndefined()
    expect(record.steps[0].tool).toBe('mcp__zerodb__zerodb_create_table')
  })

  it('flushes an unparseable truncated tool input as a preview instead of dropping it', async () => {
    const cap = new TrajectoryCapture('chat5', 'x', 'm')
    cap.observe({ type: 'stream_event', event: { type: 'message_start', message: {} } })
    cap.observe({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 't', name: 'Write' } },
    })
    cap.observe({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_path":"/a.tsx","content":"trunca' } },
    })
    const record = await cap.finalize(tmpWorktree(), Date.now())
    expect(record.steps.length).toBe(1)
    expect(record.steps[0].tool).toBe('Write')
    expect((record.steps[0].toolInput as any)._truncated).toBe(true)
  })

  it('empty run (result only) still finalizes with steps:[] and a stop reason', async () => {
    const cap = new TrajectoryCapture('chat6', 'x', 'kimi-k2.6')
    cap.observe({ type: 'system', subtype: 'init' })
    cap.observe({ type: 'result', is_error: true, num_turns: 0, terminal_reason: 'error' })
    const record = await cap.finalize(tmpWorktree(), Date.now())
    expect(record.steps).toEqual([])
    expect(record.stop_reason).toBe('error')
  })
})
