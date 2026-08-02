/**
 * Evidence Verification API Tests
 * POST /api/evidence/verify
 */

import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the verifier service so the route can be tested in isolation.
const verifyCommit = vi.fn()
vi.mock('@/lib/services/evidence-verifier.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/evidence-verifier.service')>()
  return {
    ...actual,
    getEvidenceVerifierService: () => ({ verifyCommit }),
  }
})

import { POST as verifyEvidence } from '@/app/api/evidence/verify/route'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('POST /api/evidence/verify', () => {
  it('returns passed=true when required evidence is present', async () => {
    verifyCommit.mockResolvedValueOnce({
      passed: true,
      missingEvidence: [],
      failedEvidence: [],
      coverage: { passed: true, coverage: 90, threshold: 80, message: 'ok' },
      message: 'All required evidence present and passing',
    })

    const request = new NextRequest('http://localhost:3000/api/evidence/verify', {
      method: 'POST',
      body: JSON.stringify({
        user_id: VALID_UUID,
        files: ['src/feature.ts'],
      }),
    })

    const response = await verifyEvidence(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.passed).toBe(true)
    expect(data.missingEvidence).toEqual([])
  })

  it('returns passed=false and missing evidence when a commit is blocked', async () => {
    verifyCommit.mockResolvedValueOnce({
      passed: false,
      missingEvidence: ['test-run'],
      failedEvidence: [],
      message: 'Commit blocked — missing evidence: test-run',
    })

    const request = new NextRequest('http://localhost:3000/api/evidence/verify', {
      method: 'POST',
      body: JSON.stringify({
        user_id: VALID_UUID,
        files: ['src/feature.ts'],
      }),
    })

    const response = await verifyEvidence(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.passed).toBe(false)
    expect(data.missingEvidence).toContain('test-run')
  })

  it('rejects an invalid user_id', async () => {
    const request = new NextRequest('http://localhost:3000/api/evidence/verify', {
      method: 'POST',
      body: JSON.stringify({ user_id: 'not-a-uuid' }),
    })

    const response = await verifyEvidence(request)
    expect(response.status).toBe(400)
  })

  it('rejects an out-of-range coverage threshold', async () => {
    const request = new NextRequest('http://localhost:3000/api/evidence/verify', {
      method: 'POST',
      body: JSON.stringify({ user_id: VALID_UUID, coverageThreshold: 150 }),
    })

    const response = await verifyEvidence(request)
    expect(response.status).toBe(400)
  })
})
