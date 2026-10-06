# Epic 2 Wave 2 + Epic 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the guided-conversation layer on top of Wave 1's workspace shell: Cody summarizes steps, asks questions and revises drafts, lets founders save/restore versions, explains before building, and carries answers forward (Epic 2 Wave 2) — plus moves idea entry and kickoff into the chat, before signup, with anonymous draft autosave (Epic 3).

**Architecture:** Every story reuses the REAL, already-shipped mechanisms confirmed in the spec: `getClaudeCompletion()` for new LLM calls, `/api/build/artifact` + `feedbackInstruction`/`collectPrior` for revision, `prior` for answer-carrying. Only two genuinely new subsystems: artifact version history (BLD-06.4) and server-side anonymous draft storage (E3.4).

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest, ZeroDB REST, Bedrock/Anthropic via `lib/build/claude-completion.ts`.

**Spec:** `docs/superpowers/specs/2026-10-06-epic2-wave2-guided-conversation-design.md`

## Global Constraints

- TDD: RED test first, watched failing, then GREEN, never skip.
- `npx tsc --noEmit` clean.
- Full `npx vitest run` green except the known `task-splitter.test.ts` flake.
- One GitHub issue per task before any code.
- Real PR per task, real CI, real Railway deploy verification via `/api/health` SHA match.
- `pnpm build` (real Turbopack command) at least once per task that touches a client-reachable import, per Epic 1 Task 4's hard lesson — a server-only import leaking into a client component breaks production in a way `npx tsc --noEmit` alone will not catch.
- Genuine human-style browser verification on both tracks before calling a task done. Proceed without stopping between tasks or waiting for a human checkpoint — this is an explicit standing instruction this session.
- No jargon in new user-facing copy.
- Never fabricate a passing LLM call in a test — mock `getClaudeCompletion()`'s client at the SDK boundary (its `.messages.create()` call), matching how `app/api/build/artifact/route.ts`'s own existing tests must already do this (check one before writing a new test, don't invent a different mocking shape).

## Review Focus

- A founder who answers zero kickoff questions must still reach generation (never a hard gate).
- Composed Q&A feedback must never truncate mid-question at the 2000-char `FEEDBACK_MAX_CHARS` boundary.
- An unsaved-draft prompt (BLD-06.4) must never block forward navigation — it asks, never refuses.
- BLD-06.9's pre-build gate must only cover real build-stage views (`swarm`/`infra`/`preview`), not collide with BLD-06.2's per-step summary on every other view.
- The anon-draft token (E3.4) must never be logged or appear in a URL; the purge cron must hard-delete past 30 days.

---

### Task 1: `lib/build/cody-chat.ts` + `POST /api/build/cody-summary` (BLD-06.2)

**Files:**
- Create: `lib/build/cody-chat.ts`
- Create: `app/api/build/cody-summary/route.ts`
- Test: `__tests__/lib/build/cody-chat.test.ts`
- Test: `__tests__/api/build-cody-summary.test.ts`

**Interfaces:**
- Consumes: `getClaudeCompletion()` (existing, `lib/build/claude-completion.ts`) — `{client, provider, model, label}` or `null`.
- Produces: `summarizeArtifactStep(view: string, track: 'app' | 'company', content: unknown): Promise<{ok: true, summary: string} | {ok: false, reason: string}>`, consumed by Task 2's chat panel wiring.

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(cody-chat): Cody summarizes each step in plain words (BLD-06.2)" \
  --body "Part of Epic 2 Wave 2. Adds summarizeArtifactStep using the existing getClaudeCompletion() provider chain (no new model/endpoint) -- a 3-sentences-or-fewer, plain-language summary of the current step, shown in CodyChatPanel." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test for `summarizeArtifactStep`**

First read `app/api/build/artifact/route.ts`'s own test file (find it via `find __tests__ -iname "*build-artifact*"`) to copy its EXACT mocking shape for `getClaudeCompletion()` before writing this test — do not invent a different mock shape.

```typescript
// __tests__/lib/build/cody-chat.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), getClaudeCompletion: vi.fn() }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))

describe('summarizeArtifactStep (#BLD-06.2)', () => {
  beforeEach(() => {
    h.create.mockReset()
    h.getClaudeCompletion.mockReset().mockReturnValue({
      client: { messages: { create: h.create } }, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', label: 'Anthropic',
    })
  })

  it('returns a real summary from the completion client', async () => {
    h.create.mockResolvedValue({ content: [{ type: 'text', text: 'This is your venture thesis. It names who you help and why. Cody drafted it from your idea.' }] })
    const { summarizeArtifactStep } = await import('@/lib/build/cody-chat')
    const result = await summarizeArtifactStep('thesis', 'company', { headline: 'x' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toContain('venture thesis')
      expect(h.create).toHaveBeenCalledTimes(1)
    }
  })

  it('returns ok:false when no provider is configured, never throws', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    const { summarizeArtifactStep } = await import('@/lib/build/cody-chat')
    const result = await summarizeArtifactStep('thesis', 'company', {})
    expect(result).toEqual({ ok: false, reason: 'not_configured' })
  })

  it('returns ok:false, never throws, when the completion call itself fails', async () => {
    h.create.mockRejectedValue(new Error('provider 500'))
    const { summarizeArtifactStep } = await import('@/lib/build/cody-chat')
    const result = await summarizeArtifactStep('thesis', 'company', {})
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/cody-chat.test.ts`
Expected: FAIL — `@/lib/build/cody-chat` doesn't exist yet.

- [ ] **Step 4: Implement `summarizeArtifactStep`**

```typescript
// lib/build/cody-chat.ts
/**
 * Cody's plain-language step summaries and questions (#BLD-06.2/06.3),
 * built on the SAME provider chain /api/build/artifact already uses --
 * never a new model/endpoint.
 */
import { getClaudeCompletion } from '@/lib/build/claude-completion'

export interface SummaryResult {
  ok: boolean
  summary?: string
  reason?: string
}

const SUMMARY_SYSTEM_PROMPT = `You explain a single step of a founder's business or product plan in plain, everyday language.
Rules:
- 3 sentences or fewer.
- No jargon: never use the words "wedge", "PRD", "data model", "memory policy", "AI-native", "swarm", or "provision".
- Say what this step is and why it matters to the founder, not how it was generated.`

export async function summarizeArtifactStep(
  view: string,
  track: 'app' | 'company',
  content: unknown,
): Promise<SummaryResult> {
  const completion = getClaudeCompletion()
  if (!completion) return { ok: false, reason: 'not_configured' }
  try {
    const res = await completion.client.messages.create({
      model: completion.model,
      max_tokens: 300,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Track: ${track}. Step: ${view}. Generated content:\n${JSON.stringify(content).slice(0, 4000)}`,
      }],
    })
    const text = res?.content?.find((b: { type: string }) => b.type === 'text')?.text
    if (!text) return { ok: false, reason: 'empty_response' }
    return { ok: true, summary: String(text).trim() }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/cody-chat.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 6: Write the failing test for the route**

