/**
 * POST /api/build/repair-app (real bug fix, follow-up to #564) — actually
 * consumes register-app's `retry:true` signal, which had NO consumer at all
 * before this. checkAppReady() (lib/build/ready-gate.ts)'s pre-deploy parse
 * gate can reject a build that rendered fine client-side (a real, live,
 * recurring failure mode — hit 2 of 3 real E2E generation attempts against
 * production during verification of #563) with a genuine syntax error the
 * earlier in-request retry loop (chat-ws's runValidationRetryLoop) never saw,
 * because it runs later, against the STORED code, potentially in a different
 * process. Previously the founder was left staring at a permanently-broken
 * build with no path forward except starting over from scratch.
 *
 * This mirrors chat-ws's own repair loop (same model rotation, same repair-
 * prompt builder) but operates on the STORED broken code instead of a live
 * stream: resolve it, build a targeted repair instruction centered on the
 * real error line (extractErrorWindow — builder#531), call a real model,
 * re-validate with the SAME parse gate register-app uses, and on success
 * persist BOTH the in-memory and durable copies so the very next register-app
 * call sees the fixed code and actually registers it.
 *
 * POST { chatId, error } → { ok, recovered, attempts }
 *   Best-effort: any failure returns `{ ok:false }`, never a 500 — a repair
 *   hiccup must not be worse than the pre-existing "stuck forever" state.
 *
 * POST { chatId, files } (real bug fix, "shoplo", 2026-11-03) — an explicit
 * replace-files mode for when a human/operator already has a KNOWN-CORRECT
 * files map in hand (e.g. deterministically derived via stripTrailingProse,
 * not freshly LLM-generated) and the normal repair path can't reach it —
 * e.g. an earlier repair already collapsed the stored files map into a
 * single flattened blob with no `// --- FILE:` markers, so there's nothing
 * left for the mechanical/LLM repair above to re-split. This is NOT a free
 * "write anything" backdoor: every `.tsx`/`.jsx` entry in `files` MUST
 * independently pass the SAME `isRenderable` parse gate register-app uses
 * before anything is persisted — a caller cannot push code the gate would
 * otherwise reject.
 * → { ok, recovered: true, method: 'explicit-files' } | { ok:false, reason }
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { resolveStoredApp } from '@/lib/build/ready-gate'
import { runValidationRetryLoop, buildRepairPrompt, extractErrorWindow } from '@/lib/generation-retry'
import { isRenderable, extractRenderableCode } from '@/lib/code-validator'
import { stripTrailingProse } from '@/lib/multi-file-parser'
import { storePreview } from '@/lib/preview-store'
import { storeFiles } from '@/lib/preview-store-v2'
import { saveGeneration } from '@/lib/zerodb-store'
import { getAinativeApiKey } from '@/lib/build/env-keys'

export const runtime = 'nodejs'
export const maxDuration = 120

const ainativeBaseURL = (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1'
const ainativeClient = new OpenAI({
  apiKey: getAinativeApiKey(),
  baseURL: ainativeBaseURL,
  maxRetries: 0,
})

const REPAIR_MODELS = ['qwen-coder-32b', 'gpt-oss-20b', 'ministral-14b']

/**
 * Blank out string/template-literal and block-comment content, char-for-
 * char (newlines preserved so offsets still line up with the original
 * text). Deliberately leaves `//` line comments untouched — a genuine
 * `// --- FILE:` marker IS a line comment, so masking line comments too
 * would blank real markers right along with decoy ones. Same shape as
 * lib/code-validator.ts's extractRenderableCode fix (#1962).
 */
