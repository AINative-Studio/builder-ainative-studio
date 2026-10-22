import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 3) — the command-palette CRUD/execute/favorite routes
 * had zero route-level coverage: GET+POST /api/commands, GET /api/commands/
 * recent, GET+PUT+DELETE /api/commands/[commandId], POST .../execute and
 * .../favorite. All five files call `getCommandService()`; the service
 * itself is already unit-tested elsewhere, so here it's mocked at the
 * boundary and these tests focus on the route's own auth gating, ownership
 * checks, and status-code mapping.
 */

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: auth.auth }))

const service = vi.hoisted(() => ({
  searchCommands: vi.fn(),
  createCommand: vi.fn(),
  getRecentCommands: vi.fn(),
  getCommand: vi.fn(),
  updateCommand: vi.fn(),
  deleteCommand: vi.fn(),
  validateVariables: vi.fn(),
  executeCommand: vi.fn(),
  toggleFavorite: vi.fn(),
}))

vi.mock('@/lib/services/agent-command.service', () => ({
  getCommandService: () => service,
}))

import { mockGetRequest, mockJsonRequest, mockParams } from '../helpers/api-route-harness'

const session = { user: { id: 'user-1', email: 'founder@example.com' } }

beforeEach(() => {
  vi.clearAllMocks()
  auth.auth.mockResolvedValue(session)
})

describe('#1202 GET /api/commands', () => {
  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/commands/route')

    const res = await GET(mockGetRequest('http://localhost/api/commands'))

    expect(res.status).toBe(401)
  })

  it('searches commands with parsed query params', async () => {
    service.searchCommands.mockResolvedValue({ commands: [{ id: 'c1' }], total: 1 })
    const { GET } = await import('@/app/api/commands/route')

    const res = await GET(
      mockGetRequest(
        'http://localhost/api/commands?query=deploy&builtInOnly=true&tags=a,b&limit=5&offset=10'
      )
    )

    expect(res.status).toBe(200)
    expect(service.searchCommands).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ query: 'deploy', builtInOnly: true, limit: 5, offset: 10 })
    )
  })

  it('returns 500 when the service throws', async () => {
    service.searchCommands.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/commands/route')

    const res = await GET(mockGetRequest('http://localhost/api/commands'))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/commands', () => {
  const validBody = { name: 'Deploy', description: 'Deploys the app', template: 'do the thing' }

  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/commands/route')

    const res = await POST(mockJsonRequest('http://localhost/api/commands', validBody))

    expect(res.status).toBe(401)
  })

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('@/app/api/commands/route')

    const res = await POST(mockJsonRequest('http://localhost/api/commands', { name: 'Deploy' }))

    expect(res.status).toBe(400)
  })

  it('creates a command and returns 201', async () => {
    service.createCommand.mockResolvedValue({ id: 'c1', ...validBody })
    const { POST } = await import('@/app/api/commands/route')

    const res = await POST(mockJsonRequest('http://localhost/api/commands', validBody))

    expect(res.status).toBe(201)
    expect(service.createCommand).toHaveBeenCalled()
  })

  it('returns 500 when creation throws', async () => {
    service.createCommand.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/commands/route')

    const res = await POST(mockJsonRequest('http://localhost/api/commands', validBody))

    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/commands/recent', () => {
  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/commands/recent/route')

    const res = await GET(mockGetRequest('http://localhost/api/commands/recent'))

    expect(res.status).toBe(401)
  })

  it('returns recent commands with the default limit', async () => {
    service.getRecentCommands.mockResolvedValue([{ id: 'c1' }])
    const { GET } = await import('@/app/api/commands/recent/route')

    const res = await GET(mockGetRequest('http://localhost/api/commands/recent'))

    expect(res.status).toBe(200)
    expect(service.getRecentCommands).toHaveBeenCalledWith('user-1', 10)
  })

  it('returns 500 when the service throws', async () => {
    service.getRecentCommands.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/commands/recent/route')

    const res = await GET(mockGetRequest('http://localhost/api/commands/recent'))

    expect(res.status).toBe(500)
  })
})

const builtInCommand = {
  metadata: { author: { id: 'other-user' }, isBuiltIn: true },
}
const ownedCommand = {
  metadata: { author: { id: 'user-1' }, isBuiltIn: false },
}
const foreignCommand = {
  metadata: { author: { id: 'other-user' }, isBuiltIn: false },
}