```typescript
// __tests__/api/build-cody-summary.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ summarizeArtifactStep: vi.fn() }))
vi.mock('@/lib/build/cody-chat', () => ({ summarizeArtifactStep: h.summarizeArtifactStep }))

import { POST } from '@/app/api/build/cody-summary/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/build/cody-summary (#BLD-06.2)', () => {
  beforeEach(() => { h.summarizeArtifactStep.mockReset() })

  it('returns the real summary on success', async () => {
    h.summarizeArtifactStep.mockResolvedValue({ ok: true, summary: 'Plain summary.' })
    const res = await POST(req({ view: 'thesis', track: 'company', content: {} }))
    expect(res.status).toBe(200)
    expect((await res.json()).summary).toBe('Plain summary.')
  })

  it('returns 200 with ok:false on a provider gap, never a 500', async () => {
    h.summarizeArtifactStep.mockResolvedValue({ ok: false, reason: 'not_configured' })
    const res = await POST(req({ view: 'thesis', track: 'company', content: {} }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false)
  })

  it('rejects a missing view', async () => {
    const res = await POST(req({ track: 'company', content: {} }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run __tests__/api/build-cody-summary.test.ts`
Expected: FAIL — the route doesn't exist yet.

- [ ] **Step 8: Implement the route**

```typescript
// app/api/build/cody-summary/route.ts
import { NextRequest } from 'next/server'
import { summarizeArtifactStep } from '@/lib/build/cody-chat'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const view = String(b?.view || '')
  const track = b?.track === 'app' ? 'app' : 'company'
  if (!view) return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400 })

  const result = await summarizeArtifactStep(view, track, b?.content)
  return Response.json(result, { status: 200 })
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run __tests__/api/build-cody-summary.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 10: Wire into `CodyChatPanel`**

Add a `useEffect` in `components/build/CodyChatPanel.tsx` keyed on `state.view` (and the generated content for that view, once it exists) that calls `POST /api/build/cody-summary` and replaces the static "You're on {view}." line with the real summary when it resolves; keep the static line as the loading/fallback state (never blank). Component-state cache only (a `Map<string, string>` keyed by `view`, reset is fine on reload — no persistence needed per the spec).

- [ ] **Step 11: Write the failing test for the panel wiring**

```typescript
// __tests__/components/build/CodyChatPanel-summary.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

let currentView = 'thesis'
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { view: currentView, track: 'company', generated: { thesis: { headline: 'x' } } } }),
}))

import { CodyChatPanel } from '@/components/build/CodyChatPanel'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}
afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('CodyChatPanel — real summary (#BLD-06.2)', () => {
  it('replaces the static line with the real summary once the API resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, summary: 'This is your venture thesis, plainly explained.' }) })))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.textContent).toContain('This is your venture thesis, plainly explained.')
  })

  it('keeps the static fallback line when the summary call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, reason: 'not_configured' }) })))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.textContent).toContain('thesis')
  })
})
```

- [ ] **Step 12: Run it to verify it fails, then implement, then verify it passes**

Run: `npx vitest run __tests__/components/build/CodyChatPanel-summary.test.tsx` — FAIL first (no fetch call wired), implement per Step 10, then PASS 2/2.

- [ ] **Step 13: Run the full suite, typecheck, real build**

```bash
npx vitest run
npx tsc --noEmit
pnpm build
```
Expected: suite green except known flake; typecheck clean; build completes (watch specifically for any new "Module not found" error — `cody-chat.ts` is server-only but confirm `CodyChatPanel.tsx`, a client component, only calls it via `fetch` to the route, never imports it directly).

- [ ] **Step 14: Commit, push, PR, CI, merge, deploy, verify**

Same shape as every prior task this session. Live-verify: open a real workspace, confirm the chat panel's message updates from the static line to real Cody-generated prose within a few seconds of landing on an artifact with generated content.

---

### Task 2: Cody asks questions and revises as a draft (BLD-06.3)

**Files:**
- Modify: `components/build/CodyChatPanel.tsx`
- Create: `lib/build/cody-questions.ts` (per-artifact question sets + feedback composition)
- Test: `__tests__/lib/build/cody-questions.test.ts`
- Test: `__tests__/components/build/CodyChatPanel-questions.test.tsx`

**Interfaces:**
- Consumes: `FEEDBACK_MAX_CHARS` (existing, `lib/build/artifact-edit.ts`), the real `/api/build/artifact` request shape `ArtifactFrame.tsx` already sends.
- Produces: `getQuestionsForView(view: string): CodyQuestion[]`, `composeFeedbackFromAnswers(questions: CodyQuestion[], answers: Record<string, string>): string` — consumed by the panel's new question-answering UI, which calls the SAME `/api/build/artifact` endpoint `ArtifactFrame.tsx` already calls.

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(cody-chat): Cody asks questions and revises the artifact as a draft (BLD-06.3)" \
  --body "Part of Epic 2 Wave 2. Reuses the existing, shipped feedbackInstruction/collectPrior regeneration mechanism (ArtifactFrame.tsx's runRegenerate) -- Cody asks up to 3 structured questions per step (tap-to-answer + free text + Not sure yet) instead of requiring the founder to type free-text feedback themselves." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test for the question sets + feedback composition**

```typescript
// __tests__/lib/build/cody-questions.test.ts
import { describe, it, expect } from 'vitest'
import { getQuestionsForView, composeFeedbackFromAnswers } from '@/lib/build/cody-questions'
import { FEEDBACK_MAX_CHARS } from '@/lib/build/artifact-edit'

