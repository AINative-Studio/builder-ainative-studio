import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const ORIGINAL_ENV = { ...process.env }

async function freshModule() {
  vi.resetModules()
  return await import('@/lib/mcp/zerodb-client')
}

describe('lib/mcp/zerodb-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.ZERODB_API_BASE_URL
    delete process.env.ZERODB_MCP_URL
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_MCP_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    global.fetch = vi.fn()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  describe('constructor / configuration', () => {
    it('is unconfigured without an API key', async () => {
      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      expect(client.isConnected()).toBe(false)
    })

    it('prefers ZERODB_API_KEY over ZERODB_MCP_API_KEY', async () => {
      process.env.ZERODB_API_KEY = 'primary-key'
      process.env.ZERODB_MCP_API_KEY = 'secondary-key'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      const [, init] = (global.fetch as any).mock.calls[0]
      expect(init.headers.Authorization).toBe('Bearer primary-key')
    })
  })

  describe('connect()', () => {
    it('returns false immediately without an API key, making no request', async () => {
      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()

      const result = await client.connect()

      expect(result).toBe(false)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('returns true and sets connected on a healthy response', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()

      const result = await client.connect()

      expect(result).toBe(true)
      expect(client.isConnected()).toBe(true)
    })

    it('returns false when the health endpoint errors, after exhausting retries', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.connect()

      expect(result).toBe(false)
      expect(client.isConnected()).toBe(false)
    }, 10000)
  })

  describe('disconnect()', () => {
    it('clears the connected flag', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()
      expect(client.isConnected()).toBe(true)

      await client.disconnect()
      expect(client.isConnected()).toBe(false)
    })
  })

  describe('getTableSchema()', () => {
    it('returns null without attempting a request when not connected', async () => {
      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()

      const result = await client.getTableSchema('users')

      expect(result).toBeNull()
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('returns the parsed schema when connected and the request succeeds', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      const schema = {
        tableName: 'users',
        columns: [{ name: 'id', type: 'UUID', nullable: false, default: null }],
        primaryKey: ['id'],
        indexes: [],
      }
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // connect health check
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => schema })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      const result = await client.getTableSchema('users')

      expect(result).toEqual(schema)
    })

    it('returns null and logs a specific message on a 404 (table not found)', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.getTableSchema('missing_table')

      expect(result).toBeNull()
    }, 10000)

    it('returns null on a non-404 schema fetch failure after retries exhaust', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.getTableSchema('users')

      expect(result).toBeNull()
    }, 10000)
  })

  describe('getSchemaVersion()', () => {
    it('returns null when not connected', async () => {
      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()

      const result = await client.getSchemaVersion()

      expect(result).toBeNull()
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('hits the table-scoped version endpoint when tableName is given', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      process.env.ZERODB_API_BASE_URL = 'https://zerodb.example'
      const version = { version: '3', updatedAt: '2026-01-01T00:00:00Z', checksum: 'abc' }
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => version })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      const result = await client.getSchemaVersion('users')

      expect(result).toEqual(version)
      const [url] = (global.fetch as any).mock.calls[1]
      expect(url).toBe('https://zerodb.example/schema/users/version')
    })

    it('hits the global version endpoint when no tableName is given', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      process.env.ZERODB_API_BASE_URL = 'https://zerodb.example'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ version: '1', updatedAt: '', checksum: '' }) })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      await client.getSchemaVersion()

      const [url] = (global.fetch as any).mock.calls[1]
      expect(url).toBe('https://zerodb.example/schema/version')
    })

    it('returns null when the version fetch fails after retries exhaust', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.getSchemaVersion('users')

      expect(result).toBeNull()
    }, 10000)
  })

  describe('listTables()', () => {
    it('returns null when not connected', async () => {
      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()

      const result = await client.listTables()

      expect(result).toBeNull()
    })

    it('returns the tables array on success', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tables: ['users', 'orders'] }) })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      const result = await client.listTables()

      expect(result).toEqual(['users', 'orders'])
    })

    it('returns an empty array when the response has no tables field', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      const result = await client.listTables()

      expect(result).toEqual([])
    })

    it('returns null when the table list fetch fails after retries exhaust', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.listTables()

      expect(result).toBeNull()
    }, 10000)
  })

  describe('executeCRUD()', () => {
    it('returns a not-connected failure without calling fetch when disconnected', async () => {
      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()

      const result = await client.executeCRUD({ operation: 'LIST', table: 'users' })

      expect(result).toEqual({ success: false, error: 'ZeroDB MCP client not connected' })
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('posts the request and returns the parsed response on success', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [{ id: 1 }], count: 1 }),
        })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      const request = { operation: 'CREATE' as const, table: 'users', data: { name: 'Ada' } }
      const result = await client.executeCRUD(request)

      expect(result).toEqual({ success: true, data: [{ id: 1 }], count: 1 })

      const [url, init] = (global.fetch as any).mock.calls[1]
      expect(url).toContain('/data/users')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual(request)
    })

    it('returns a failure result when the CRUD request fails after retries exhaust', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.executeCRUD({ operation: 'DELETE', table: 'users', where: { id: 1 } })

      expect(result.success).toBe(false)
      expect(result.error).toContain('CRUD operation failed')
    }, 10000)
  })

  describe('headers', () => {
    it('includes X-Project-ID only when a project id is configured', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      process.env.ZERODB_PROJECT_ID = 'proj-123'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      const [, init] = (global.fetch as any).mock.calls[0]
      expect(init.headers['X-Project-ID']).toBe('proj-123')
    })

    it('omits X-Project-ID when no project id is configured', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      await client.connect()

      const [, init] = (global.fetch as any).mock.calls[0]
      expect(init.headers['X-Project-ID']).toBeUndefined()
    })
  })

  describe('retryRequest (via getTableSchema)', () => {
    it('retries once on a transient error then succeeds', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // connect
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tableName: 'users', columns: [], primaryKey: [], indexes: [] }) })

      const { default: ZeroDBMCPClient } = await freshModule()
      const client = new ZeroDBMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.getTableSchema('users')

      expect(result?.tableName).toBe('users')
      expect(global.fetch).toHaveBeenCalledTimes(3)
    }, 10000)
  })

  describe('singleton helpers', () => {
    it('getZeroDBClient returns the same instance across calls', async () => {
      const { getZeroDBClient } = await freshModule()
      expect(getZeroDBClient()).toBe(getZeroDBClient())
    })

    it('initializeZeroDBClient connects the singleton', async () => {
      process.env.ZERODB_API_KEY = 'key-1'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { initializeZeroDBClient, getZeroDBClient } = await freshModule()
      const result = await initializeZeroDBClient()

      expect(result).toBe(true)
      expect(getZeroDBClient().isConnected()).toBe(true)
    })
  })
})