function maskStringsAndBlockCommentsForFileMarkerScan(content: string): string {
  let out = ''
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    const next = content[i + 1]
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < content.length && content[j] !== ch) {
        if (content[j] === '\\') j++
        j++
      }
      const end = j >= content.length ? content.length - 1 : j
      out += content.slice(i, end + 1).replace(/[^\n]/g, ' ')
      i = end + 1
      continue
    }
    if (ch === '`') {
      let j = i + 1
      while (j < content.length && content[j] !== '`') {
        if (content[j] === '\\') j++
        j++
      }
      const end = j >= content.length ? content.length - 1 : j
      out += content.slice(i, end + 1).replace(/[^\n]/g, ' ')
      i = end + 1
      continue
    }
    if (ch === '/' && next === '*') {
      let end = content.indexOf('*/', i + 2)
      end = end === -1 ? content.length : end + 2
      out += content.slice(i, Math.min(end, content.length)).replace(/[^\n]/g, ' ')
      i = Math.min(end, content.length)
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Split `content` on `// --- FILE:` markers, verified against a string/
 * template/block-comment-masked view so a decoy marker-shaped substring
 * sitting inside a repaired file's own string, template literal, or block
 * comment isn't mistaken for a real file boundary — this route's own
 * re-split used to split the raw, unmasked repaired code directly on the
 * unmasked marker pattern, with the marker regex not even anchored to a
 * full line, so a decoy could trigger it from anywhere,
 * including inside a single-line string. Same bug class and fix shape as
 * lib/code-validator.ts's extractRenderableCode (#1962), unmerged PR #1965
 * at time of writing — duplicated locally here per this codebase's
 * established per-file-copy convention for this exact scan (see
 * lib/build/bracket-scanner.ts's module doc).
 */
function splitOnRealFileMarkers(content: string): string[] {
  const masked = maskStringsAndBlockCommentsForFileMarkerScan(content)
  const marker = /\/\/\s*---\s*FILE:\s*/gi
  const parts: string[] = []
  let lastEnd = 0
  let m: RegExpExecArray | null
  while ((m = marker.exec(masked)) !== null) {
    parts.push(content.slice(lastEnd, m.index))
    lastEnd = m.index + m[0].length
  }
  parts.push(content.slice(lastEnd))
  return parts
}

// #1299: this repair call had no timeout — runValidationRetryLoop (lib/
// generation-retry.ts) has no bound of its own around the generate()
// callback it's given, so a hung upstream call here left this request (and
// the retry loop's maxRetries=3 budget) stuck indefinitely instead of
// honestly failing within this route's maxDuration=120s.
const REPAIR_CALL_TIMEOUT_MS = Number(process.env.REPAIR_CALL_TIMEOUT_MS || 30_000)

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const chatId = String(body?.chatId || '').trim()
  const error = String(body?.error || '').trim()
  if (!chatId) return Response.json({ ok: false, reason: 'chatId required' }, { status: 400 })

  // Explicit replace-files mode (see doc comment above) — validated against
  // the SAME gate as every other path before anything is persisted.
  if (body?.files && typeof body.files === 'object' && !Array.isArray(body.files)) {
    const files = body.files as Record<string, unknown>
    const entries = Object.entries(files).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    )
    if (entries.length === 0) return Response.json({ ok: false, reason: 'files must be a non-empty string map' })
    const invalid = entries.find(
      ([path, content]) => (path.endsWith('.tsx') || path.endsWith('.jsx')) && !isRenderable(content).ok,
    )
    if (invalid) {
      return Response.json({
        ok: false,
        reason: `rejected: ${invalid[0]} fails the parse gate — ${isRenderable(invalid[1]).error}`,
      })
    }
    const validatedFiles = Object.fromEntries(entries)
    storeFiles(chatId, validatedFiles)
    const combined = entries.map(([, content]) => content).join('\n')
    storePreview(chatId, combined)
    await saveGeneration({
      chatId, prompt: 'repair-explicit-files', generatedCode: combined,
      model: 'explicit-files', codeLength: combined.length, files: validatedFiles,
    }).catch(() => {})
    return Response.json({ ok: true, recovered: true, method: 'explicit-files' })
  }

  const stored = await resolveStoredApp(chatId, { requireFiles: true }).catch(() => null)
  if (!stored?.code) return Response.json({ ok: false, reason: 'no_stored_code' })

  // Deterministic pre-check (real bug, "shoplo", 2026-11-03): a multi-file
  // generation's LAST file can carry trailing chat-style commentary the
  // model appended after finishing the real code — the same class of bug
  // parseMultiFileOutput's stripTrailingProse() now prevents at generation
  // time, but an app generated before that fix shipped can still have it
  // baked into its stored files map. Try this free, instant, no-LLM-call
  // fix FIRST: it's exactly the failure shape the 3-attempt LLM repair loop
  // below was observed failing on for this exact bug (the model kept
  // "fixing" other things while leaving the real syntax error in place).
  if (stored.files && Object.keys(stored.files).length > 0) {
    const mechanicallyFixed: Record<string, string> = {}
    let anyChanged = false
    for (const [path, content] of Object.entries(stored.files)) {
      const fixed = stripTrailingProse(content)
      if (fixed !== content) anyChanged = true
      mechanicallyFixed[path] = fixed
    }
    if (anyChanged) {
      const stillBroken = Object.entries(mechanicallyFixed).some(
        ([path, content]) => (path.endsWith('.tsx') || path.endsWith('.jsx')) && !isRenderable(content).ok,
      )
      if (!stillBroken) {
        storeFiles(chatId, mechanicallyFixed)
        const combined = Object.values(mechanicallyFixed).join('\n')
        storePreview(chatId, combined)
        await saveGeneration({
          chatId, prompt: 'repair-mechanical', generatedCode: combined,
          model: 'strip-trailing-prose', codeLength: combined.length, files: mechanicallyFixed,
        }).catch(() => {})
        return Response.json({ ok: true, recovered: true, attempts: 0, method: 'mechanical' })
      }
    }
  }

  try {
    const result = await runValidationRetryLoop(
      { valid: false, error: error || 'unknown error', code: stored.code },
      {
        maxRetries: 3,
        models: REPAIR_MODELS,
        prompt: extractErrorWindow(stored.code, error),
        generate: async (model, err, brokenCode) => {
          const res = await ainativeClient.chat.completions.create(
            {
              model,
              max_tokens: 8192,
              temperature: 0.5,
              messages: [
                {
                  role: 'system',
                  content:
                    'You fix broken React code. Return ONLY valid, complete React code wrapped in ```jsx markers. ' +
                    'Every JSX tag closed, every string terminated, every bracket matched, and every component ' +
                    'used in JSX must be defined here, imported, or a known primitive — never reference an undefined component.',
                },
                { role: 'user', content: buildRepairPrompt(brokenCode, err) },
              ],
            },
            { signal: AbortSignal.timeout(REPAIR_CALL_TIMEOUT_MS) },
          )
          return res.choices?.[0]?.message?.content || ''
        },
        validate: (raw) => {
          const gate = isRenderable(raw)
          return { valid: gate.ok, error: gate.error, code: extractRenderableCode(raw) }
        },
      },
    )

    if (result.recovered) {
      storePreview(chatId, result.code)
      // Best-effort durable persist — the in-memory store above is what
      // register-app's very next call will actually see first.
      await saveGeneration({
        chatId, prompt: 'repair', generatedCode: result.code,
        model: 'repair-loop', codeLength: result.code.length,
      }).catch(() => {})
      const fileParts = splitOnRealFileMarkers(result.code)
      if (fileParts.length > 1) {
        try {
          const files: Record<string, string> = {}
          for (const part of fileParts.filter(Boolean)) {
            const [name, ...rest] = part.split('\n')
            if (name?.trim()) files[name.trim()] = rest.join('\n')
          }
          if (Object.keys(files).length > 0) storeFiles(chatId, files)
        } catch {
          /* multi-file re-split failed — single-file code is still stored above */
        }
      }
    }

    return Response.json({ ok: result.recovered, recovered: result.recovered, attempts: result.attempts })
  } catch (e) {
    return Response.json({ ok: false, reason: (e as Error)?.message || 'repair_failed' })
  }
}
