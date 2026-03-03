import { beforeAll, afterAll, vi } from 'vitest'
import dotenv from 'dotenv'

// Load environment variables for tests
dotenv.config()

// Mock logger to avoid console spam during tests
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

beforeAll(() => {
  // Set test environment variables if not already set
  if (!process.env.OPENAI_API_KEY) {
    console.warn('Warning: OPENAI_API_KEY not set. Some tests may be skipped.')
  }
})

afterAll(() => {
  // Cleanup
})
