import { describe, it, expect } from 'vitest'
import { selectPrimitives, getPrimitive } from '@/lib/build/primitive-catalog'
import { capabilityForPrimitive, retrieveCapabilities } from '@/lib/build/capabilities'

/**
 * 2026-09-08 — a real user asked Cody about ingesting AWS S3 bucket metadata
 * (object names, sizes, timestamps, permissions, last-accessed, etc). Cody
 * replied that this needed a custom "AWS IAM + S3 API bridge" built as new
 * paid-tier backend work. That's wrong: ZeroDB already provides real,
 * S3-compatible object storage (lib/build/media-schedule.ts's live upload/
 * download endpoints) — no custom AWS bridge is needed to store or query
 * object metadata. Root cause: ZeroDB's catalog `purpose`/`triggers` never
 * said "S3" or "object storage" anywhere, so the fact was too vague to
 * preempt the model from inventing a fictitious backend gap. These tests
 * lock in that an S3/AWS/object-storage/metadata idea surfaces ZeroDB.
 */

const S3_IDEA =
  'a tool that ingests AWS S3 bucket metadata — object names, sizes, timestamps, ' +
  'tags, storage class, permissions, and last-accessed — so agents can analyze ' +
  'storage patterns, compliance risk, and cost across a customer\'s S3 estate'

describe('2026-09-08 ZeroDB surfaces for S3/object-storage ideas (WhatsApp bug report)', () => {
  it('selectPrimitives includes ZeroDB for an S3-metadata idea', () => {
    const { names } = selectPrimitives(S3_IDEA, 'app')
    expect(names).toContain('ZeroDB')
  })

  it('ZeroDB catalog entry explicitly names S3-compatible storage', () => {
    const p = getPrimitive('ZeroDB')
    expect(p).toBeDefined()
    expect(p!.purpose.toLowerCase()).toContain('s3-compatible')
  })

  it('ZeroDB catalog entry has s3/aws/bucket/object-storage/metadata triggers', () => {
    const p = getPrimitive('ZeroDB')
    expect(p!.triggers).toEqual(
      expect.arrayContaining(['s3', 'aws', 'bucket', 'object storage', 'metadata']),
    )
  })

  it('the human-facing capability entry also names S3-compatible storage and AWS as what it replaces', () => {
    const cap = capabilityForPrimitive('ZeroDB')
    expect(cap).toBeDefined()
    expect(cap!.build.toLowerCase()).toContain('s3-compatible')
    expect(cap!.replaces.toLowerCase()).toContain('s3')
  })

  it('retrieveCapabilities surfaces ZeroDB for an S3/object-storage question', () => {
    const results = retrieveCapabilities('how do I store S3 object metadata like size and last accessed')
    expect(results.map((c) => c.product)).toContain('ZeroDB')
  })
})
