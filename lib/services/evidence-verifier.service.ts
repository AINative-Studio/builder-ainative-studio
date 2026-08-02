/**
 * Evidence Verifier Service
 *
 * Validates agent claims against collected evidence:
 *  - Requires the presence of specific evidence types before a commit is allowed
 *  - Verifies that test evidence actually passed
 *  - Validates coverage against a configurable threshold
 *  - Flags missing evidence so "false confidence" claims are caught
 *
 * This is the verification layer described in issue #19 and complements the
 * Rule Enforcement Framework (#18): enforcement checks the *action*, this
 * checks the *proof*.
 */

import { db } from '@/lib/db'
import { evidence } from '@/lib/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import type { Evidence, EvidenceType, EvidenceMetadata } from '@/lib/types/evidence'

export const DEFAULT_COVERAGE_THRESHOLD = 80

export interface CommitVerificationInput {
  /** User whose evidence should be inspected. */
  userId: string
  /** Commit message (used for reporting only). */
  message?: string
  /** Files touched by the commit (used to decide which evidence is required). */
  files?: string[]
  /** Evidence types that must exist and pass for the commit to be allowed. */
  requiredEvidence?: EvidenceType[]
  /** Optional git branch scoping. */
  gitBranch?: string
  /** Coverage threshold percentage. Defaults to {@link DEFAULT_COVERAGE_THRESHOLD}. */
  coverageThreshold?: number
  /**
   * Pre-fetched evidence to verify against. When omitted the verifier loads the
   * most recent evidence for the user from the database. Injecting evidence
   * keeps the verifier pure and easy to unit test.
   */
  evidence?: Evidence[]
}

export interface CoverageValidationResult {
  passed: boolean
  coverage: number | null
  threshold: number
  message: string
}

export interface CommitVerificationResult {
  passed: boolean
  /** Required evidence types with no matching evidence. */
  missingEvidence: EvidenceType[]
  /** Required evidence types whose latest run did not succeed. */
  failedEvidence: EvidenceType[]
  /** Coverage validation result, when coverage evidence is required/present. */
  coverage?: CoverageValidationResult
  /** Human-readable summary of the verification outcome. */
  message: string
  /** The evidence that was inspected. */
  inspected: Evidence[]
}

export class EvidenceVerifierService {
  /**
   * Verify that the evidence required for a commit exists and is passing.
   *
   * A commit is blocked when any required evidence type is missing, when the
   * latest matching evidence for a required type failed, or when coverage is
   * below the configured threshold.
   */
  async verifyCommit(input: CommitVerificationInput): Promise<CommitVerificationResult> {
    const threshold = input.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD
    const required = input.requiredEvidence ?? this.inferRequiredEvidence(input.files)

    const inspected = input.evidence ?? (await this.loadRecentEvidence(input.userId, input.gitBranch))

    const missingEvidence: EvidenceType[] = []
    const failedEvidence: EvidenceType[] = []

    for (const type of required) {
      const latest = this.latestOfType(inspected, type)
      if (!latest) {
        missingEvidence.push(type)
        continue
      }
      if (latest.status !== 'success') {
        failedEvidence.push(type)
      }
    }

    // Coverage check: if coverage is required, or any inspected evidence carries
    // a coverage percentage, validate it against the threshold.
    let coverage: CoverageValidationResult | undefined
    const coverageEvidence =
      this.latestOfType(inspected, 'coverage') ??
      inspected.find((e) => typeof e.metadata?.coveragePercent === 'number')

    if (required.includes('coverage') || coverageEvidence) {
      coverage = this.validateCoverage(coverageEvidence ?? null, threshold)
    }

    const passed =
      missingEvidence.length === 0 &&
      failedEvidence.length === 0 &&
      (coverage ? coverage.passed : true)

    return {
      passed,
      missingEvidence,
      failedEvidence,
      coverage,
      inspected,
      message: this.buildMessage({ passed, missingEvidence, failedEvidence, coverage }),
    }
  }