describe('getQuestionsForView (#BLD-06.3)', () => {
  it('returns at most 3 questions for thesis', () => {
    const qs = getQuestionsForView('thesis')
    expect(qs.length).toBeLessThanOrEqual(3)
    expect(qs.length).toBeGreaterThan(0)
  })

  it('every question has 2-4 suggestions plus always allows free text and "Not sure yet"', () => {
    const qs = getQuestionsForView('thesis')
    for (const q of qs) {
      expect(q.suggestions.length).toBeGreaterThanOrEqual(2)
      expect(q.suggestions.length).toBeLessThanOrEqual(4)
      expect(q.allowFreeText).toBe(true)
    }
  })

  it('returns an empty array for a view with no authored question set, never throws', () => {
    expect(getQuestionsForView('swarm')).toEqual([])
  })
})

describe('composeFeedbackFromAnswers (#BLD-06.3)', () => {
  it('composes a Q&A feedback string from answered questions only', () => {
    const qs = getQuestionsForView('thesis')
    const answers = { [qs[0].id]: qs[0].suggestions[0] }
    const fb = composeFeedbackFromAnswers(qs, answers)
    expect(fb).toContain(qs[0].suggestions[0])
  })

  it('skips unanswered and "Not sure yet" questions entirely', () => {
    const qs = getQuestionsForView('thesis')
    const fb = composeFeedbackFromAnswers(qs, {})
    expect(fb).toBe('')
  })

  it('never exceeds FEEDBACK_MAX_CHARS, clipped at a whole-question boundary', () => {
    const qs = getQuestionsForView('thesis')
    const longAnswer = 'x'.repeat(FEEDBACK_MAX_CHARS)
    const answers = Object.fromEntries(qs.map((q) => [q.id, longAnswer]))
    const fb = composeFeedbackFromAnswers(qs, answers)
    expect(fb.length).toBeLessThanOrEqual(FEEDBACK_MAX_CHARS)
    // never cuts mid-question: the string either contains a full "Q:" block or omits it entirely
    expect(fb.endsWith('"""') || fb === '').toBe(true)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/cody-questions.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `cody-questions.ts`**

```typescript
// lib/build/cody-questions.ts
/**
 * Per-artifact guided questions (#BLD-06.3). Targets the real "ASSUMPTION ·
 * TBD" markers a generated artifact leaves when the idea alone didn't
 * answer something -- authored for the steps where that gap is most
 * visible today; other views return [] honestly rather than a guessed
 * generic question set.
 */
import { FEEDBACK_MAX_CHARS } from '@/lib/build/artifact-edit'

export interface CodyQuestion {
  id: string
  text: string
  suggestions: string[]
  allowFreeText: true
}

const QUESTION_SETS: Record<string, CodyQuestion[]> = {
  thesis: [
    {
      id: 'who',
      text: 'Who feels this problem the most?',
      suggestions: ['People in my area', 'Other businesses', 'A specific group'],
      allowFreeText: true,
    },
    {
      id: 'problem',
      text: "What's the problem you'd fix for them?",
      suggestions: ['Finding customers', 'Getting paid', 'Too much admin'],
      allowFreeText: true,
    },
  ],
  wedge: [
    {
      id: 'first-customers',
      text: 'How would you like to reach your first customers?',
      suggestions: ['Word of mouth', 'Social media', 'Local ads', 'Partnerships'],
      allowFreeText: true,
    },
  ],
  businessmodel: [
    {
      id: 'pricing',
      text: 'How would you like to get paid?',
      suggestions: ['Monthly subscription', 'Per job', 'One-time purchase'],
      allowFreeText: true,
    },
  ],
}

export function getQuestionsForView(view: string): CodyQuestion[] {
  return QUESTION_SETS[view] || []
}

const NOT_SURE = 'not sure yet'

export function composeFeedbackFromAnswers(questions: CodyQuestion[], answers: Record<string, string>): string {
  const lines: string[] = []
  for (const q of questions) {
    const a = (answers[q.id] || '').trim()
    if (!a || a.toLowerCase() === NOT_SURE) continue
    const line = `Q: ${q.text}\nA: ${a}`
    lines.push(line)
  }
  if (!lines.length) return ''
  let body = lines.join('\n\n')
  // Clip at a whole-question boundary, never mid-sentence -- drop trailing
  // entries one at a time until the composed instruction fits.
  const wrap = (s: string) =>
    `\n\nThe founder answered Cody's questions about this step. Apply these answers while keeping the rest consistent with the idea and prior artifacts:\n"""${s}"""`
  while (wrap(body).length > FEEDBACK_MAX_CHARS && lines.length > 0) {
    lines.pop()
    body = lines.join('\n\n')
  }
  return lines.length ? wrap(body) : ''
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/cody-questions.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 6: Write the failing test for the panel's question-answering UI**

```typescript
// __tests__/components/build/CodyChatPanel-questions.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { view: 'thesis', track: 'company', idea: 'a real idea', companyName: 'Acme', generated: { thesis: { headline: 'x' } }, appChatId: 'chat-1', auto: false },
    views: ['design', 'thesis', 'wedge', 'businessmodel', 'positioning', 'landing', 'plan30'],
    dispatch: dispatchMock,
  }),
}))

import { CodyChatPanel } from '@/components/build/CodyChatPanel'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}
afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('CodyChatPanel — questions and revise (#BLD-06.3)', () => {
  it('shows tap-to-answer suggestions and a "Not sure yet" option for the current step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, summary: 'x' }) })))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.textContent).toContain('Not sure yet')
    expect(host.querySelector('[data-testid="cody-question-suggestion"]')).toBeTruthy()
  })

  it('answering a question and confirming calls /api/build/artifact with composed feedback, then dispatches GEN_DONE', async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/build/cody-summary') return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
      if (url === '/api/build/artifact') {
        const body = JSON.parse(opts.body)
        expect(body.feedback).toContain('Q:')
        expect(body.view).toBe('thesis')
        return { ok: true, json: async () => ({ content: { headline: 'revised' } }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(CodyChatPanel))
    await tick()
    const suggestion = host.querySelector('[data-testid="cody-question-suggestion"]') as HTMLButtonElement
    await act(async () => { suggestion.click() })
    const confirmBtn = host.querySelector('[data-testid="cody-questions-submit"]') as HTMLButtonElement
    await act(async () => { confirmBtn.click(); await tick() })
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'GEN_DONE', view: 'thesis', content: { headline: 'revised' } }))
  })

  it('"Keep as is" never calls /api/build/artifact', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/build/artifact') throw new Error('must not be called')
      return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(CodyChatPanel))
    await tick()
    const keepBtn = host.querySelector('[data-testid="cody-questions-keep"]') as HTMLButtonElement
    await act(async () => { keepBtn.click(); await tick() })
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GEN_DONE' }))
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run __tests__/components/build/CodyChatPanel-questions.test.tsx`
Expected: FAIL — no question UI exists yet.

- [ ] **Step 8: Implement the panel's question-answering UI**

In `components/build/CodyChatPanel.tsx`, import `getQuestionsForView`/`composeFeedbackFromAnswers` from Step 4, and `collectPrior` from `lib/build/artifact-edit.ts`. Add: component state for `answers: Record<string, string>` and `regenerating: boolean`; render `getQuestionsForView(state.view)` as a list, each with its suggestions (`data-testid="cody-question-suggestion"`) plus a free-text input and a "Not sure yet" chip, all writing into the local `answers` state; a "Keep as is" button (`data-testid="cody-questions-keep"`, clears local state, no network call) and a submit button (`data-testid="cody-questions-submit"`) that composes feedback via `composeFeedbackFromAnswers`, then calls `/api/build/artifact` with the exact same body shape `ArtifactFrame.tsx`'s `runRegenerate` sends (`view, idea: state.idea, track: state.track, companyName, prior: collectPrior(views, state.generated, state.view), feedback, companyId: state.appChatId`), dispatching `GEN_DONE` on success / `GEN_FAIL` on failure, matching `runRegenerate`'s own error handling exactly (do not invent a different failure path for the same request shape).

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run __tests__/components/build/CodyChatPanel-questions.test.tsx`
Expected: PASS, 3/3.

- [ ] **Step 10: Run the full suite, typecheck, real build, commit, push, PR, CI, merge, deploy, verify**

Same shape as Task 1's closing steps. Live-verify: on a real workspace, land on `thesis`, confirm the question UI renders with real tap suggestions, answer one, submit, confirm the artifact content visibly changes (a real regenerate happened) and the chat panel doesn't error.

---

### Task 3: Save from chat, version history, restore (BLD-06.4)

**Files:**
- Create: `lib/build/artifact-versions.ts`
- Modify: `components/build/CodyChatPanel.tsx` (Save button, unsaved-draft prompt)
- Test: `__tests__/lib/build/artifact-versions.test.ts`
- Test: `__tests__/components/build/CodyChatPanel-save.test.tsx`

**Interfaces:**
- Produces: `saveArtifactVersion(companyId: string, view: string, content: unknown, label?: string): Promise<{ok: boolean}>`, `listArtifactVersions(companyId: string, view: string): Promise<ArtifactVersion[]>`, `restoreArtifactVersion(companyId: string, view: string, versionId: string): Promise<{ok: boolean, content?: unknown}>`.

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(cody-chat): save from chat, version history, restore (BLD-06.4)" \
  --body "Part of Epic 2 Wave 2. Genuinely new subsystem -- no artifact-content version history exists anywhere in this codebase today (document-store.ts's upsertDocument is confirmed overwrite-only). New builder_artifact_versions ZeroDB table, same ensureTable-then-write idempotent-create pattern as otp.ts/funnel-events.ts." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test for `artifact-versions.ts`**

```typescript
// __tests__/lib/build/artifact-versions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(storedRows: Array<Record<string, unknown>>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' && u.includes('/rows')) {
      const body = JSON.parse(String(init.body))
      storedRows.push(body.row_data)
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
    }
    if (u.includes('/rows')) {
      return {
        ok: true, status: 200,
        json: async () => storedRows.map((row_data) => ({ row_data })),
        text: async () => JSON.stringify(storedRows.map((row_data) => ({ row_data }))),
      } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('artifact-versions (#BLD-06.4)', () => {
  it('saves a version and lists it back, newest first', async () => {
    mockFetch([])
    const { saveArtifactVersion, listArtifactVersions } = await import('@/lib/build/artifact-versions')
    await saveArtifactVersion('acme', 'thesis', { headline: 'v1' })
    await new Promise((r) => setTimeout(r, 2))
    await saveArtifactVersion('acme', 'thesis', { headline: 'v2' })
    const versions = await listArtifactVersions('acme', 'thesis')
    expect(versions.length).toBe(2)
    expect((versions[0].content as any).headline).toBe('v2')
  })

  it('restores a specific version by id', async () => {
    const rows: Array<Record<string, unknown>> = []
    mockFetch(rows)
    const { saveArtifactVersion, listArtifactVersions, restoreArtifactVersion } = await import('@/lib/build/artifact-versions')
    await saveArtifactVersion('acme', 'thesis', { headline: 'v1' })
    const versions = await listArtifactVersions('acme', 'thesis')
    const result = await restoreArtifactVersion('acme', 'thesis', versions[0].id)
    expect(result.ok).toBe(true)
    expect((result.content as any).headline).toBe('v1')
  })

  it('never throws when the store write fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '{}' }) as unknown as Response))
    const { saveArtifactVersion } = await import('@/lib/build/artifact-versions')
    const result = await saveArtifactVersion('acme', 'thesis', { headline: 'x' })
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/artifact-versions.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `artifact-versions.ts`**

```typescript
// lib/build/artifact-versions.ts
/**
 * Artifact content version history (#BLD-06.4) -- genuinely new: no
 * version/restore mechanism exists for artifact CONTENT anywhere in this
 * codebase (document-store.ts's upsertDocument is overwrite-only;
 * version-store.ts is Railway deploy history, a different domain).
 * Mirrors the ensureTable-then-write idempotent-create pattern already
 * established in otp.ts/funnel-events.ts.
 */
import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const VERSIONS_TABLE = 'builder_artifact_versions'

export interface ArtifactVersion {
  id: string
  companyId: string
  view: string
  content: unknown
  savedAt: string
  label?: string
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

async function ensureVersionsTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ table_name: VERSIONS_TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* table might already exist */ }
}

function makeId(): string {
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function saveArtifactVersion(
  companyId: string, view: string, content: unknown, label?: string,
): Promise<{ ok: boolean }> {
  if (!configured()) return { ok: false }
  await ensureVersionsTable()
  const id = makeId()
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${VERSIONS_TABLE}/rows`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ row_data: { id, companyId, view, content, savedAt: new Date().toISOString(), label } }),
      signal: AbortSignal.timeout(15000),
    })
    return { ok: res.ok }
  } catch {
    return { ok: false }
  }
}

export async function listArtifactVersions(companyId: string, view: string): Promise<ArtifactVersion[]> {
  if (!configured()) return []
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${VERSIONS_TABLE}/rows?limit=1000`, {
      headers: headers(), signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const matches = rows
      .map((r: { row_data?: ArtifactVersion }) => r.row_data)
      .filter((rd: ArtifactVersion | undefined): rd is ArtifactVersion => Boolean(rd && rd.companyId === companyId && rd.view === view))
    matches.sort((a: ArtifactVersion, b: ArtifactVersion) => (b.savedAt || '').localeCompare(a.savedAt || ''))
    return matches
  } catch {
    return []
  }
}

export async function restoreArtifactVersion(
  companyId: string, view: string, versionId: string,
): Promise<{ ok: boolean; content?: unknown }> {
  const versions = await listArtifactVersions(companyId, view)
  const match = versions.find((v) => v.id === versionId)
  if (!match) return { ok: false }
  return { ok: true, content: match.content }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/artifact-versions.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 6: Write the failing test for the panel's Save + unsaved-draft prompt**

```typescript
// __tests__/components/build/CodyChatPanel-save.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { view: 'thesis', track: 'company', idea: 'x', companyName: 'Acme', generated: { thesis: { headline: 'x' } }, appChatId: 'chat-1', auto: false },
    views: ['design', 'thesis'],
    dispatch: vi.fn(),
  }),
}))

