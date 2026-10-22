import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { storeTrajectory } from '@/lib/agent/trajectory-store'
import { AINATIVE_API_BASE_URL } from '@/lib/constants'
import type { TrajectoryRecord } from '@/lib/agent/trajectory-capture'

const ENV_KEYS = ['ZERODB_API_TOKEN', 'AINATIVE_API_KEY', 'ANTHROPIC_API_KEY', 'ZERODB_PROJECT_ID'] as const

let savedEnv: Record<string, string | undefined>

function clearTokenEnv() {
  delete process.env.ZERODB_API_TOKEN
  delete process.env.AINATIVE_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ZERODB_PROJECT_ID
}

function makeRecord(overrides: Partial<TrajectoryRecord> = {}): TrajectoryRecord {
  return {
    traj_id: 'traj-123',
    parent_traj: null,
    parent_step: null,
    node_role: 'root',
    chat_id: 'chat-abc',
    task: 'Build a todo app',
    model: 'claude-sonnet',
    num_turns: 5,
    total_cost_usd: 0.42,
    duration_ms: 12345,
    is_error: false,
    stop_reason: 'end_turn',
    verify: {
      installed: true,
      built: true,
      ran: true,
      httpOk: true,
      reward: 1,
      detail: 'app builds and serves 200',
    },
    file_tree: ['app/page.tsx', 'app/layout.tsx'],
    steps: [{ turn: 1, role: 'assistant', text: 'doing work' }],
    created_at: '2026-10-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('storeTrajectory', () => {
  beforeEach(() => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    clearTokenEnv()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns false and never calls fetch when no token env var is set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await storeTrajectory(makeRecord())

    expect(result).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('[Trajectory] no ZeroDB token — skipping capture')
  })

  it('resolves token precedence: ZERODB_API_TOKEN first', async () => {
    process.env.ZERODB_API_TOKEN = 'zerodb-token'
    process.env.AINATIVE_API_KEY = 'ainative-key'
    process.env.ANTHROPIC_API_KEY = 'anthropic-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await storeTrajectory(makeRecord())

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer zerodb-token')
  })

  it('falls back to AINATIVE_API_KEY when ZERODB_API_TOKEN is unset', async () => {
    process.env.AINATIVE_API_KEY = 'ainative-key'
    process.env.ANTHROPIC_API_KEY = 'anthropic-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await storeTrajectory(makeRecord())

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer ainative-key')
  })

  it('falls back to ANTHROPIC_API_KEY when the other two are unset', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await storeTrajectory(makeRecord())

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer anthropic-key')
  })

  it('uses the default project id when ZERODB_PROJECT_ID is unset', async () => {
    process.env.ZERODB_API_TOKEN = 'tok'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await storeTrajectory(makeRecord())

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `${AINATIVE_API_BASE_URL}/api/v1/projects/5dfbc60c-7463-4e21-ac68-9bbe536f9adf/database/tables/cody_trajectories/rows`,
    )
  })

  it('uses ZERODB_PROJECT_ID when set', async () => {
    process.env.ZERODB_API_TOKEN = 'tok'
    process.env.ZERODB_PROJECT_ID = 'custom-project-id'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await storeTrajectory(makeRecord())

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `${AINATIVE_API_BASE_URL}/api/v1/projects/custom-project-id/database/tables/cody_trajectories/rows`,
    )
  })

  it('calls fetch with the expected method, headers, and JSON body shape', async () => {
    process.env.ZERODB_API_TOKEN = 'tok'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const record = makeRecord()
    await storeTrajectory(record)

    expect(fetchMock).toHaveBeenCalledWith(
      `${AINATIVE_API_BASE_URL}/api/v1/projects/5dfbc60c-7463-4e21-ac68-9bbe536f9adf/database/tables/cody_trajectories/rows`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        }),
      }),
    )

    const [, options] = fetchMock.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.row_data).toEqual({
      traj_id: record.traj_id,
      parent_traj: record.parent_traj,
      parent_step: record.parent_step,
      node_role: record.node_role,
      chat_id: record.chat_id,
      task: record.task,
      model: record.model,
      num_turns: record.num_turns,
      total_cost_usd: record.total_cost_usd,
      duration_ms: record.duration_ms,
      is_error: record.is_error,
      stop_reason: record.stop_reason,
      reward: record.verify.reward,
      verify_installed: record.verify.installed,
      verify_built: record.verify.built,
      verify_detail: record.verify.detail,
      file_count: record.file_tree.length,
      file_tree: JSON.stringify(record.file_tree),
      steps: JSON.stringify(record.steps),
      created_at: record.created_at,
    })
  })

  it('returns true and logs on a successful (ok) response', async () => {
    process.env.ZERODB_API_TOKEN = 'tok'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const result = await storeTrajectory(makeRecord())

    expect(result).toBe(true)
    expect(console.log).toHaveBeenCalled()
  })

  it('returns false and warns with HTTP status when response is not ok', async () => {
    process.env.ZERODB_API_TOKEN = 'tok'
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await storeTrajectory(makeRecord())

    expect(result).toBe(false)
    expect(console.warn).toHaveBeenCalledWith('[Trajectory] store failed: HTTP 500')
  })

  it('returns false and warns with the error message when fetch rejects with an Error', async () => {
    process.env.ZERODB_API_TOKEN = 'tok'
    const err = new Error('network down')
    const fetchMock = vi.fn().mockRejectedValue(err)
    vi.stubGlobal('fetch', fetchMock)

    const result = await storeTrajectory(makeRecord())

    expect(result).toBe(false)
    expect(console.warn).toHaveBeenCalledWith('[Trajectory] store error:', 'network down')
  })

  it('returns false and warns with the raw value when fetch rejects with a non-Error', async () => {
    process.env.ZERODB_API_TOKEN = 'tok'
    const fetchMock = vi.fn().mockRejectedValue('plain string rejection')
    vi.stubGlobal('fetch', fetchMock)

    const result = await storeTrajectory(makeRecord())

    expect(result).toBe(false)
    expect(console.warn).toHaveBeenCalledWith('[Trajectory] store error:', 'plain string rejection')
  })

  it('never throws even when fetch rejects', async () => {
    process.env.ZERODB_API_TOKEN = 'tok'
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(storeTrajectory(makeRecord())).resolves.toBe(false)
  })
})
