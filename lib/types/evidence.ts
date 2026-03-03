/**
 * Evidence Collection System Types
 *
 * Defines the data model for automated evidence collection,
 * including test runs, builds, deployments, and coverage reports.
 */

export type EvidenceType =
  | 'test-run'
  | 'build'
  | 'coverage'
  | 'deployment'
  | 'screenshot'
  | 'lint'
  | 'type-check'
  | 'command-execution'

export type EvidenceStatus = 'success' | 'failure' | 'warning' | 'pending' | 'skipped'

export type CommandType =
  | 'test'
  | 'build'
  | 'deploy'
  | 'lint'
  | 'type-check'
  | 'coverage'
  | 'custom'

export interface EvidenceMetadata {
  // Test-specific metadata
  testsPassed?: number
  testsFailed?: number
  testsSkipped?: number
  totalTests?: number
  testDuration?: number // milliseconds

  // Coverage metadata
  coveragePercent?: number
  linesCovered?: number
  linesTotal?: number
  branchesCovered?: number
  branchesTotal?: number
  functionsCovered?: number
  functionsTotal?: number
  statementsCovered?: number
  statementsTotal?: number

  // Build metadata
  buildSuccess?: boolean
  buildErrors?: number
  buildWarnings?: number
  buildDuration?: number // milliseconds
  bundleSize?: number // bytes
  chunks?: number

  // Deployment metadata
  deploymentUrl?: string
  deploymentId?: string
  deploymentPlatform?: string
  deploymentStatus?: string

  // Command execution metadata
  commandExecuted?: string
  exitCode?: number
  executionDuration?: number // milliseconds
  workingDirectory?: string

  // General metadata
  framework?: string // 'jest' | 'vitest' | 'pytest' | 'tsc' | 'vite' | etc.
  environment?: string // 'development' | 'production' | 'test'
  gitCommit?: string
  gitBranch?: string
  nodeVersion?: string
  pythonVersion?: string

  // Additional context
  [key: string]: any
}

export interface Artifact {
  id: string
  evidence_id: string
  name: string
  type: string // 'log' | 'coverage-report' | 'screenshot' | 'build-output' | 'json' | 'html'
  mime_type: string
  size: number // bytes
  storage_path: string
  url?: string // For accessing the artifact
  created_at: Date
}

export interface Evidence {
  id: string
  user_id: string
  type: EvidenceType
  status: EvidenceStatus
  title: string
  description?: string
  command?: string
  stdout?: string
  stderr?: string
  metadata: EvidenceMetadata
  project_id?: string
  git_commit?: string
  git_branch?: string
  parent_evidence_id?: string // For linking related evidence
  created_at: Date
  updated_at: Date
}

export interface EvidenceCreateInput {
  user_id: string
  type: EvidenceType
  status: EvidenceStatus
  title: string
  description?: string
  command?: string
  stdout?: string
  stderr?: string
  metadata?: EvidenceMetadata
  project_id?: string
  git_commit?: string
  git_branch?: string
  parent_evidence_id?: string
}

export interface EvidenceUpdateInput {
  status?: EvidenceStatus
  title?: string
  description?: string
  stdout?: string
  stderr?: string
  metadata?: EvidenceMetadata
  git_commit?: string
  git_branch?: string
}

export interface ArtifactCreateInput {
  evidence_id: string
  name: string
  type: string
  mime_type: string
  size: number
  storage_path: string
  url?: string
}

export interface EvidenceFilter {
  user_id?: string
  type?: EvidenceType | EvidenceType[]
  status?: EvidenceStatus | EvidenceStatus[]
  project_id?: string
  git_branch?: string
  git_commit?: string
  date_from?: Date
  date_to?: Date
  search?: string
  limit?: number
  offset?: number
}

export interface CoverageReport {
  total: {
    lines: { covered: number; total: number; percent: number }
    statements: { covered: number; total: number; percent: number }
    functions: { covered: number; total: number; percent: number }
    branches: { covered: number; total: number; percent: number }
  }
  files: Record<string, {
    lines: { covered: number; total: number; percent: number }
    statements: { covered: number; total: number; percent: number }
    functions: { covered: number; total: number; percent: number }
    branches: { covered: number; total: number; percent: number }
  }>
}

export interface TestResult {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  error?: string
  stack?: string
}

export interface TestSuiteResult {
  name: string
  tests: TestResult[]
  passed: number
  failed: number
  skipped: number
  duration: number
}

export interface CommandExecutionResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number
  duration: number
  workingDirectory: string
  environment: Record<string, string>
}

export interface EvidenceCapture {
  type: EvidenceType
  command: string
  cwd?: string
  env?: Record<string, string>
  timeout?: number // milliseconds
  captureOutput?: boolean
  captureArtifacts?: boolean
  onProgress?: (data: { stdout?: string; stderr?: string }) => void
}

export interface EvidenceCaptureResult {
  evidence: Evidence
  artifacts: Artifact[]
  success: boolean
  error?: string
}

export interface EvidenceVerification {
  evidence_id: string
  claim: string
  verified: boolean
  verification_date: Date
  verification_method: string
  verifier?: string
  notes?: string
}

export interface EvidenceTrend {
  date: string
  coverage?: number
  tests_passed?: number
  tests_failed?: number
  build_duration?: number
  deployment_count?: number
}

