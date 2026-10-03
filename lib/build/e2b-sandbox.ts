/**
 * E2B-backed sandbox executor for running a founder's own generated code
 * (#875). Real microVM isolation (E2B is Firecracker-based) between an
 * untrusted, LLM-generated test/build command and Builder's own production
 * server — closes the gap where coverage-runner.ts previously ran that
 * command via a raw, unsandboxed `spawn()` on the host process.
 *
 * Kept deliberately narrow: write a FileMap, run a SEQUENCE of commands in
 * one sandbox session (so install → install-coverage-dep → test run each get
 * their own labeled result, same diagnosability as the local-subprocess path,
 * without paying E2B's sandbox-startup latency three times), read back
 * whichever output files the caller asks for at the end, tear the sandbox
 * down. coverage-runner.ts owns all the vitest-specific logic (detecting the
 * test command, parsing coverage-summary.json); this module only knows how
 * to get a sequence of arbitrary commands' results (and named artifact
 * files) out of an isolated sandbox.
 */

import { Sandbox, CommandExitError } from 'e2b'
import type { FileMap } from './coverage-runner'

export interface SandboxCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface SandboxSessionResult {
  /** One result per command in the sequence, in order. If a command throws
   *  (crash/timeout) rather than exiting normally, remaining commands are
   *  skipped — later entries are simply absent, never fabricated. */
  commandResults: SandboxCommandResult[]
  /** Contents of each path requested via readBack, by that same path
   *  (relative to cwd). Missing/unreadable files are simply absent — never
   *  a fabricated empty string, matching coverage-runner.ts's own
   *  "null means genuinely unmeasurable" convention. */
  files: Record<string, string>
  /** Set when sandbox creation itself failed (e.g. auth, quota) — distinct
   *  from any individual command failing. */
  sandboxError?: string
}

export interface SandboxSessionOptions {
  /** Wall-clock ceiling PER COMMAND (ms). Applied to sandbox creation too. */
  timeoutMs: number
  /** Working directory inside the sandbox to write files into and run commands from. */
  cwd?: string
  /** Paths (relative to cwd) to read back out after the LAST command
   *  finishes, before the sandbox is torn down — e.g. a coverage-summary.json. */
  readBack?: string[]
}

const DEFAULT_CWD = '/home/user/app'

/**
 * Is E2B configured in this environment? Mirrors the isBedrockEnabled()
 * pattern in lib/bedrock-client.ts — a half-configured environment should
 * fail closed (caller falls back / reports "cannot verify"), never silently
 * run unsandboxed.
 */
export function isE2BEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.E2B_API_KEY
}

/**
 * Write a FileMap into a fresh E2B sandbox, run each command in `commands`
 * IN ORDER (stopping early if one throws — a crashed/timed-out step means
 * later steps couldn't have run anyway), read back any requested output
 * files, and tear the sandbox down. Always kills the sandbox before
 * returning, even on error.
 */
export async function runSequenceInE2BSandbox(
  files: FileMap,
  commands: Array<{ command: string; args: string[] }>,
  opts: SandboxSessionOptions,
): Promise<SandboxSessionResult> {
  const cwd = opts.cwd || DEFAULT_CWD
  let sandbox: Sandbox | null = null
  const commandResults: SandboxCommandResult[] = []

  try {
    sandbox = await Sandbox.create({ timeoutMs: opts.timeoutMs })
  } catch (e) {
    return {
      commandResults: [],
      files: {},
      sandboxError: e instanceof Error ? e.message : String(e),
    }
  }

  try {
    await sandbox.commands.run(`mkdir -p ${cwd}`, { timeoutMs: opts.timeoutMs })

    const writeEntries = Object.entries(files).map(([relPath, content]) => ({
      path: `${cwd}/${relPath.replace(/^\/+/, '')}`,
      data: content,
    }))
    if (writeEntries.length > 0) {
      await sandbox.files.write(writeEntries)
    }

    for (const { command, args } of commands) {
      const fullCommand = [command, ...args].join(' ')
      try {
        const result = await sandbox.commands.run(fullCommand, {
          cwd,
          timeoutMs: opts.timeoutMs,
        })
        // A command that exits 0 never reaches here as an error — if we're
        // in this branch, result.exitCode is always 0.
        commandResults.push({
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: false,
        })
      } catch (e) {
        // The SDK throws CommandExitError (not a normal return) on ANY
        // non-zero exit code — verified live 2026-10-02: a deliberately
        // failing vitest run surfaced as a thrown error with exitCode=null/
        // stdout='' if treated as a generic exception, silently losing the
        // real exit code and test output. CommandExitError carries the real
        // exitCode/stdout/stderr (it implements CommandResult) — extract
        // them instead of collapsing every failure into "crashed".
        if (e instanceof CommandExitError) {
          commandResults.push({
            exitCode: e.exitCode,
            stdout: e.stdout,
            stderr: e.stderr,
            timedOut: false,
          })
        } else {
          const message = e instanceof Error ? e.message : String(e)
          commandResults.push({
            exitCode: null,
            stdout: '',
            stderr: message,
            timedOut: /timeout/i.test(message),
          })
        }
        // Either a genuine non-zero exit or a real crash/timeout — the next
        // step can't produce a meaningful result against a half-installed
        // app, so stop here, same as the local-subprocess path's
        // early-return-on-install-failure.
        break
      }
    }

    const readBackFiles: Record<string, string> = {}
    for (const relPath of opts.readBack || []) {
      try {
        const content = await sandbox.files.read(`${cwd}/${relPath.replace(/^\/+/, '')}`)
        if (typeof content === 'string') readBackFiles[relPath] = content
      } catch {
        // Genuinely missing/unreadable — leave absent, never a fabricated
        // empty string.
      }
    }

    return { commandResults, files: readBackFiles }
  } finally {
    await sandbox.kill().catch(() => {})
  }
}