import { CodyChatPanel } from '@/components/build/CodyChatPanel'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}
afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('CodyChatPanel — save (#BLD-06.4)', () => {
  it('"save this" calls the version-save endpoint with the real current content', async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/build/artifact-version') {
        const body = JSON.parse(opts.body)
        expect(body.companyId).toBe('chat-1')
        expect(body.view).toBe('thesis')
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(CodyChatPanel))
    await tick()
    const saveBtn = host.querySelector('[data-testid="cody-save-version"]') as HTMLButtonElement
    expect(saveBtn).toBeTruthy()
    await act(async () => { saveBtn.click(); await tick() })
    expect(fetchMock).toHaveBeenCalledWith('/api/build/artifact-version', expect.objectContaining({ method: 'POST' }))
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run __tests__/components/build/CodyChatPanel-save.test.tsx`
Expected: FAIL — no save button exists yet.

- [ ] **Step 8: Add `POST /api/build/artifact-version` + wire the Save button**

New thin route `app/api/build/artifact-version/route.ts` wrapping `saveArtifactVersion` (mirror Task 1 Step 8's route shape exactly — parse body, call the lib function, `Response.json`). In `CodyChatPanel.tsx`, add a Save button (`data-testid="cody-save-version"`) that POSTs `{companyId: state.appChatId, view: state.view, content: state.generated[state.view]}` to this route. Track a simple `isDraftUnsaved` flag (component state, set true whenever `state.generated[state.view]` changes after the last save, reset on save) — when truthy and the user would navigate to a different `state.view`, show an inline prompt ("Save this version, or keep the last saved one?") with Save/Keep buttons, never blocking the navigation itself (per the spec's Review Focus item).

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run __tests__/components/build/CodyChatPanel-save.test.tsx`
Expected: PASS, 1/1.

- [ ] **Step 10: Run the full suite, typecheck, real build, commit, push, PR, CI, merge, deploy, verify**

Live-verify: generate an artifact, click Save, confirm no error; revise it via Task 2's question flow, confirm the unsaved-draft indicator appears; navigate away, confirm the prompt shows and does not block navigation either way.

---

### Task 4: Answers carry into later steps — integration test (BLD-06.5)

**Files:**
- Test: `__tests__/lib/build/answers-carry-forward.integration.test.ts`

**No production code** — per the spec, this story's mechanism (`prior`/`collectPrior`) already exists and works; the deliverable is a real integration test proving the chain Task 2's answers → Task 3's save → next step's `prior` actually holds together, not new infrastructure.

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "test(cody-chat): verify answers carry into later steps end-to-end (BLD-06.5)" \
  --body "Part of Epic 2 Wave 2. No new production code -- prior/collectPrior already carries every generated artifact's content into the next step's generation request. This verifies the real chain: Task 2's composed Q&A answer -> a real regenerate -> Task 3's save -> the NEXT step's /api/build/artifact request genuinely includes the saved content in its prior payload." \
  --label "test"
```

- [ ] **Step 2: Write the failing integration test**

```typescript
// __tests__/lib/build/answers-carry-forward.integration.test.ts
import { describe, it, expect } from 'vitest'
import { collectPrior } from '@/lib/build/artifact-edit'

describe('answers carry into later steps (#BLD-06.5)', () => {
  it('a saved, revised artifact appears in prior for every later step in the sequence', () => {
    const seq = ['design', 'thesis', 'wedge', 'businessmodel'] as const
    // Simulate: thesis was revised via Task 2's Q&A flow and the result
    // landed in state.generated via GEN_DONE (confirmed real dispatch in
    // ArtifactFrame.tsx/CodyChatPanel.tsx — this test asserts the DOWNSTREAM
    // consequence, not the dispatch itself, which Task 2's own tests cover).
    const generated = { design: { ok: true }, thesis: { headline: 'revised from founder answers' } }

    const priorForWedge = collectPrior(seq, generated, 'wedge')
    expect(priorForWedge.thesis).toEqual({ headline: 'revised from founder answers' })
    expect(priorForWedge.wedge).toBeUndefined() // never includes the view being generated

    const priorForBusinessModel = collectPrior(seq, generated, 'businessmodel')
    expect(priorForBusinessModel.thesis).toEqual({ headline: 'revised from founder answers' })
  })

  it('an unsaved, un-revised step contributes nothing to prior (only real generated content flows forward)', () => {
    const seq = ['design', 'thesis', 'wedge'] as const
    const generated = { design: { ok: true } } // thesis never generated/saved
    const prior = collectPrior(seq, generated, 'wedge')
    expect(prior.thesis).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/answers-carry-forward.integration.test.ts`
Expected: This should actually PASS immediately since `collectPrior` already exists and works — if so, this IS the RED→GREEN proof the mechanism is real (a test that passes against already-correct code is a valid verification test, not a violation of TDD, PROVIDED you can show it would have failed against a plausible bug — e.g., temporarily swap `generated` for an empty object and confirm the test fails, then revert). Document this confirmation in the task's commit message rather than skipping verification because "it already works."

- [ ] **Step 4: Run the full suite, typecheck, commit, push, PR, CI, merge**

No deploy-verification step needed (test-only change, no runtime behavior changes) — still run the full CI/merge cycle for process consistency.

---

### Task 5: Cody explains before building (BLD-06.9)

**Files:**
- Modify: `lib/build/cody-chat.ts` (add `explainBeforeBuilding`)
- Modify: `components/build/CodyChatPanel.tsx` (gate build-stage views)
- Test: `__tests__/lib/build/cody-chat-explain.test.ts`
- Test: `__tests__/components/build/CodyChatPanel-explain-gate.test.tsx`

**Interfaces:**
- Produces: `explainBeforeBuilding(view: string, track: 'app'|'company', idea: string): Promise<{ok: boolean, explanation?: string, reason?: string}>`.

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(cody-chat): Cody explains before building, waits for go-ahead (BLD-06.9)" \
  --body "Part of Epic 2 Wave 2. Reuses CodyNudge's accept/dismiss UI/state pattern (nudgeState, NUDGE dispatch) but with real LLM-generated copy via the same provider chain as BLD-06.2, gating the real build-stage views (swarm/infra/preview) rather than CodyNudge's static per-view PRIMITIVE_MAP text." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test for `explainBeforeBuilding`**

```typescript
// __tests__/lib/build/cody-chat-explain.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), getClaudeCompletion: vi.fn() }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))

describe('explainBeforeBuilding (#BLD-06.9)', () => {
  beforeEach(() => {
    h.create.mockReset()
    h.getClaudeCompletion.mockReset().mockReturnValue({ client: { messages: { create: h.create } }, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', label: 'Anthropic' })
  })

  it('returns a real explanation naming the build and its business goal', async () => {
    h.create.mockResolvedValue({ content: [{ type: 'text', text: "I'm about to build your live preview — this tests whether real customers will sign up." }] })
    const { explainBeforeBuilding } = await import('@/lib/build/cody-chat')
    const result = await explainBeforeBuilding('preview', 'company', 'a scheduling app for tutors')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.explanation).toContain('build')
  })

  it('returns ok:false, never throws, on a provider gap', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    const { explainBeforeBuilding } = await import('@/lib/build/cody-chat')
    const result = await explainBeforeBuilding('preview', 'company', 'x')
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/cody-chat-explain.test.ts`
Expected: FAIL — `explainBeforeBuilding` doesn't exist yet.

- [ ] **Step 4: Implement `explainBeforeBuilding`**

Add to `lib/build/cody-chat.ts`, mirroring `summarizeArtifactStep`'s exact shape with a different system prompt: "Say what you are about to build and which business goal it tests, in one or two plain sentences, then nothing else — the founder will be asked to confirm separately."

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/cody-chat-explain.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 6: Write the failing test for the panel's build-gate**

```typescript
// __tests__/components/build/CodyChatPanel-explain-gate.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { view: 'preview', track: 'company', idea: 'x', companyName: 'Acme', generated: {}, appChatId: 'chat-1', auto: true, nudgeState: {} },
    views: ['design', 'thesis', 'preview'],
    dispatch: dispatchMock,
  }),
}))

import { CodyChatPanel } from '@/components/build/CodyChatPanel'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}
afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('CodyChatPanel — explain before building (#BLD-06.9)', () => {
  it('shows a real explanation and a go-ahead button on a build-stage view (preview)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/build/cody-explain') return { ok: true, json: async () => ({ ok: true, explanation: "I'm about to build your live preview to test real signups." }) }
      return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
    }))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.textContent).toContain('live preview')
    expect(host.querySelector('[data-testid="cody-explain-go-ahead"]')).toBeTruthy()
  })

  it('does NOT show the go-ahead gate on a non-build-stage view (thesis)', async () => {
    const stateModule = await import('@/contexts/build-context')
    vi.spyOn(stateModule, 'useBuild').mockReturnValue({
      state: { view: 'thesis', track: 'company', idea: 'x', companyName: 'Acme', generated: {}, appChatId: 'chat-1', auto: false, nudgeState: {} },
      views: ['design', 'thesis', 'preview'],
      dispatch: dispatchMock,
    } as any)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, summary: 'x' }) })))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.querySelector('[data-testid="cody-explain-go-ahead"]')).toBeFalsy()
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run __tests__/components/build/CodyChatPanel-explain-gate.test.tsx`
Expected: FAIL — no gate exists yet.

- [ ] **Step 8: Implement the gate**

Add `POST /api/build/cody-explain` (mirror Task 1's route shape, wraps `explainBeforeBuilding`). In `CodyChatPanel.tsx`, define `const BUILD_STAGE_VIEWS = ['swarm', 'infra', 'preview']` (confirmed real `APP_VIEWS` entries); when `BUILD_STAGE_VIEWS.includes(state.view)` and no go-ahead has been given yet for this view this session (component state, not persisted), call the explain route and render the explanation plus a go-ahead button (`data-testid="cody-explain-go-ahead"`) before allowing the existing autoplay/generation flow to proceed for that view. Exact blocking mechanism: reuse `CodyNudge`'s `nudgeState`/`NUDGE` dispatch shape (consume the SAME state field, add this view's gate as another entry keyed by view) rather than inventing a parallel gate — confirmed consistent with the spec's explicit instruction to reuse this pattern.

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run __tests__/components/build/CodyChatPanel-explain-gate.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 10: Run the full suite, typecheck, real build, commit, push, PR, CI, merge, deploy, verify**

Live-verify: drive a real build on either track to the `preview` stage, confirm Cody's explanation appears and generation genuinely pauses until the go-ahead button is clicked.

---

### Task 6: Idea entry becomes Cody's first message (E3.1)

**Files:**
- Modify: `components/build/screens/Intake.tsx`
- Test: `__tests__/components/build/Intake-chat.test.tsx` (new; check for and update/replace any existing Intake test file found via `find __tests__ -iname "*Intake*"`)

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(intake): idea entry becomes Cody's first message (E3.1)" \
  --body "Part of Epic 3. Intake.tsx's real submit mechanics (brand naming, auth-wall defer-or-build) are confirmed working and unchanged by this story -- only the presentation becomes a chat turn, reusing Live.tsx's existing .m-chat-cody CSS as the established visual pattern for chat in this app." \
  --label "enhancement"
```

