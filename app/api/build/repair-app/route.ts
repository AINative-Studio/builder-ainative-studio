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
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { resolveStoredApp } from '@/lib/build/ready-gate'
import { runValidationRetryLoop, buildRepairPrompt, extractErrorWindow } from '@/lib/generation-retry'
import { isRenderable, extractRenderableCode } from '@/lib/code-validator'
import { storePreview } from '@/lib/preview-store'
import { storeFiles } from '@/lib/preview-store-v2'
import { saveGeneration } from '@/lib/zerodb-store'

export const runtime = 'nodejs'
export const maxDuration = 120

const ainativeBaseURL = (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1'
const ainativeClient = new OpenAI({
  apiKey: process.env.AINATIVE_API_KEY || process.env.API_Key || process.env.ZERODB_API_KEY || '',
  baseURL: ainativeBaseURL,
  maxRetries: 0,
})

const REPAIR_MODELS = ['qwen-coder-32b', 'gpt-oss-20b', 'ministral-14b']

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const chatId = String(body?.chatId || '').trim()
  const error = String(body?.error || '').trim()
  if (!chatId) return Response.json({ ok: false, reason: 'chatId required' }, { status: 400 })

  const stored = await resolveStoredApp(chatId).catch(() => null)
  if (!stored?.code) return Response.json({ ok: false, reason: 'no_stored_code' })

  try {
    const result = await runValidationRetryLoop(
      { valid: false, error: error || 'unknown error', code: stored.code },
      {
        maxRetries: 3,
        models: REPAIR_MODELS,
        prompt: extractErrorWindow(stored.code, error),
        generate: async (model, err, brokenCode) => {
          const res = await ainativeClient.chat.completions.create({
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
          })
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
      if (result.code.includes('// --- FILE:')) {
        try {
          const parts = result.code.split(/\/\/\s*---\s*FILE:\s*/i).filter(Boolean)
          const files: Record<string, string> = {}
          for (const part of parts) {
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