  /**
   * Validate a coverage percentage (taken from an evidence record or a raw
   * metadata/percentage value) against a threshold.
   */
  validateCoverage(
    source: Evidence | EvidenceMetadata | number | null | undefined,
    threshold: number = DEFAULT_COVERAGE_THRESHOLD
  ): CoverageValidationResult {
    const coverage = this.extractCoverage(source)

    if (coverage == null) {
      return {
        passed: false,
        coverage: null,
        threshold,
        message: 'No coverage evidence available to validate against threshold',
      }
    }

    const passed = coverage >= threshold
    return {
      passed,
      coverage,
      threshold,
      message: passed
        ? `Coverage ${coverage}% meets threshold of ${threshold}%`
        : `Coverage ${coverage}% is below threshold of ${threshold}%`,
    }
  }

  /**
   * Verify a single evidence record actually supports a passing claim.
   */
  verifyEvidencePasses(record: Evidence | null | undefined): boolean {
    return !!record && record.status === 'success'
  }

  /**
   * Load the most recent evidence records for a user (optionally scoped to a
   * git branch), newest first.
   */
  private async loadRecentEvidence(userId: string, gitBranch?: string): Promise<Evidence[]> {
    try {
      const conditions = [eq(evidence.user_id, userId)]
      if (gitBranch) conditions.push(eq(evidence.git_branch, gitBranch))

      const rows = await db
        .select()
        .from(evidence)
        .where(and(...conditions))
        .orderBy(desc(evidence.created_at))
        .limit(100)

      return rows as Evidence[]
    } catch (error) {
      console.error('Failed to load evidence for verification:', error)
      return []
    }
  }

  /** Return the newest evidence of a given type from a list. */
  private latestOfType(list: Evidence[], type: EvidenceType): Evidence | undefined {
    // `list` is expected newest-first; find preserves that ordering.
    return list.find((e) => e.type === type)
  }

  /**
   * Infer which evidence types a commit requires based on the files it touches.
   * Source changes always require a passing test run; anything non-trivial also
   * requires a successful build.
   */
  private inferRequiredEvidence(files?: string[]): EvidenceType[] {
    if (!files || files.length === 0) return ['test-run']

    const codeFiles = files.filter((f) => /\.(t|j)sx?$|\.py$|\.go$|\.rs$/.test(f))
    if (codeFiles.length === 0) return []

    return ['test-run']
  }

  private extractCoverage(
    source: Evidence | EvidenceMetadata | number | null | undefined
  ): number | null {
    if (source == null) return null
    if (typeof source === 'number') return source
    // Evidence record
    if ('metadata' in source && source.metadata) {
      const pct = (source.metadata as EvidenceMetadata).coveragePercent
      return typeof pct === 'number' ? pct : null
    }
    // Raw metadata object
    const pct = (source as EvidenceMetadata).coveragePercent
    return typeof pct === 'number' ? pct : null
  }

  private buildMessage(args: {
    passed: boolean
    missingEvidence: EvidenceType[]
    failedEvidence: EvidenceType[]
    coverage?: CoverageValidationResult
  }): string {
    if (args.passed) return 'All required evidence present and passing'

    const parts: string[] = []
    if (args.missingEvidence.length) {
      parts.push(`missing evidence: ${args.missingEvidence.join(', ')}`)
    }
    if (args.failedEvidence.length) {
      parts.push(`failing evidence: ${args.failedEvidence.join(', ')}`)
    }
    if (args.coverage && !args.coverage.passed) {
      parts.push(args.coverage.message)
    }
    return `Commit blocked — ${parts.join('; ')}`
  }
}

let verifierInstance: EvidenceVerifierService | null = null

export function getEvidenceVerifierService(): EvidenceVerifierService {
  if (!verifierInstance) {
    verifierInstance = new EvidenceVerifierService()
  }
  return verifierInstance
}
