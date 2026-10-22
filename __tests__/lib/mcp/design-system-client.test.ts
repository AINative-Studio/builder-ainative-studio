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
  return await import('@/lib/mcp/design-system-client')
}

const sampleTokens = {
  light: {
    colors: { primary: '#000', secondary: '#fff' },
    typography: { fontFamily: 'Inter', sizes: {} },
    spacing: { baseUnit: '4px', scale: [1, 2, 4] },
  },
}

describe('lib/mcp/design-system-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.DESIGN_SYSTEM_MCP_URL
    delete process.env.DESIGN_SYSTEM_MCP_API_KEY
    global.fetch = vi.fn()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  describe('constructor / configuration', () => {
    it('falls back to localhost default URL and a default API key when unset', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      await client.connect()

      const [url, init] = (global.fetch as any).mock.calls[0]
      expect(url).toBe('http://localhost:8001/health')
      expect(init.headers.Authorization).toBe('Bearer ds_mcp_secret_key')
    })

    it('uses configured DESIGN_SYSTEM_MCP_URL and API key', async () => {
      process.env.DESIGN_SYSTEM_MCP_URL = 'https://design.example/extract'
      process.env.DESIGN_SYSTEM_MCP_API_KEY = 'custom-key'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      await client.connect()

      const [url, init] = (global.fetch as any).mock.calls[0]
      expect(url).toBe('https://design.example/health')
      expect(init.headers.Authorization).toBe('Bearer custom-key')
    })
  })

  describe('connect()', () => {
    it('returns true and sets connected on a healthy response', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'ok' }) })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()

      const result = await client.connect()

      expect(result).toBe(true)
      expect(client.isConnected()).toBe(true)
    })

    it('returns false after retries exhaust on a failing health check', async () => {
      ;(global.fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.connect()

      expect(result).toBe(false)
      expect(client.isConnected()).toBe(false)
    }, 10000)
  })

  describe('disconnect()', () => {
    it('clears the connected flag', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      await client.connect()
      expect(client.isConnected()).toBe(true)

      await client.disconnect()
      expect(client.isConnected()).toBe(false)
    })
  })

  describe('extractTokens()', () => {
    it('auto-connects when not yet connected, then extracts tokens on success', async () => {
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // auto connect health check
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleTokens })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      expect(client.isConnected()).toBe(false)

      const result = await client.extractTokens('<div/>')

      expect(result).toEqual(sampleTokens)
      expect(client.isConnected()).toBe(true)
    })

    it('returns null when auto-connect fails, without attempting the extract call', async () => {
      ;(global.fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.extractTokens('<div/>')

      expect(result).toBeNull()
    }, 10000)

    it('posts templateCode and extractDarkMode in the request body', async () => {
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleTokens })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      await client.connect()

      await client.extractTokens('<div/>', false)

      const [, init] = (global.fetch as any).mock.calls[1]
      expect(JSON.parse(init.body)).toEqual({ templateCode: '<div/>', extractDarkMode: false })
    })

    it('defaults extractDarkMode to true when omitted', async () => {
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleTokens })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      await client.connect()

      await client.extractTokens('<div/>')

      const [, init] = (global.fetch as any).mock.calls[1]
      expect(JSON.parse(init.body).extractDarkMode).toBe(true)
    })

    it('returns null when the extraction request fails after retries exhaust', async () => {
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.extractTokens('<div/>')

      expect(result).toBeNull()
    }, 10000)
  })

  describe('validateTokens()', () => {
    it('auto-connects, then validates tokens on success', async () => {
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: true }) })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()

      const result = await client.validateTokens(sampleTokens as any)

      expect(result).toEqual({ valid: true })
    })

    it('returns a not-connected error result when auto-connect fails', async () => {
      ;(global.fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.validateTokens(sampleTokens as any)

      expect(result).toEqual({ valid: false, errors: ['MCP client not connected'] })
    }, 10000)

    it('returns a validation-request-failed error when the validate call fails after retries exhaust', async () => {
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.validateTokens(sampleTokens as any)

      expect(result).toEqual({ valid: false, errors: ['Validation request failed'] })
    }, 10000)

    it('posts the tokens wrapped in a tokens field', async () => {
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: false, errors: ['bad'] }) })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      await client.connect()

      await client.validateTokens(sampleTokens as any)

      const [, init] = (global.fetch as any).mock.calls[1]
      expect(JSON.parse(init.body)).toEqual({ tokens: sampleTokens })
    })
  })

  describe('getBaseEndpoint (via connect URL)', () => {
    it('strips a trailing /extract suffix from the configured base URL', async () => {
      process.env.DESIGN_SYSTEM_MCP_URL = 'https://design.example/extract'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      await client.connect()

      const [url] = (global.fetch as any).mock.calls[0]
      expect(url).toBe('https://design.example/health')
    })

    it('leaves a base URL without /extract unchanged', async () => {
      process.env.DESIGN_SYSTEM_MCP_URL = 'https://design.example/api'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      await client.connect()

      const [url] = (global.fetch as any).mock.calls[0]
      expect(url).toBe('https://design.example/api/health')
    })
  })

  describe('retryRequest (via extractTokens)', () => {
    it('retries on transient failure and succeeds on a later attempt', async () => {
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // connect
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleTokens })

      const { default: DesignSystemMCPClient } = await freshModule()
      const client = new DesignSystemMCPClient()
      ;(client as any).baseDelay = 1
      await client.connect()

      const result = await client.extractTokens('<div/>')

      expect(result).toEqual(sampleTokens)
      expect(global.fetch).toHaveBeenCalledTimes(3)
    }, 10000)
  })

  describe('singleton helpers', () => {
    it('getMCPClient returns the same instance across calls', async () => {
      const { getMCPClient } = await freshModule()
      expect(getMCPClient()).toBe(getMCPClient())
    })

    it('initializeMCPClient connects the singleton', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { initializeMCPClient, getMCPClient } = await freshModule()
      const result = await initializeMCPClient()

      expect(result).toBe(true)
      expect(getMCPClient().isConnected()).toBe(true)
    })
  })
})
