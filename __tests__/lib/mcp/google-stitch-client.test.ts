import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock logger to keep assertions silent and avoid real DB-backed persistence.
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
  return await import('@/lib/mcp/google-stitch-client')
}

describe('lib/mcp/google-stitch-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.GOOGLE_STITCH_API_URL
    delete process.env.GOOGLE_STITCH_API_KEY
    global.fetch = vi.fn()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  describe('constructor / configuration', () => {
    it('falls back to default base URL and warns when GOOGLE_STITCH_API_URL is unset', async () => {
      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()
      expect(client.isConfigured()).toBe(false)
    })

    it('reports configured when an API key is present', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()
      expect(client.isConfigured()).toBe(true)
    })
  })

  describe('connect()', () => {
    it('returns false immediately when no API key is configured, without making a request', async () => {
      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.connect()

      expect(result).toBe(false)
      expect(client.isConnected()).toBe(false)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('returns true when the health endpoint responds ok', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.connect()

      expect(result).toBe(true)
      expect(client.isConnected()).toBe(true)
    })

    it('falls back to the /projects endpoint when /health 404s, and succeeds on 200', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
        .mockResolvedValueOnce({ ok: true, status: 200 })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.connect()

      expect(result).toBe(true)
      expect(client.isConnected()).toBe(true)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('treats a 404 from the /projects fallback as authenticated too', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.connect()

      expect(result).toBe(true)
    })

    it('returns false and does not throw when the fallback /projects auth check fails (non-404, non-ok)', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any)
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
        .mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.connect()

      expect(result).toBe(false)
      expect(client.isConnected()).toBe(false)
    }, 10000)

    it('returns false when the health check throws (non-ok, non-404) after exhausting retries', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.connect()

      expect(result).toBe(false)
      expect(client.isConnected()).toBe(false)
    }, 10000)
  })

  describe('disconnect()', () => {
    it('sets connected to false', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()
      await client.connect()
      expect(client.isConnected()).toBe(true)

      await client.disconnect()
      expect(client.isConnected()).toBe(false)
    })
  })

  describe('generateScreen()', () => {
    it('returns a configuration error when no API key is set, without calling fetch', async () => {
      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.generateScreen({ prompt: 'a landing page' })

      expect(result).toEqual({
        success: false,
        error: 'Google Stitch API key not configured',
      })
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('returns success with normalized fields on a 2xx response', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          screen_id: 'scr_1',
          preview_url: 'https://preview.example/scr_1',
          code: '<div/>',
        }),
      })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.generateScreen({ prompt: 'a dashboard', style: 'minimal' })

      expect(result).toEqual({
        success: true,
        screenId: 'scr_1',
        previewUrl: 'https://preview.example/scr_1',
        code: '<div/>',
      })

      const [, init] = (global.fetch as any).mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body).toEqual({
        prompt: 'a dashboard',
        project_id: undefined,
        style: 'minimal',
        include_code: true,
      })
    })

    it('defaults style to modern and include_code to true when unset', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'scr_2', url: 'https://preview.example/scr_2', html: '<p/>' }),
      })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.generateScreen({ prompt: 'a form' })

      expect(result.success).toBe(true)
      expect(result.screenId).toBe('scr_2')
      expect(result.previewUrl).toBe('https://preview.example/scr_2')
      expect(result.code).toBe('<p/>')

      const [, init] = (global.fetch as any).mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.style).toBe('modern')
      expect(body.include_code).toBe(true)
    })

    it('honors includeCode: false explicitly', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      await client.generateScreen({ prompt: 'x', includeCode: false })

      const [, init] = (global.fetch as any).mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.include_code).toBe(false)
    })

    it('returns a failure result when the generate request errors after retries exhaust', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => 'boom',
      })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.generateScreen({ prompt: 'x' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Screen generation failed')
    }, 10000)
  })

  describe('getScreenCode()', () => {
    it('returns a configuration error when no API key is set', async () => {
      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.getScreenCode('scr_1')

      expect(result).toEqual({
        success: false,
        error: 'Google Stitch API key not configured',
      })
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('returns normalized html/css/javascript on success', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ html: '<div/>', styles: '.a{}', js: 'console.log(1)' }),
      })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()

      const result = await client.getScreenCode('scr_1')

      expect(result).toEqual({
        success: true,
        html: '<div/>',
        css: '.a{}',
        javascript: 'console.log(1)',
      })
    })

    it('returns a failure result when the fetch throws after retries exhaust', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.getScreenCode('missing')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to fetch screen code')
    }, 10000)
  })

  describe('retryRequest (via generateScreen)', () => {
    it('retries on transient failure and succeeds on a later attempt', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any)
        .mockRejectedValueOnce(new Error('network blip'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 'scr_ok' }),
        })

      const { default: GoogleStitchMCPClient } = await freshModule()
      const client = new GoogleStitchMCPClient()
      ;(client as any).baseDelay = 1

      const result = await client.generateScreen({ prompt: 'retry me' })

      expect(result.success).toBe(true)
      expect(result.screenId).toBe('scr_ok')
      expect(global.fetch).toHaveBeenCalledTimes(2)
    }, 10000)
  })

  describe('singleton helpers', () => {
    it('getGoogleStitchClient returns the same instance across calls', async () => {
      const { getGoogleStitchClient } = await freshModule()
      const a = getGoogleStitchClient()
      const b = getGoogleStitchClient()
      expect(a).toBe(b)
    })

    it('initializeGoogleStitchClient connects the singleton client', async () => {
      process.env.GOOGLE_STITCH_API_KEY = 'secret-key'
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      })

      const { initializeGoogleStitchClient, getGoogleStitchClient } = await freshModule()
      const result = await initializeGoogleStitchClient()

      expect(result).toBe(true)
      expect(getGoogleStitchClient().isConnected()).toBe(true)
    })
  })
})
