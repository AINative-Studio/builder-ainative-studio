/**
 * Evidence API Integration Tests
 *
 * Tests for evidence API endpoints:
 * - GET /api/evidence - List evidence
 * - POST /api/evidence/capture - Capture evidence
 * - GET /api/evidence/[id] - Get evidence details
 * - GET /api/evidence/[id]/artifacts - List artifacts
 */

import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as getEvidence, POST as captureEvidence } from '@/app/api/evidence/route'
import { GET as getEvidenceDetail } from '@/app/api/evidence/[id]/route'
import { GET as getArtifacts } from '@/app/api/evidence/[id]/artifacts/route'
import { db } from '@/lib/db'

const evidenceRows = [
  {
    id: 'evidence-1',
    user_id: 'user-1',
    type: 'test-run',
    status: 'success',
    title: 'Test Run Success',
    description: 'All tests passed',
    command: 'npm test',
    metadata: {
      testsPassed: 10,
      testsFailed: 0,
      totalTests: 10,
      coveragePercent: 85.5,
    },
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
  },
  {
    id: 'evidence-2',
    user_id: 'user-1',
    type: 'build',
    status: 'failure',
    title: 'Build Failed',
    description: 'Build failed with errors',
    command: 'npm run build',
    metadata: {
      buildSuccess: false,
      buildErrors: 3,
    },
    created_at: new Date('2024-01-15T09:00:00Z'),
    updated_at: new Date('2024-01-15T09:00:00Z'),
  },
]

// Mock database
vi.mock('@/lib/db', () => {
  const rows = [
    {
      id: 'evidence-1',
      user_id: 'user-1',
      type: 'test-run',
      status: 'success',
      title: 'Test Run Success',
      description: 'All tests passed',
      command: 'npm test',
      metadata: {
        testsPassed: 10,
        testsFailed: 0,
        totalTests: 10,
        coveragePercent: 85.5,
      },
      created_at: new Date('2024-01-15T10:00:00Z'),
      updated_at: new Date('2024-01-15T10:00:00Z'),
    },
    {
      id: 'evidence-2',
      user_id: 'user-1',
      type: 'build',
      status: 'failure',
      title: 'Build Failed',
      description: 'Build failed with errors',
      command: 'npm run build',
      metadata: {
        buildSuccess: false,
        buildErrors: 3,
      },
      created_at: new Date('2024-01-15T09:00:00Z'),
      updated_at: new Date('2024-01-15T09:00:00Z'),
    },
  ]

  // `where()` returns an object that is BOTH:
  //  - thenable, resolving to `rows` for the list query and `[{count}]` for
  //    the count query. To satisfy both, its `then` resolves to `rows`, and the
  //    count query destructures `[{ count }]` — so `rows[0]` must expose a
  //    numeric `count`. We therefore resolve to a specially shaped array whose
  //    first element carries `count` while still being iterable for the list.
  const listResult: any = [...rows]
  ;(listResult as any).__isList = true

  const whereResult = () => {
    const result: any = Promise.resolve(rows)
    result.orderBy = vi.fn(() => ({
      limit: vi.fn(() => ({
        offset: vi.fn(() => Promise.resolve(rows)),
      })),
    }))
    result.limit = vi.fn(() => Promise.resolve(rows.slice(0, 1)))
    return result
  }

  const selectImpl = (projection?: any) => ({
    from: vi.fn(() => {
      // Count query uses a projection like `{ count: sql\`count(*)\` }`.
      if (projection && 'count' in projection) {
        return {
          where: vi.fn(() => Promise.resolve([{ count: rows.length }])),
        }
      }
      return {
        where: vi.fn(() => whereResult()),
      }
    }),
  })

  return {
    db: {
      select: vi.fn(selectImpl),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() =>
            Promise.resolve([
              {
                id: 'new-evidence-1',
                user_id: 'user-1',
                type: 'test-run',
                status: 'success',
                title: 'Test Run',
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
              },
            ])
          ),
        })),
      })),
    },
  }
})

