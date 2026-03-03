/**
 * Evidence Collector Service
 *
 * Automatically captures command outputs, parses metadata, stores evidence,
 * and manages artifacts for automated proof collection.
 */

import { spawn, type ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { nanoid } from 'nanoid'
import {
  type Evidence,
  type Artifact,
  type EvidenceCapture,
  type EvidenceCaptureResult,
  type EvidenceMetadata,
  type EvidenceType,
  type EvidenceStatus,
  type EvidenceCreateInput,
  type ArtifactCreateInput,
  METADATA_EXTRACTORS,
} from '@/lib/types/evidence'
import { db } from '@/lib/db'
import { evidence, artifacts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export class EvidenceCollectorService {
  private artifactsDir: string

  constructor(artifactsDir?: string) {
    this.artifactsDir = artifactsDir || join(process.cwd(), '.evidence', 'artifacts')
  }

  /**
   * Execute a command and capture evidence
   */
  async captureCommand(
    userId: string,
    capture: EvidenceCapture
  ): Promise<EvidenceCaptureResult> {
    const startTime = Date.now()
    let stdout = ''
    let stderr = ''
    let exitCode = 0

    try {
      // Execute command
      const result = await this.executeCommand(
        capture.command,
        capture.cwd || process.cwd(),
        capture.env,
        capture.timeout || 300000, // 5 minutes default
        (data) => {
          if (data.stdout) {
            stdout += data.stdout
            if (capture.onProgress) {
              capture.onProgress({ stdout: data.stdout })
            }
          }
          if (data.stderr) {
            stderr += data.stderr
            if (capture.onProgress) {
              capture.onProgress({ stderr: data.stderr })
            }
          }
        }
      )

      exitCode = result.exitCode
      stdout = result.stdout
      stderr = result.stderr

      // Determine status
      const status: EvidenceStatus = exitCode === 0 ? 'success' : 'failure'

      // Extract metadata
      const metadata = this.extractMetadata(
        capture.type,
        capture.command,
        stdout,
        stderr,
        exitCode,
        Date.now() - startTime
      )

      // Determine framework
      const framework = this.detectFramework(capture.command)

      // Create evidence record
      const evidenceInput: EvidenceCreateInput = {
        user_id: userId,
        type: capture.type,
        status,
        title: this.generateTitle(capture.type, capture.command, status),
        description: `Executed: ${capture.command}`,
        command: capture.command,
        stdout: capture.captureOutput !== false ? stdout : undefined,
        stderr: capture.captureOutput !== false ? stderr : undefined,
        metadata: {
          ...metadata,
          framework,
          exitCode,
          executionDuration: Date.now() - startTime,
          workingDirectory: capture.cwd || process.cwd(),
          commandExecuted: capture.command,
        },
      }

      const createdEvidence = await this.createEvidence(evidenceInput)

      // Create artifacts if requested
      const createdArtifacts: Artifact[] = []
      if (capture.captureArtifacts !== false && createdEvidence) {
        // Save stdout as artifact
        if (stdout) {
          const stdoutArtifact = await this.saveArtifact(
            createdEvidence.id,
            'stdout.log',
            'log',
            'text/plain',
            Buffer.from(stdout)
          )
          if (stdoutArtifact) createdArtifacts.push(stdoutArtifact)
        }

        // Save stderr as artifact
        if (stderr) {
          const stderrArtifact = await this.saveArtifact(
            createdEvidence.id,
            'stderr.log',
            'log',
            'text/plain',
            Buffer.from(stderr)
          )
          if (stderrArtifact) createdArtifacts.push(stderrArtifact)
        }

        // Save coverage report if available
        if (capture.type === 'coverage' && metadata.coveragePercent) {
          await this.captureCoverageReport(createdEvidence.id, capture.cwd || process.cwd())
        }
      }

      return {
        evidence: createdEvidence!,
        artifacts: createdArtifacts,
        success: exitCode === 0,
      }
    } catch (error) {
      // Create failure evidence
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      const evidenceInput: EvidenceCreateInput = {
        user_id: userId,
        type: capture.type,
        status: 'failure',
        title: this.generateTitle(capture.type, capture.command, 'failure'),
        description: `Failed: ${capture.command}`,
        command: capture.command,
        stderr: errorMessage,
        metadata: {
          exitCode: -1,
          executionDuration: Date.now() - startTime,
          workingDirectory: capture.cwd || process.cwd(),
          commandExecuted: capture.command,
          error: errorMessage,
        },
      }

      const createdEvidence = await this.createEvidence(evidenceInput)

      return {
        evidence: createdEvidence!,
        artifacts: [],
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Execute command and return output
   */
  private executeCommand(
    command: string,
    cwd: string,
    env?: Record<string, string>,
    timeout = 300000,
    onData?: (data: { stdout?: string; stderr?: string }) => void
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ')
      let stdout = ''
      let stderr = ''

      const child: ChildProcess = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...env },
        shell: true,
      })

      // Timeout handling
      const timeoutId = setTimeout(() => {
        child.kill()
        reject(new Error(`Command timeout after ${timeout}ms`))
      }, timeout)

      child.stdout?.on('data', (data) => {
        const text = data.toString()
        stdout += text
        if (onData) onData({ stdout: text })
      })

      child.stderr?.on('data', (data) => {
        const text = data.toString()
        stderr += text
        if (onData) onData({ stderr: text })
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        reject(error)
      })

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        })
      })
    })
  }

  /**
   * Extract metadata from command output
   */
  private extractMetadata(
    type: EvidenceType,
    command: string,
    stdout: string,
    stderr: string,
    exitCode: number,
    duration: number
  ): Partial<EvidenceMetadata> {
    const metadata: Partial<EvidenceMetadata> = {
      exitCode,
      executionDuration: duration,
    }

    // Detect framework and use appropriate extractor
    const framework = this.detectFramework(command)
    const output = stdout + stderr

    if (framework && METADATA_EXTRACTORS[framework]) {
      const extracted = METADATA_EXTRACTORS[framework].extract(output)
      Object.assign(metadata, extracted)
    }

    // Generic extraction patterns
    if (type === 'test-run' || type === 'coverage') {
      this.extractTestMetadata(output, metadata)
    }

    if (type === 'build') {
      this.extractBuildMetadata(output, metadata)
    }

    if (type === 'coverage') {
      this.extractCoverageMetadata(output, metadata)
    }

    return metadata
  }

  /**
   * Extract test-specific metadata
   */
  private extractTestMetadata(output: string, metadata: Partial<EvidenceMetadata>): void {
    // Generic patterns for test results
    const patterns = {
      passed: /(\d+)\s+(?:test[s]?\s+)?passed/i,
      failed: /(\d+)\s+(?:test[s]?\s+)?failed/i,
      skipped: /(\d+)\s+(?:test[s]?\s+)?skipped/i,
      total: /(\d+)\s+total/i,
      duration: /(?:in|took|duration:?\s*)(\d+(?:\.\d+)?)\s*(?:ms|s|sec)/i,
    }

    const passedMatch = output.match(patterns.passed)
    if (passedMatch) metadata.testsPassed = parseInt(passedMatch[1])

    const failedMatch = output.match(patterns.failed)
    if (failedMatch) metadata.testsFailed = parseInt(failedMatch[1])

    const skippedMatch = output.match(patterns.skipped)
    if (skippedMatch) metadata.testsSkipped = parseInt(skippedMatch[1])

    const totalMatch = output.match(patterns.total)
    if (totalMatch) metadata.totalTests = parseInt(totalMatch[1])

    const durationMatch = output.match(patterns.duration)
    if (durationMatch) {
      const value = parseFloat(durationMatch[1])
      const unit = durationMatch[2]
      metadata.testDuration = unit === 's' || unit === 'sec' ? value * 1000 : value
    }
  }

  /**
   * Extract build-specific metadata
   */
  private extractBuildMetadata(output: string, metadata: Partial<EvidenceMetadata>): void {
    // Build success/failure
    metadata.buildSuccess = !output.toLowerCase().includes('error') && !output.includes('failed')

    // Error count
    const errorMatch = output.match(/(\d+)\s+error[s]?/i)
    if (errorMatch) metadata.buildErrors = parseInt(errorMatch[1])

    // Warning count
    const warningMatch = output.match(/(\d+)\s+warning[s]?/i)
    if (warningMatch) metadata.buildWarnings = parseInt(warningMatch[1])

    // Bundle size
    const sizeMatch = output.match(/(\d+(?:\.\d+)?)\s*(?:kb|kB|KB)/i)
    if (sizeMatch) metadata.bundleSize = parseFloat(sizeMatch[1]) * 1024

    // Duration
    const durationMatch = output.match(/(?:built in|completed in|took)\s+(\d+(?:\.\d+)?)\s*(?:ms|s)/i)
    if (durationMatch) {
      const value = parseFloat(durationMatch[1])
      metadata.buildDuration = durationMatch[0].includes('s') ? value * 1000 : value
    }
  }

  /**
   * Extract coverage-specific metadata
   */
  private extractCoverageMetadata(output: string, metadata: Partial<EvidenceMetadata>): void {
    // Coverage percentage
    const coveragePatterns = [
      /All files\s+\|\s+(\d+\.?\d*)/,
      /TOTAL\s+\d+\s+\d+\s+(\d+)%/,
      /Statements\s+:\s+(\d+\.?\d*)%/,
      /Coverage:\s+(\d+\.?\d*)%/,
    ]

    for (const pattern of coveragePatterns) {
      const match = output.match(pattern)
      if (match) {
        metadata.coveragePercent = parseFloat(match[1])
        break
      }
    }

    // Detailed coverage metrics
    const linesMatch = output.match(/Lines\s+:\s+(\d+\.?\d*)%\s+\(\s*(\d+)\/(\d+)\s*\)/)
    if (linesMatch) {
      metadata.linesCovered = parseInt(linesMatch[2])
      metadata.linesTotal = parseInt(linesMatch[3])
    }

    const branchesMatch = output.match(/Branches\s+:\s+(\d+\.?\d*)%\s+\(\s*(\d+)\/(\d+)\s*\)/)
    if (branchesMatch) {
      metadata.branchesCovered = parseInt(branchesMatch[2])
      metadata.branchesTotal = parseInt(branchesMatch[3])
    }

    const functionsMatch = output.match(/Functions\s+:\s+(\d+\.?\d*)%\s+\(\s*(\d+)\/(\d+)\s*\)/)
    if (functionsMatch) {
      metadata.functionsCovered = parseInt(functionsMatch[2])
      metadata.functionsTotal = parseInt(functionsMatch[3])
    }

    const statementsMatch = output.match(/Statements\s+:\s+(\d+\.?\d*)%\s+\(\s*(\d+)\/(\d+)\s*\)/)
    if (statementsMatch) {
      metadata.statementsCovered = parseInt(statementsMatch[2])
      metadata.statementsTotal = parseInt(statementsMatch[3])
    }
  }

  /**
   * Detect framework from command
   */
  private detectFramework(command: string): string | undefined {
    if (command.includes('vitest')) return 'vitest'
    if (command.includes('jest')) return 'jest'
    if (command.includes('pytest')) return 'pytest'
    if (command.includes('tsc')) return 'tsc'
    if (command.includes('vite build') || command.includes('vite-build')) return 'vite'
    if (command.includes('npm run build') || command.includes('npm build')) return 'npm'
    return undefined
  }

  /**
   * Generate title for evidence
   */
  private generateTitle(type: EvidenceType, command: string, status: EvidenceStatus): string {
    const statusEmoji = status === 'success' ? '✅' : status === 'failure' ? '❌' : '⚠️'
    const typeLabel = type.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())

    const shortCommand = command.length > 50 ? command.substring(0, 47) + '...' : command

    return `${statusEmoji} ${typeLabel}: ${shortCommand}`
  }

  /**
   * Create evidence record in database
   */
  private async createEvidence(input: EvidenceCreateInput): Promise<Evidence | null> {
    try {
      const [created] = await db
        .insert(evidence)
        .values({
          ...input,
          metadata: input.metadata || {},
        })
        .returning()

      return created as Evidence
    } catch (error) {
      console.error('Failed to create evidence:', error)
      return null
    }
  }

  /**
   * Save artifact to storage
   */
  private async saveArtifact(
    evidenceId: string,
    name: string,
    type: string,
    mimeType: string,
    content: Buffer
  ): Promise<Artifact | null> {
    try {
      // Ensure artifacts directory exists
      await fs.mkdir(this.artifactsDir, { recursive: true })

      // Create subdirectory for this evidence
      const evidenceDir = join(this.artifactsDir, evidenceId)
      await fs.mkdir(evidenceDir, { recursive: true })

      // Save file
      const filePath = join(evidenceDir, name)
      await fs.writeFile(filePath, content)

      // Create artifact record
      const artifactInput: ArtifactCreateInput = {
        evidence_id: evidenceId,
        name,
        type,
        mime_type: mimeType,
        size: content.length,
        storage_path: filePath,
      }

      const [created] = await db.insert(artifacts).values(artifactInput).returning()

      return created as Artifact
    } catch (error) {
      console.error('Failed to save artifact:', error)
      return null
    }
  }

  /**
   * Capture coverage report files
   */
  private async captureCoverageReport(evidenceId: string, cwd: string): Promise<void> {
    try {
      // Common coverage report locations
      const coveragePaths = [
        join(cwd, 'coverage', 'lcov.info'),
        join(cwd, 'coverage', 'coverage-final.json'),
        join(cwd, 'coverage', 'index.html'),
        join(cwd, '.coverage'),
      ]

      for (const coveragePath of coveragePaths) {
        try {
          const content = await fs.readFile(coveragePath)
          const name = coveragePath.split('/').pop() || 'coverage'
          const mimeType = this.getMimeType(name)

          await this.saveArtifact(evidenceId, name, 'coverage-report', mimeType, content)
        } catch {
          // File doesn't exist, skip
        }
      }
    } catch (error) {
      console.error('Failed to capture coverage report:', error)
    }
  }

  /**
   * Get MIME type from filename
   */
  private getMimeType(filename: string): string {
    if (filename.endsWith('.json')) return 'application/json'
    if (filename.endsWith('.html')) return 'text/html'
    if (filename.endsWith('.xml')) return 'application/xml'
    if (filename.endsWith('.log')) return 'text/plain'
    return 'application/octet-stream'
  }

  /**
   * Get evidence by ID
   */
  async getEvidence(evidenceId: string): Promise<Evidence | null> {
    try {
      const [result] = await db.select().from(evidence).where(eq(evidence.id, evidenceId)).limit(1)

      return (result as Evidence) || null
    } catch (error) {
      console.error('Failed to get evidence:', error)
      return null
    }
  }

  /**
   * Get artifacts for evidence
   */
  async getArtifacts(evidenceId: string): Promise<Artifact[]> {
    try {
      const results = await db.select().from(artifacts).where(eq(artifacts.evidence_id, evidenceId))

      return results as Artifact[]
    } catch (error) {
      console.error('Failed to get artifacts:', error)
      return []
    }
  }

  /**
   * Read artifact content
   */
  async readArtifact(artifactId: string): Promise<Buffer | null> {
    try {
      const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1)

      if (!artifact) return null

      const content = await fs.readFile(artifact.storage_path)
      return content
    } catch (error) {
      console.error('Failed to read artifact:', error)
      return null
    }
  }
}

// Singleton instance
let evidenceCollectorInstance: EvidenceCollectorService | null = null

export function getEvidenceCollectorService(): EvidenceCollectorService {
  if (!evidenceCollectorInstance) {
    evidenceCollectorInstance = new EvidenceCollectorService()
  }
  return evidenceCollectorInstance
}