- [ ] **Step 2: Find and read the existing Intake test(s)**

```bash
find __tests__ -iname "*Intake*"
```

Read whatever is found in full before writing new tests — do not duplicate or silently break existing coverage for `start()`'s real auth-wall/brand-naming logic, which this story does not change.

- [ ] **Step 3: Write the failing test for the chat presentation**

```typescript
// __tests__/components/build/Intake-chat.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }), getSession: vi.fn(async () => null) }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: () => 'continue' }))
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: { idea: '', track: 'company' }, dispatch: dispatchMock }) }))

import { Intake } from '@/components/build/screens/Intake'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}
afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('Intake — chat presentation (#E3.1)', () => {
  it("Cody's first message is the exact backlog-specified line", () => {
    render(React.createElement(Intake))
    expect(host.textContent).toContain("Tell me your idea in a sentence or two. I'll ask 3 quick questions, then get to work.")
  })

  it('still renders a real input the founder can type into and submit', () => {
    render(React.createElement(Intake))
    expect(host.querySelector('textarea, input[type="text"]')).toBeTruthy()
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run __tests__/components/build/Intake-chat.test.tsx`
Expected: FAIL — the current copy doesn't contain that exact line.

- [ ] **Step 5: Update `Intake.tsx`'s presentation**

Replace the header/sub copy block with a chat-turn rendering of Cody's first message (reuse `.m-chat-cody`-family classes from `Live.tsx` as the visual pattern — read that component's real class names before writing new CSS, do not invent a parallel chat style). Keep `start()` and the textarea/button wiring untouched — this step changes presentation only. Add the "idea too thin" check: `idea.trim().split(/\s+/).length < 2` shows one follow-up prompt (a second static Cody line asking for more detail) before the submit button becomes enabled, rather than blocking the button silently.