// Mock evidence collector service
vi.mock('@/lib/services/evidence-collector.service', () => ({
  getEvidenceCollectorService: () => ({
    captureCommand: vi.fn(async (userId, capture) => ({
      evidence: {
        id: 'captured-evidence-1',
        user_id: userId,
        type: capture.type,
        status: 'success',
        title: `Captured: ${capture.command}`,
        command: capture.command,
        metadata: {
          exitCode: 0,
          executionDuration: 1000,
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
      artifacts: [],
      success: true,
    })),
  }),
}))

describe('Evidence API Endpoints', () => {
  describe('GET /api/evidence', () => {
    it('should return list of evidence', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence')
      const response = await getEvidence(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.evidence).toBeDefined()
      expect(Array.isArray(data.evidence)).toBe(true)
      expect(data.evidence.length).toBeGreaterThan(0)
    })

    it('should filter evidence by type', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence?type=test-run')
      const response = await getEvidence(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.evidence).toBeDefined()
    })

    it('should filter evidence by status', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence?status=success')
      const response = await getEvidence(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.evidence).toBeDefined()
    })

    it('should support pagination', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence?limit=10&offset=0')
      const response = await getEvidence(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.pagination).toBeDefined()
      expect(data.pagination.limit).toBe(10)
      expect(data.pagination.offset).toBe(0)
    })

    it('should support search query', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence?search=test')
      const response = await getEvidence(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.evidence).toBeDefined()
    })

    it('should reject invalid limit parameter', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence?limit=1000')
      const response = await getEvidence(request)

      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/evidence/capture', () => {
    it('should capture evidence from command', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence/capture', {
        method: 'POST',
        body: JSON.stringify({
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'test-run',
          command: 'npm test',
        }),
      })

      const response = await captureEvidence(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.evidence).toBeDefined()
      expect(data.evidence.command).toBe('npm test')
      expect(data.success).toBe(true)
    })

    it('should reject invalid user_id', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence/capture', {
        method: 'POST',
        body: JSON.stringify({
          user_id: 'invalid-uuid',
          type: 'test-run',
          command: 'npm test',
        }),
      })

      const response = await captureEvidence(request)

      expect(response.status).toBe(400)
    })

    it('should reject invalid evidence type', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence/capture', {
        method: 'POST',
        body: JSON.stringify({
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'invalid-type',
          command: 'npm test',
        }),
      })

      const response = await captureEvidence(request)

      expect(response.status).toBe(400)
    })

    it('should reject missing command', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence/capture', {
        method: 'POST',
        body: JSON.stringify({
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'test-run',
        }),
      })

      const response = await captureEvidence(request)

      expect(response.status).toBe(400)
    })

    it('should support optional parameters', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence/capture', {
        method: 'POST',
        body: JSON.stringify({
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'test-run',
          command: 'npm test',
          cwd: '/path/to/project',
          timeout: 60000,
          captureArtifacts: true,
        }),
      })

      const response = await captureEvidence(request)

      expect(response.status).toBe(200)
    })
  })

  describe('GET /api/evidence/[id]', () => {
    it('should return evidence details', async () => {
      const request = new NextRequest('http://localhost:3000/api/evidence/evidence-1')
      const response = await getEvidenceDetail(request, { params: Promise.resolve({ id: 'evidence-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.evidence).toBeDefined()
      expect(data.evidence.id).toBe('evidence-1')
    })

    it('should return 404 for non-existent evidence', async () => {
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      } as any)

      const request = new NextRequest('http://localhost:3000/api/evidence/non-existent')
      const response = await getEvidenceDetail(request, { params: Promise.resolve({ id: 'non-existent' }) })

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/evidence/[id]/artifacts', () => {
    it('should return artifacts for evidence', async () => {
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([
            {
              id: 'artifact-1',
              evidence_id: 'evidence-1',
              name: 'stdout.log',
              type: 'log',
              mime_type: 'text/plain',
              size: 1024,
              storage_path: '/path/to/artifact',
              created_at: new Date(),
            },
          ])),
        })),
      } as any)

      const request = new NextRequest('http://localhost:3000/api/evidence/evidence-1/artifacts')
      const response = await getArtifacts(request, { params: Promise.resolve({ id: 'evidence-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.artifacts).toBeDefined()
      expect(Array.isArray(data.artifacts)).toBe(true)
    })

    it('should return empty array for evidence with no artifacts', async () => {
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      } as any)

      const request = new NextRequest('http://localhost:3000/api/evidence/evidence-1/artifacts')
      const response = await getArtifacts(request, { params: Promise.resolve({ id: 'evidence-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.artifacts).toBeDefined()
      expect(data.artifacts.length).toBe(0)
    })
  })
})