export interface EvidenceStatistics {
  total_evidence: number
  by_type: Record<EvidenceType, number>
  by_status: Record<EvidenceStatus, number>
  average_coverage?: number
  test_pass_rate?: number
  recent_trends: EvidenceTrend[]
}

// Metadata extraction patterns
export interface MetadataExtractor {
  framework: string
  patterns: {
    testsPassed?: RegExp
    testsFailed?: RegExp
    testsSkipped?: RegExp
    totalTests?: RegExp
    coverage?: RegExp
    buildSuccess?: RegExp
    buildErrors?: RegExp
    duration?: RegExp
  }
  extract: (output: string) => Partial<EvidenceMetadata>
}

// Pre-defined metadata extractors for popular frameworks
export const METADATA_EXTRACTORS: Record<string, MetadataExtractor> = {
  vitest: {
    framework: 'vitest',
    patterns: {
      testsPassed: /Test Files\s+(\d+)\s+passed/,
      testsFailed: /Test Files\s+\d+\s+passed.*?(\d+)\s+failed/,
      totalTests: /Tests\s+(\d+)\s+passed/,
      coverage: /All files\s+\|\s+(\d+\.?\d*)/,
      duration: /Duration\s+(\d+)ms/,
    },
    extract: (output: string) => {
      const metadata: Partial<EvidenceMetadata> = {}

      const passedMatch = output.match(/Test Files\s+(\d+)\s+passed/)
      if (passedMatch) metadata.testsPassed = parseInt(passedMatch[1])

      const failedMatch = output.match(/(\d+)\s+failed/)
      if (failedMatch) metadata.testsFailed = parseInt(failedMatch[1])

      const totalMatch = output.match(/Tests\s+(\d+)\s+passed/)
      if (totalMatch) metadata.totalTests = parseInt(totalMatch[1])

      const coverageMatch = output.match(/All files\s+\|\s+(\d+\.?\d*)/)
      if (coverageMatch) metadata.coveragePercent = parseFloat(coverageMatch[1])

      const durationMatch = output.match(/Duration\s+(\d+)ms/)
      if (durationMatch) metadata.testDuration = parseInt(durationMatch[1])

      return metadata
    },
  },
  jest: {
    framework: 'jest',
    patterns: {
      testsPassed: /Tests:\s+(\d+)\s+passed/,
      testsFailed: /(\d+)\s+failed/,
      totalTests: /Tests:\s+\d+\s+passed.*?(\d+)\s+total/,
      coverage: /All files\s+\|\s+(\d+\.?\d*)/,
    },
    extract: (output: string) => {
      const metadata: Partial<EvidenceMetadata> = {}

      const passedMatch = output.match(/Tests:\s+(\d+)\s+passed/)
      if (passedMatch) metadata.testsPassed = parseInt(passedMatch[1])

      const failedMatch = output.match(/(\d+)\s+failed/)
      if (failedMatch) metadata.testsFailed = parseInt(failedMatch[1])

      const totalMatch = output.match(/(\d+)\s+total/)
      if (totalMatch) metadata.totalTests = parseInt(totalMatch[1])

      const coverageMatch = output.match(/All files\s+\|\s+(\d+\.?\d*)/)
      if (coverageMatch) metadata.coveragePercent = parseFloat(coverageMatch[1])

      return metadata
    },
  },
  pytest: {
    framework: 'pytest',
    patterns: {
      testsPassed: /(\d+)\s+passed/,
      testsFailed: /(\d+)\s+failed/,
      coverage: /TOTAL\s+\d+\s+\d+\s+(\d+)%/,
    },
    extract: (output: string) => {
      const metadata: Partial<EvidenceMetadata> = {}

      const passedMatch = output.match(/(\d+)\s+passed/)
      if (passedMatch) metadata.testsPassed = parseInt(passedMatch[1])

      const failedMatch = output.match(/(\d+)\s+failed/)
      if (failedMatch) metadata.testsFailed = parseInt(failedMatch[1])

      const coverageMatch = output.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/)
      if (coverageMatch) metadata.coveragePercent = parseInt(coverageMatch[1])

      return metadata
    },
  },
  tsc: {
    framework: 'typescript',
    patterns: {
      buildErrors: /Found (\d+) error/,
    },
    extract: (output: string) => {
      const metadata: Partial<EvidenceMetadata> = {}

      const errorsMatch = output.match(/Found (\d+) error/)
      if (errorsMatch) {
        metadata.buildErrors = parseInt(errorsMatch[1])
        metadata.buildSuccess = metadata.buildErrors === 0
      } else {
        metadata.buildErrors = 0
        metadata.buildSuccess = true
      }

      return metadata
    },
  },
  vite: {
    framework: 'vite',
    patterns: {
      bundleSize: /dist\/.*?(\d+\.?\d*)\s+kB/,
    },
    extract: (output: string) => {
      const metadata: Partial<EvidenceMetadata> = {}

      const sizeMatch = output.match(/dist\/.*?(\d+\.?\d*)\s+kB/)
      if (sizeMatch) {
        metadata.bundleSize = parseFloat(sizeMatch[1]) * 1024 // Convert to bytes
      }

      metadata.buildSuccess = !output.includes('error')

      return metadata
    },
  },
}
