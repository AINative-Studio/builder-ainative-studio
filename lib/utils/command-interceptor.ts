/**
 * Command Interceptor
 *
 * Intercepts shell commands to automatically capture evidence.
 * Wraps command execution to collect stdout, stderr, and metadata.
 */

import { getEvidenceCollectorService } from '@/lib/services/evidence-collector.service'
import type { EvidenceType, EvidenceCapture } from '@/lib/types/evidence'

export interface InterceptedCommand {
  original: string
  type: EvidenceType
  shouldCapture: boolean
  metadata?: Record<string, any>
}

export class CommandInterceptor {
  private userId: string
  private enabled: boolean = true
  private capturePatterns: Map<RegExp, EvidenceType> = new Map()

  constructor(userId: string) {
    this.userId = userId
    this.initializePatterns()
  }

  /**
   * Initialize command patterns for auto-detection
   */
  private initializePatterns(): void {
    // Test commands
    this.capturePatterns.set(/vitest\s+run/i, 'test-run')
    this.capturePatterns.set(/vitest\s+--coverage/i, 'coverage')
    this.capturePatterns.set(/jest/i, 'test-run')
    this.capturePatterns.set(/jest\s+--coverage/i, 'coverage')
    this.capturePatterns.set(/npm\s+(?:run\s+)?test/i, 'test-run')
    this.capturePatterns.set(/npm\s+(?:run\s+)?test:coverage/i, 'coverage')
    this.capturePatterns.set(/pytest/i, 'test-run')
    this.capturePatterns.set(/pytest.*--cov/i, 'coverage')

    // Build commands
    this.capturePatterns.set(/npm\s+(?:run\s+)?build/i, 'build')
    this.capturePatterns.set(/vite\s+build/i, 'build')
    this.capturePatterns.set(/tsc/i, 'type-check')
    this.capturePatterns.set(/next\s+build/i, 'build')

    // Lint commands
    this.capturePatterns.set(/eslint/i, 'lint')
    this.capturePatterns.set(/biome\s+check/i, 'lint')

    // Deployment commands
    this.capturePatterns.set(/vercel\s+deploy/i, 'deployment')
    this.capturePatterns.set(/netlify\s+deploy/i, 'deployment')
    this.capturePatterns.set(/railway\s+up/i, 'deployment')
  }

  /**
   * Analyze command to determine if it should be intercepted
   */
  analyzeCommand(command: string): InterceptedCommand {
    for (const [pattern, type] of this.capturePatterns.entries()) {
      if (pattern.test(command)) {
        return {
          original: command,
          type,
          shouldCapture: true,
          metadata: { pattern: pattern.source },
        }
      }
    }

    return {
      original: command,
      type: 'command-execution',
      shouldCapture: false,
    }
  }

  /**
   * Execute command with evidence capture
   */
  async executeWithCapture(
    command: string,
    options?: {
      cwd?: string
      env?: Record<string, string>
      timeout?: number
      forceCapture?: boolean
      evidenceType?: EvidenceType
      onProgress?: (data: { stdout?: string; stderr?: string }) => void
    }
  ) {
    const analysis = this.analyzeCommand(command)
    const shouldCapture = options?.forceCapture || analysis.shouldCapture
    const type = options?.evidenceType || analysis.type

    if (!shouldCapture || !this.enabled) {
      // Execute without capturing
      return this.executeWithoutCapture(command, options?.cwd, options?.env)
    }

    // Execute with evidence capture
    const collector = getEvidenceCollectorService()

    const captureConfig: EvidenceCapture = {
      type,
      command,
      cwd: options?.cwd,
      env: options?.env,
      timeout: options?.timeout,
      captureOutput: true,
      captureArtifacts: true,
      onProgress: options?.onProgress,
    }

    return collector.captureCommand(this.userId, captureConfig)
  }

  /**
   * Execute command without capturing (fallback)
   */
  private async executeWithoutCapture(
    command: string,
    cwd?: string,
    env?: Record<string, string>
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { spawn } = await import('child_process')

    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ')
      let stdout = ''
      let stderr = ''

      const child = spawn(cmd, args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, ...env },
        shell: true,
      })

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('error', reject)

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 })
      })
    })
  }

  /**
   * Enable/disable interception
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Add custom capture pattern
   */
  addPattern(pattern: RegExp, type: EvidenceType): void {
    this.capturePatterns.set(pattern, type)
  }

  /**
   * Remove capture pattern
   */
  removePattern(pattern: RegExp): void {
    this.capturePatterns.delete(pattern)
  }

  /**
   * Get all patterns
   */
  getPatterns(): Map<RegExp, EvidenceType> {
    return new Map(this.capturePatterns)
  }
}

/**
 * Create a command interceptor for a user
 */
export function createCommandInterceptor(userId: string): CommandInterceptor {
  return new CommandInterceptor(userId)
}

/**
 * Convenience function to execute and capture evidence
 */
export async function executeAndCapture(
  userId: string,
  command: string,
  options?: {
    cwd?: string
    env?: Record<string, string>
    timeout?: number
    evidenceType?: EvidenceType
    onProgress?: (data: { stdout?: string; stderr?: string }) => void
  }
) {
  const interceptor = createCommandInterceptor(userId)
  return interceptor.executeWithCapture(command, options)
}
