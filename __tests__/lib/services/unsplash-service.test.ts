import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/services/unsplash.service.ts had zero test coverage. The module
 * initializes its Unsplash client at import time based on env vars, so each
 * "configured" vs "not configured" scenario needs vi.resetModules() + a
 * fresh dynamic import. The real unsplash-js client is mocked — no network
 * calls — and console output is silenced rather than asserted on, since it's
 * incidental logging, not the behavior under test.
 */

const ORIGINAL_ENV = { ...process.env }

const mockGetPhotos = vi.fn()
const mockTrackDownload = vi.fn()

vi.mock('unsplash-js', () => ({
  createApi: vi.fn(() => ({
    search: { getPhotos: mockGetPhotos },
    photos: { trackDownload: mockTrackDownload },
  })),
}))

describe('#1201 lib/services/unsplash.service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  describe('fetchContextualImages — not configured', () => {
    it('returns an empty array without calling the API when UNSPLASH_ACCESS_KEY is unset', async () => {
      delete process.env.UNSPLASH_ACCESS_KEY
      const { fetchContextualImages } = await import('@/lib/services/unsplash.service')

      const result = await fetchContextualImages('a landing page')

      expect(result).toEqual([])
      expect(mockGetPhotos).not.toHaveBeenCalled()
    })

    it('treats the literal placeholder key value as unconfigured', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'YOUR_UNSPLASH_ACCESS_KEY_HERE'
      const { fetchContextualImages } = await import('@/lib/services/unsplash.service')

      const result = await fetchContextualImages('a dashboard')
      expect(result).toEqual([])
    })
  })

  describe('fetchContextualImages — configured', () => {
    beforeEach(() => {
      process.env.UNSPLASH_ACCESS_KEY = 'real-key-123'
    })

    it('fetches photos using a keyword matched from the prompt and maps the response shape', async () => {
      mockGetPhotos.mockResolvedValue({
        type: 'success',
        response: {
          results: [
            {
              urls: { regular: 'https://images.example/1.jpg' },
              user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane' } },
              links: { download_location: 'https://api.example/download/1' },
            },
          ],
        },
      })
      mockTrackDownload.mockResolvedValue(undefined)

      const { fetchContextualImages } = await import('@/lib/services/unsplash.service')
      const result = await fetchContextualImages('build me a dashboard', 1)

      expect(result).toEqual([
        {
          url: 'https://images.example/1.jpg',
          photographer: 'Jane Doe',
          photographerUrl: 'https://unsplash.com/@jane',
          downloadUrl: 'https://api.example/download/1',
        },
      ])
      expect(mockGetPhotos).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'data', page: 1, perPage: 1, orientation: 'landscape' })
      )
    })

    it('falls back to generic keywords when the prompt matches no known category', async () => {
      mockGetPhotos.mockResolvedValue({ type: 'success', response: { results: [] } })
      const { fetchContextualImages } = await import('@/lib/services/unsplash.service')

      await fetchContextualImages('xyzzy plugh qwerty')

      expect(mockGetPhotos).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'technology' })
      )
    })

    it('triggers download tracking for every returned image with a downloadUrl', async () => {
      mockGetPhotos.mockResolvedValue({
        type: 'success',
        response: {
          results: [
            {
              urls: { regular: 'u1' },
              user: { name: 'A', links: { html: 'h1' } },
              links: { download_location: 'd1' },
            },
            {
              urls: { regular: 'u2' },
              user: { name: 'B', links: { html: 'h2' } },
              links: { download_location: 'd2' },
            },
          ],
        },
      })
      mockTrackDownload.mockResolvedValue(undefined)

      const { fetchContextualImages } = await import('@/lib/services/unsplash.service')
      await fetchContextualImages('a shop', 2)

      expect(mockTrackDownload).toHaveBeenCalledTimes(2)
      expect(mockTrackDownload).toHaveBeenCalledWith({ downloadLocation: 'd1' })
      expect(mockTrackDownload).toHaveBeenCalledWith({ downloadLocation: 'd2' })
    })

    it('swallows a rejected download-tracking call without throwing', async () => {
      mockGetPhotos.mockResolvedValue({
        type: 'success',
        response: {
          results: [
            {
              urls: { regular: 'u1' },
              user: { name: 'A', links: { html: 'h1' } },
              links: { download_location: 'd1' },
            },
          ],
        },
      })
      mockTrackDownload.mockRejectedValue(new Error('tracking failed'))

      const { fetchContextualImages } = await import('@/lib/services/unsplash.service')
      const result = await fetchContextualImages('a shop', 1)

      expect(result).toHaveLength(1)
    })

    it('returns an empty array when the Unsplash API responds with an error result', async () => {
      mockGetPhotos.mockResolvedValue({ type: 'error', errors: ['rate limited'] })
      const { fetchContextualImages } = await import('@/lib/services/unsplash.service')

      const result = await fetchContextualImages('a restaurant menu')
      expect(result).toEqual([])
    })

    it('returns an empty array and does not throw when the API call itself rejects', async () => {
      mockGetPhotos.mockRejectedValue(new Error('network down'))
      const { fetchContextualImages } = await import('@/lib/services/unsplash.service')

      const result = await fetchContextualImages('a hotel booking page')
      expect(result).toEqual([])
    })
  })

  describe('formatImagesForPrompt', () => {
    it('returns an empty string for an empty image list', async () => {
      const { formatImagesForPrompt } = await import('@/lib/services/unsplash.service')
      expect(formatImagesForPrompt([])).toBe('')
    })

    it('includes every image URL, photographer, and attribution guidance for a non-empty list', async () => {
      const { formatImagesForPrompt } = await import('@/lib/services/unsplash.service')
      const images = [
        {
          url: 'https://images.example/a.jpg',
          photographer: 'Jane Doe',
          photographerUrl: 'https://unsplash.com/@jane',
          downloadUrl: 'd1',
        },
        {
          url: 'https://images.example/b.jpg',
          photographer: 'John Roe',
          photographerUrl: 'https://unsplash.com/@john',
          downloadUrl: 'd2',
        },
      ]

      const formatted = formatImagesForPrompt(images)

      expect(formatted).toContain('https://images.example/a.jpg')
      expect(formatted).toContain('Jane Doe')
      expect(formatted).toContain('https://images.example/b.jpg')
      expect(formatted).toContain('John Roe')
      expect(formatted).toContain('AVAILABLE HERO IMAGES')
      expect(formatted).toContain('ATTRIBUTION REQUIREMENTS')
      // The worked JSX examples always reference the first image.
      expect(formatted).toContain('src="https://images.example/a.jpg"')
    })
  })

  describe('getFallbackImages', () => {
    it('returns 3 source.unsplash.com images using the given theme when it is recognized', async () => {
      const { getFallbackImages } = await import('@/lib/services/unsplash.service')
      const images = getFallbackImages('nature')

      expect(images).toHaveLength(3)
      for (const img of images) {
        expect(img.url).toContain('nature')
        expect(img.photographer).toBe('Unsplash')
        expect(img.downloadUrl).toBe('')
      }
    })

    it('is case-insensitive when matching the theme against the known list', async () => {
      const { getFallbackImages } = await import('@/lib/services/unsplash.service')
      const images = getFallbackImages('NATURE')
      expect(images[0].url).toContain('NATURE')
    })

    it('falls back to "technology" when given an unrecognized theme', async () => {
      const { getFallbackImages } = await import('@/lib/services/unsplash.service')
      const images = getFallbackImages('not-a-real-theme')
      expect(images[0].url).toContain('technology')
    })

    it('defaults to "technology" when called with no theme argument', async () => {
      const { getFallbackImages } = await import('@/lib/services/unsplash.service')
      const images = getFallbackImages()
      expect(images[0].url).toContain('technology')
    })
  })
})