describe('#1202 GET /api/commands/[commandId]', () => {
  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/commands/[commandId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 404 when the command does not exist', async () => {
    service.getCommand.mockResolvedValue(null)
    const { GET } = await import('@/app/api/commands/[commandId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns the command when found', async () => {
    service.getCommand.mockResolvedValue({ id: 'c1', ...ownedCommand })
    const { GET } = await import('@/app/api/commands/[commandId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(200)
  })

  it('returns 500 when the service throws', async () => {
    service.getCommand.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/commands/[commandId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 PUT /api/commands/[commandId]', () => {
  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { PUT } = await import('@/app/api/commands/[commandId]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/commands/c1', { name: 'New' }, { method: 'PUT' }),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 404 when the command does not exist', async () => {
    service.getCommand.mockResolvedValue(null)
    const { PUT } = await import('@/app/api/commands/[commandId]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/commands/c1', { name: 'New' }, { method: 'PUT' }),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 when the requester does not own a non-built-in command', async () => {
    service.getCommand.mockResolvedValue(foreignCommand)
    const { PUT } = await import('@/app/api/commands/[commandId]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/commands/c1', { name: 'New' }, { method: 'PUT' }),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(403)
  })

  it('updates the command when the requester owns it', async () => {
    service.getCommand.mockResolvedValue(ownedCommand)
    service.updateCommand.mockResolvedValue({ ...ownedCommand, name: 'New' })
    const { PUT } = await import('@/app/api/commands/[commandId]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/commands/c1', { name: 'New' }, { method: 'PUT' }),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(200)
  })

  it('returns 500 when the update throws', async () => {
    service.getCommand.mockResolvedValue(ownedCommand)
    service.updateCommand.mockRejectedValue(new Error('boom'))
    const { PUT } = await import('@/app/api/commands/[commandId]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/commands/c1', { name: 'New' }, { method: 'PUT' }),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 DELETE /api/commands/[commandId]', () => {
  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { DELETE } = await import('@/app/api/commands/[commandId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 404 when the command does not exist', async () => {
    service.getCommand.mockResolvedValue(null)
    const { DELETE } = await import('@/app/api/commands/[commandId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 when the requester does not own a non-built-in command', async () => {
    service.getCommand.mockResolvedValue(foreignCommand)
    const { DELETE } = await import('@/app/api/commands/[commandId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(403)
  })

  it('returns 403 when trying to delete a built-in command even as the "owner"', async () => {
    service.getCommand.mockResolvedValue({ metadata: { author: { id: 'user-1' }, isBuiltIn: true } })
    const { DELETE } = await import('@/app/api/commands/[commandId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(403)
  })

  it('deletes the command when owned and not built-in', async () => {
    service.getCommand.mockResolvedValue(ownedCommand)
    service.deleteCommand.mockResolvedValue(undefined)
    const { DELETE } = await import('@/app/api/commands/[commandId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 500 when the service throws', async () => {
    service.getCommand.mockRejectedValue(new Error('boom'))
    const { DELETE } = await import('@/app/api/commands/[commandId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/commands/c1'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/commands/[commandId]/execute', () => {
  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/commands/[commandId]/execute/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/commands/c1/execute', {}),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 404 when the command does not exist', async () => {
    service.getCommand.mockResolvedValue(null)
    const { POST } = await import('@/app/api/commands/[commandId]/execute/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/commands/c1/execute', {}),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 400 when variable validation fails', async () => {
    service.getCommand.mockResolvedValue({ variables: [{ name: 'target' }] })
    service.validateVariables.mockReturnValue({ valid: false, errors: ['target is required'] })
    const { POST } = await import('@/app/api/commands/[commandId]/execute/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/commands/c1/execute', { variableValues: {} }),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(400)
  })

  it('executes the command and returns the execution state on success', async () => {
    service.getCommand.mockResolvedValue({ variables: [] })
    service.validateVariables.mockReturnValue({ valid: true, errors: [] })
    service.executeCommand.mockResolvedValue({ status: 'completed' })
    const { POST } = await import('@/app/api/commands/[commandId]/execute/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/commands/c1/execute', {
        variableValues: {},
        chatId: 'chat-1',
      }),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('completed')
  })

  it('returns 500 with the error message when execution throws', async () => {
    service.getCommand.mockRejectedValue(new Error('execution engine down'))
    const { POST } = await import('@/app/api/commands/[commandId]/execute/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/commands/c1/execute', {}),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.message).toBe('execution engine down')
  })
})

describe('#1202 POST /api/commands/[commandId]/favorite', () => {
  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/commands/[commandId]/favorite/route')

    const res = await POST(
      mockGetRequest('http://localhost/api/commands/c1/favorite'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(401)
  })

  it('toggles favorite status and returns the new state', async () => {
    service.toggleFavorite.mockResolvedValue(true)
    const { POST } = await import('@/app/api/commands/[commandId]/favorite/route')

    const res = await POST(
      mockGetRequest('http://localhost/api/commands/c1/favorite'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isFavorite).toBe(true)
  })

  it('returns 500 when toggling throws', async () => {
    service.toggleFavorite.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/commands/[commandId]/favorite/route')

    const res = await POST(
      mockGetRequest('http://localhost/api/commands/c1/favorite'),
      mockParams({ commandId: 'c1' })
    )

    expect(res.status).toBe(500)
  })
})
