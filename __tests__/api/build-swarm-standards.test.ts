/**
 * #71 — the integrity piece: POST /api/build/swarm injects the canonical
 * AINative engineering standards into the codegen/swarm task the build agents
 * receive (NOT display-only).
 *
 * Properties under test (network + auth MOCKED):
 *   - a paid-tier dispatch prepends the standards block to the `description` sent
 *     to the platform agent-swarm, while keeping the original task,
 *   - injection is idempotent (a description already carrying the block isn't
 *     double-injected),
 *   - non-paid tiers short-circuit (no platform call) — still honest.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { codingStandardsContextBlock } from '@/lib/build/coding-standards'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlanStatus: vi.fn(),
  createTask: vi.fn(),
  stageFromSwarmStatus: vi.fn(() => 'building'),
  deriveOwnerKey: vi.fn(() => 'owner'),
  chatScopeKey: vi.fn(() => 'scope'),
  fetch: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
vi.mock('@/lib/build/task-store', () => ({
  createTask: h.createTask,
  stageFromSwarmStatus: h.stageFromSwarmStatus,
}))
vi.mock('@/lib/build/chat-store', () => ({
  deriveOwnerKey: h.deriveOwnerKey,
  chatScopeKey: h.chatScopeKey,
}))

import { POST } from '@/app/api/build/swarm/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  h.auth.mockReset()
  h.getPlanStatus.mockReset()
  h.createTask.mockReset().mockResolvedValue(undefined)
  h.fetch.mockReset()
  vi.stubGlobal('fetch', h.fetch)
})

describe('POST /api/build/swarm — standards injection (#71)', () => {
  it('prepends the canonical standards to the description sent to the platform swarm', async () => {
    h.auth.mockResolvedValue({ accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise' })
    h.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 'task-123', status: 'queued' }),
    })

    const res = await POST(req({ description: 'Build the MVP for: a dog grooming app', chatId: 'co-1' }))
    const data = await res.json()
    expect(data.real).toBe(true)

    // the platform received the standards block + the original task
    expect(h.fetch).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(h.fetch.mock.calls[0][1].body)
    expect(sent.description).toContain(codingStandardsContextBlock())
    expect(sent.description).toContain('Build the MVP for: a dog grooming app')
    expect(sent.description).toContain('AINATIVE ENGINEERING STANDARDS')
  })

  it('records the UI task with the RAW description (no standards pollution)', async () => {
    h.auth.mockResolvedValue({ accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    h.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't', status: 'queued' }),
    })

    await POST(req({ description: 'Ship the /ask endpoint', chatId: 'co-2' }))
    expect(h.createTask).toHaveBeenCalledTimes(1)
    const taskArg = h.createTask.mock.calls[0][1]
    expect(taskArg.detail).toBe('Ship the /ask endpoint')
    expect(taskArg.detail).not.toContain('AINATIVE ENGINEERING STANDARDS')
    expect(taskArg.title).toBe('Ship the /ask endpoint')
  })

  it('is idempotent — does not double-inject when the block is already present', async () => {
    h.auth.mockResolvedValue({ accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'enterprise' })
    h.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't', status: 'queued' }),
    })

    const already = `${codingStandardsContextBlock()}\n\n---\n\nTASK:\nprebuilt`
    await POST(req({ description: already }))
    const sent = JSON.parse(h.fetch.mock.calls[0][1].body)
    // header appears exactly once
    const occurrences = sent.description.split('AINATIVE ENGINEERING STANDARDS').length - 1
    expect(occurrences).toBe(1)
  })

  it('non-paid tiers short-circuit and never call the platform', async () => {
    h.auth.mockResolvedValue({ accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })

    const res = await POST(req({ description: 'anything' }))
    const data = await res.json()
    expect(data.real).toBe(false)
    expect(data.reason).toBe('tier')
    expect(h.fetch).not.toHaveBeenCalled()
  })
})