- [ ] **Step 6: Run it to verify it passes, then run the pre-existing Intake test(s) found in Step 2 to confirm no regression**

- [ ] **Step 7: Run the full suite, typecheck, real build, commit, push, PR, CI, merge, deploy, verify on both tracks**

---

### Task 7: Company kickoff questions (E3.2)

**Files:**
- Create: `components/build/screens/KickoffQuestions.tsx`
- Modify: `components/build/screens/Intake.tsx` (route to kickoff instead of directly to signup/build)
- Modify: `lib/build/state.ts` (new `Screen` value `'kickoff'`, new dispatch action to record answers — check the real `Screen` union and `GOTO_SCREEN` handling before adding)
- Test: `__tests__/components/build/KickoffQuestions.test.tsx`

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(kickoff): Company-track kickoff questions before generation (E3.2)" \
  --body "Part of Epic 3. New screen inserted between Intake's brand-naming step and START_BUILD/DEFER_BUILD. Exact question sets and feed-targets from the backlog doc's own table (Start a new business vs Grow my business variants). Answers stored in the existing BuildState.answers field and threaded into the first artifact's generation as feedback, reusing BLD-06.3's composeFeedbackFromAnswers shape." \
  --label "enhancement"
```

- [ ] **Step 2: Read the real `Screen` type and `GOTO_SCREEN`/reducer shape**

```bash
grep -n "export type Screen" lib/build/state.ts
```

Confirm the exact literal union before adding `'kickoff'` to it — do not guess its current members.

- [ ] **Step 3: Write the failing test for `KickoffQuestions`**

```typescript
// __tests__/components/build/KickoffQuestions.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { track: 'company', role: undefined, idea: 'x', appSub: 'acme', companyName: 'Acme', brandTagline: '', brandColor: '#000' }, dispatch: dispatchMock }),
}))

import { KickoffQuestions } from '@/components/build/screens/KickoffQuestions'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}
afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('KickoffQuestions — Company, new business (#E3.2)', () => {
  it('asks one question at a time, with suggestions, free text, and Not sure yet', () => {
    render(React.createElement(KickoffQuestions))
    expect(host.textContent).toContain('Who would you like to help')
    expect(host.textContent).toContain('Not sure yet')
  })

  it('answering (or skipping) all 3 questions dispatches START_BUILD or DEFER_BUILD with the answers recorded', async () => {
    render(React.createElement(KickoffQuestions))
    for (let i = 0; i < 3; i++) {
      const notSure = host.querySelector('[data-testid="kickoff-not-sure"]') as HTMLButtonElement
      await act(async () => { notSure.click() })
    }
    const calledTypes = dispatchMock.mock.calls.map((c) => c[0].type)
    expect(calledTypes).toContain('SET_ANSWER')
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run __tests__/components/build/KickoffQuestions.test.tsx`
Expected: FAIL — the component doesn't exist yet.

- [ ] **Step 5: Implement `KickoffQuestions.tsx`**

One question per message, Company-track "Start a new business" variant from the backlog doc's own table verbatim (Who would you like to help / What problem do they have / How would you like to get paid — exact suggestion chips from the doc), the "Grow my business" variant gated on `state.role` (confirm this field's real name/values in `lib/build/state.ts` before using it — the spec referenced `CompanyRole` as an existing type). Each answer dispatches `{type: 'SET_ANSWER', key, value}` (confirm this is the real existing action shape at `lib/build/state.ts:434` — `answers: {...state.answers, [action.key]: action.value}` — reuse verbatim, do not invent a new action name). After the 3rd question (answered or "Not sure yet"), dispatch the same `START_BUILD`/`DEFER_BUILD` `Intake.tsx` already dispatches, now carrying `state.answers`.

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run __tests__/components/build/KickoffQuestions.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 7: Wire `Intake.tsx` to route through kickoff instead of straight to signup/build**

Change `Intake.tsx`'s `start()` so its final step (after brand-naming) dispatches `GOTO_SCREEN: 'kickoff'` instead of directly deciding signup-vs-build; `KickoffQuestions.tsx` makes that decision after its own 3rd question, reusing the exact same auth-check logic `start()` already has (extract it to a small shared helper if duplicating the `getSession()` race-fix logic verbatim would be wrong — check for duplication risk before deciding whether to extract).

- [ ] **Step 8: Run the full suite, typecheck, real build, commit, push, PR, CI, merge, deploy, verify on the Company track**

---

### Task 8: App kickoff questions (E3.3)

**Files:**
- Modify: `components/build/screens/KickoffQuestions.tsx` (App-track question branch)
- Test: Extend `__tests__/components/build/KickoffQuestions.test.tsx`

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(kickoff): App-track kickoff questions before generation (E3.3)" \
  --body "Part of Epic 3. Same KickoffQuestions mechanism as E3.2, App-track branch with its own 3 questions from the backlog doc's table." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test for the App-track branch**

```typescript
describe('KickoffQuestions — App track (#E3.3)', () => {
  it('asks the 3 real App-track questions', () => {
    // re-mock useBuild with state.track = 'app', render, assert the real
    // question text ("What should the app help people do", "Who will use
    // it", "What should it keep track of") per the backlog doc's table.
  })
})
```

- [ ] **Step 3: Run it to verify it fails, implement the App-track branch in `KickoffQuestions.tsx` (track-conditional question set, same component, same answer/dispatch mechanism as Task 7), verify it passes**

- [ ] **Step 4: Run the full suite, typecheck, real build, commit, push, PR, CI, merge, deploy, verify on the App track**

---

### Task 9: Anonymous draft autosave and resume (E3.4)

**Files:**
- Create: `lib/build/anon-drafts.ts`
- Create: `app/api/build/anon-draft/route.ts`
- Create: `app/api/cron/purge-anon-drafts/route.ts`
- Modify: `components/build/screens/Intake.tsx` / `KickoffQuestions.tsx` (set the cookie token, save on each step, offer resume)
- Test: `__tests__/lib/build/anon-drafts.test.ts`
- Test: `__tests__/api/cron-purge-anon-drafts.test.ts`

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(kickoff): anonymous draft autosave and resume, 30-day retention (E3.4)" \
  --body "Part of Epic 3. Extends pending-build.ts's real, already-shipped localStorage mechanism (confirmed: same-browser only, no TTL) with genuine server-side ZeroDB persistence keyed by a random browser-scoped cookie token (never PII, never logged). New purge-anon-drafts cron follows the existing app/api/cron/* GET + dry-run-capable sweep pattern." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test for `anon-drafts.ts`**

```typescript
// __tests__/lib/build/anon-drafts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(storedRows: Array<Record<string, unknown>>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' && u.includes('/rows')) {
      const body = JSON.parse(String(init.body))
      const idx = storedRows.findIndex((r: any) => r.token === body.row_data.token)
      if (idx >= 0) storedRows[idx] = body.row_data
      else storedRows.push(body.row_data)
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
    }
    if (u.includes('/rows')) {
      return { ok: true, status: 200, json: async () => storedRows.map((row_data) => ({ row_data })), text: async () => JSON.stringify(storedRows.map((row_data) => ({ row_data }))) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('anon-drafts (#E3.4)', () => {
  it('saves and loads a draft by token', async () => {
    mockFetch([])
    const { saveAnonDraft, loadAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-1', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-2' })
    const draft = await loadAnonDraft('tok-1')
    expect(draft?.step).toBe('kickoff-2')
  })

  it('returns null for an unknown token, never throws', async () => {
    mockFetch([])
    const { loadAnonDraft } = await import('@/lib/build/anon-drafts')
    expect(await loadAnonDraft('unknown-token')).toBeNull()
  })

  it('a second save for the SAME token updates in place, never duplicates', async () => {
    const rows: Array<Record<string, unknown>> = []
    mockFetch(rows)
    const { saveAnonDraft, loadAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-2', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' })
    await saveAnonDraft('tok-2', { idea: 'x', track: 'company', answers: { who: 'a' }, step: 'kickoff-2' })
    expect(rows.length).toBe(1)
    const draft = await loadAnonDraft('tok-2')
    expect(draft?.step).toBe('kickoff-2')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/anon-drafts.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `anon-drafts.ts`**

Same `ensureTable`-then-write pattern; `saveAnonDraft` reads existing rows for the token first (mirroring the test's update-in-place expectation) rather than blind-appending, since a draft genuinely has one current state per token (unlike version history, which wants every save kept).

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/anon-drafts.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 6: Write the failing test for the purge cron**

```typescript
// __tests__/api/cron-purge-anon-drafts.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(rows: Array<Record<string, unknown>>) {
  const deleted: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'DELETE') { deleted.push(u); return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response }
    if (u.includes('/rows')) return { ok: true, status: 200, json: async () => rows.map((row_data) => ({ row_data })), text: async () => JSON.stringify(rows.map((row_data) => ({ row_data }))) } as unknown as Response
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
  }))
  return deleted
}

import { GET } from '@/app/api/cron/purge-anon-drafts/route'

describe('GET /api/cron/purge-anon-drafts (#E3.4)', () => {
  it('deletes drafts older than 30 days, keeps recent ones', async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    const recent = new Date().toISOString()
    mockFetch([
      { token: 'old-1', updatedAt: old },
      { token: 'recent-1', updatedAt: recent },
    ])
    const res = await GET({} as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.purged).toBe(1)
  })
})
```

- [ ] **Step 7: Run it to verify it fails, implement the cron (mirror `app/api/cron/comms-digest/route.ts`'s real GET + sweep-function shape — read it first), verify it passes**

- [ ] **Step 8: Wire the cookie token + save/resume UI into `Intake.tsx`/`KickoffQuestions.tsx`**

Set a random token (e.g. `crypto.randomUUID()`) as an HttpOnly-equivalent client cookie (confirm real cookie-setting pattern already used elsewhere in this codebase, e.g. `lib/build/attribution.ts`'s `captureAttribution`, before inventing a new one) on first kickoff interaction; save on each answered question; on `Intake.tsx` mount, check for an existing token's draft and offer "Pick up where you left off?" (Continue / Start over) per the backlog doc's exact scenario wording.

- [ ] **Step 9: Run the full suite, typecheck, real build, commit, push, PR, CI, merge, deploy, verify**

Live-verify: start a kickoff flow anonymously, abandon mid-question, return in a fresh tab (same browser/cookie), confirm the resume prompt appears and genuinely restores the right step.

## Completion

After Task 9, re-run `npx vitest run` and `npx tsc --noEmit` one final time across the whole set of changes, then proceed per `superpowers:executing-plans`' own Final Review step.
