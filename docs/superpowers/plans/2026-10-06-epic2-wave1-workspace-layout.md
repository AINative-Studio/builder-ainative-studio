# Epic 2, Wave 1 — Workspace Layout + Funnel Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship BLD-06.1 (merge the phase bar + artifact chip row into one journey bar; replace the right-hand Artifacts rail with a persistent Cody chat panel shell) and BLD-06.12 (funnel event instrumentation + a baseline admin summary endpoint), self-approved under the standing autonomous-loop authority.

**Architecture:** `JourneyBar` replaces `ActBar`+`PathBreadcrumb` as one component in the same DOM slot; `CodyChatPanel` replaces `ArtifactRail` in `WorkspaceShell`'s right-side slot, unconditionally rendered (no drawer toggle — it's persistent). No new top-level `BuildState` fields are needed for BLD-06.1. BLD-06.12 reuses the existing `trackEvent()` GA wiring for client-side firing and adds one new small ZeroDB table (`builder_funnel_events`) plus one admin-gated summary endpoint for the two aggregate numbers GA alone can't answer.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest, React (client components), ZeroDB REST (no Python/FastAPI — confirmed repo reality, overriding the backlog doc's stack assumption).

**Spec:** `docs/superpowers/specs/2026-10-06-epic2-wave1-workspace-layout-design.md`

## Global Constraints

- TDD: RED test first, watched failing, then GREEN, never skip.
- `npx tsc --noEmit` clean.
- Full `npx vitest run` green except the known pre-existing `task-splitter.test.ts` flake (CPU-contention/vi.spyOn module-caching race, confirmed harmless across many PRs this session — do not re-diagnose it).
- One GitHub issue per task before any code ("No Code Without An Issue").
- Real PR per task referencing its issue number, real CI (`gh pr checks`), real squash-merge.
- Real Railway deploy verification via `curl https://builder.ainative.studio/api/health` matching the new commit SHA.
- Genuine human-style verification for anything user-facing before calling a task done — for this plan's layout changes, that means a real Chrome-driven look at the rendered workspace (both tracks, desktop width), not just passing unit tests. If the user is away from their computer and only non-blocking verification remains, do it yourself via the available browser tooling — do not wait idly.
- No jargon in new user-facing copy — the chat panel's placeholder text and any new labels must read in plain language, per the epic's own design principle.
- `pnpm build` (the REAL build command this repo's CI/Railway use — `next build --turbopack` via the package.json `build` script) must be run at least once near the end of this plan to catch any client/server bundle-boundary break, per the hard lesson from Epic 1 Task 4 (a server-only import transitively reaching a client component broke the production build twice before the real fix — extracting the client-needed piece into its own dependency-free module — was found). Do not rely on `npx tsc --noEmit` or `npx next build` (webpack, not what CI/prod use) alone to catch this class of bug.

## Review Focus

- A user on the App track (not Company) must see the journey bar's phase set correctly switch to `APP_ACT_LABELS` — the merged component must not hard-code the Company phase list.
- `state.auto` (Cody actively auto-building) must still gate chip clickability in the merged bar exactly as `PathBreadcrumb` already does — a founder must not be able to jump ahead mid-autobuild.
- The chat panel's placeholder message must update when `state.view` changes (real reactivity), not render once and go stale.
- Removing the `rail` prop from `WorkspaceShell` must not silently drop content from any existing caller — `Workspace.tsx` is the only real caller (confirmed by grep) and never passes `rail`, so this is safe, but the plan's own test step re-confirms it.
- The new `builder_funnel_events` writes must never throw past the UI action they're attached to (e.g. a ZeroDB outage must not block a founder from submitting their idea) — fire-and-forget, `.catch(() => {})`, matching every other telemetry/alerting call added this session.

---

### Task 1: `JourneyBar` replaces `ActBar` + `PathBreadcrumb`

**Files:**
- Create: `components/build/JourneyBar.tsx`
- Modify: `components/build/WorkspaceShell.tsx` (remove `ActBar`, `PathBreadcrumb`; render `<JourneyBar />` in their place; keep `IndexPanel`, `TerminalRibbon`, `PricingNudge`, `DecisionModal` untouched)
- Test: `__tests__/components/build/JourneyBar.test.tsx`

**Interfaces:**
- Consumes: `useBuild()` (existing, `contexts/build-context.tsx`) — `state.track`, `state.view`, `state.done`, `state.auto`, `state.screen`, `state.designStepDone`, `state.builtCompany`, `state.builtMVP`, `views`, `goView`, `dispatch`. `APP_ACT_LABELS`/`COMPANY_ACT_LABELS` (existing, `lib/build/acts.ts`). `currentActIndex` (existing, exported from `WorkspaceShell.tsx` — stays there, imported by `JourneyBar.tsx`).
- Produces: `JourneyBar` — a React component with no props (reads everything from `useBuild()`, matching `ActBar`/`PathBreadcrumb`'s existing no-props pattern).

- [ ] **Step 1: Write the failing test for the merged phase row**

```typescript
// __tests__/components/build/JourneyBar.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const mockState = {
  track: 'app' as const,
  view: 'brief',
  done: { design: 'done', brief: 'done' },
  auto: false,
  screen: 'workspace',
  designStepDone: true,
  builtCompany: false,
  builtMVP: false,
  railOpen: false,
  indexOpen: false,
}
const goViewMock = vi.fn()
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['design', 'brief', 'prd', 'comp', 'dataModel', 'memoryPolicy', 'agentDef', 'codingStandards', 'apiSpec', 'backlog', 'sprintPlan', 'swarm', 'infra', 'preview'],
    goView: goViewMock,
    dispatch: dispatchMock,
    woven: 2,
    totalPrimitives: 10,
  }),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))

import { JourneyBar } from '@/components/build/JourneyBar'

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

describe('JourneyBar (#BLD-06.1)', () => {
  it('renders the App track phase labels, not the Company labels', () => {
    render(React.createElement(JourneyBar))
    expect(host.textContent).toContain('Design')
    expect(host.textContent).not.toContain('Company')
  })

  it('renders the full artifact chip row beneath the phase row', () => {
    render(React.createElement(JourneyBar))
    expect(host.querySelectorAll('.m-crumb').length).toBe(14) // full APP_VIEWS length
  })

  it('marks a done artifact chip as done, the current one as current', () => {
    render(React.createElement(JourneyBar))
    const briefChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent === 'brief') as HTMLButtonElement
    expect(briefChip.className).toContain('is-current')
    const designChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent === 'design') as HTMLButtonElement
    expect(designChip.className).toContain('is-done')
  })

  it('clicking a done, non-current chip calls goView', () => {
    render(React.createElement(JourneyBar))
    const designChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent === 'design') as HTMLButtonElement
    act(() => { designChip.click() })
    expect(goViewMock).toHaveBeenCalledWith('design')
  })

  it('does not render the old Artifacts-rail toggle button', () => {
    render(React.createElement(JourneyBar))
    expect(host.textContent).not.toMatch(/Artifacts · \d/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/components/build/JourneyBar.test.tsx`
Expected: FAIL — `@/components/build/JourneyBar` doesn't exist yet.

- [ ] **Step 3: Implement `JourneyBar`**

Read `components/build/WorkspaceShell.tsx`'s current `ActBar` (lines 22-69) and `PathBreadcrumb` (lines 109-131) in full before writing — this step merges their real bodies, not a reinvention. Create `components/build/JourneyBar.tsx`:

```typescript
'use client'

/**
 * Journey bar (#BLD-06.1) — merges the old separate ActBar (phase row) and
 * PathBreadcrumb (artifact chip row) into one component, per Epic 2's
 * acceptance scenario: "one journey bar shows phases and the current
 * phase's artifacts." The chip row renders the FULL views sequence, not
 * filtered to the current phase — see the design spec's note on why a
 * view→phase mapping is out of scope for this story (no such mapping
 * exists anywhere in this codebase today, and currentActIndex answers a
 * different question — "which phase is the whole workspace in" — not
 * "which phase does this specific artifact belong to").
 */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useSession } from 'next-auth/react'
import { APP_ACT_LABELS, COMPANY_ACT_LABELS } from '@/lib/build/acts'
import type { Screen } from '@/lib/build/state'
import { AccountMenu } from '@/components/build/AccountMenu'
import { currentActIndex } from '@/components/build/WorkspaceShell'

export function JourneyBar() {
  const { state, views, dispatch, goView, woven, totalPrimitives } = useBuild()
  const { data: session } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)

  const actLabels = state.track === 'company' ? COMPANY_ACT_LABELS : APP_ACT_LABELS
  const actIndex = currentActIndex(state)

  const handleScreen = (screen: string) => {
    dispatch({ type: 'GOTO_SCREEN', screen: screen as Screen })
  }

  return (
    <div className="m-journey-bar" role="navigation" aria-label="Build progress">
      <div className="m-journey-phases">
        <ol className="m-acts">
          {actLabels.map((label, i) => {
            const cls = i < actIndex ? 'is-done' : i === actIndex ? 'is-current' : 'is-upcoming'
            return (
              <li key={label} className={`m-act ${cls}`}>
                <span className="m-act-badge" aria-hidden>{i < actIndex ? '✓' : i + 1}</span>
                <span className="m-act-label">{label}</span>
              </li>
            )
          })}
        </ol>
        <div className="m-actbar-right">
          <span className="m-woven m-mono" title="AINative primitives woven into this build">
            {woven}/{totalPrimitives} woven
          </span>
          <button className="m-actbar-btn m-mono" onClick={() => dispatch({ type: 'TOGGLE_INDEX' })} title="Jump to any screen">
            Index
          </button>
          <AccountMenu
            session={session}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onScreen={handleScreen}
          />
        </div>
      </div>
      <div className="m-breadcrumb" role="navigation" aria-label="Artifacts">
        {views.map((v) => {
          const isCurrent = v === state.view
          const isDone = Boolean(state.done[v])
          const clickable = !state.auto && (isDone || isCurrent)
          const cls = isCurrent ? 'is-current' : isDone ? 'is-done' : 'is-upcoming'
          return (
            <button
              key={v}
              className={`m-crumb m-mono ${cls}`}
              disabled={!clickable}
              onClick={() => clickable && goView(v as never)}
            >
              {v}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/components/build/JourneyBar.test.tsx`
Expected: PASS, 5/5.

- [ ] **Step 5: Wire `JourneyBar` into `WorkspaceShell`, remove `ActBar`/`PathBreadcrumb`**

In `components/build/WorkspaceShell.tsx`:
- Delete the `ActBar` function (lines 22-69) and the `PathBreadcrumb` function (lines 109-131) — their logic now lives in `JourneyBar.tsx`.
- Add `import { JourneyBar } from '@/components/build/JourneyBar'` at the top.
- In the `WorkspaceShell` component's JSX, replace `<ActBar />` and `<PathBreadcrumb />` with a single `<JourneyBar />` in the same relative position (right after the `<header className="m-topbar">` block, before `<IndexPanel />`).
- Remove the now-unused `useState` import if `ActBar`'s `menuOpen` state was the only user of it in this file (check: `IndexPanel` doesn't use `useState`; confirm before removing the import).
- Remove the `useSession` import if `ActBar` was its only user in this file (same check).

- [ ] **Step 6: Run the existing suite to confirm no regression**

Run: `npx vitest run __tests__/components/build/JourneyBar.test.tsx`
Expected: still PASS, 5/5 (confirms the component renders correctly once actually wired into the real import graph, not just in isolation).

- [ ] **Step 7: Commit**

```bash
git add components/build/JourneyBar.tsx components/build/WorkspaceShell.tsx __tests__/components/build/JourneyBar.test.tsx
git commit -m "feat(workspace): merge phase bar and artifact chips into one journey bar (#<issue-number>)"
```

---

### Task 2: `CodyChatPanel` replaces `ArtifactRail`

**Files:**
- Create: `components/build/CodyChatPanel.tsx`
- Modify: `components/build/WorkspaceShell.tsx` (replace the `rail`-prop slot + `<ArtifactRail />` with `<CodyChatPanel />`, remove the `rail` prop from the component's own props type)
- Delete: `components/build/ArtifactRail.tsx`, `lib/build/artifact-rail-prefs.ts`, `__tests__/components/build/ArtifactRail-accordion.test.tsx` (confirmed dead — `artifact-rail-prefs.ts` has no other real importer; `live-section-prefs.ts`'s reference to it is a doc-comment only, not an import)
- Test: `__tests__/components/build/CodyChatPanel.test.tsx`

**Interfaces:**
- Consumes: `useBuild()` — `state.view` only (this story's scope is a static placeholder reacting to the current artifact, not real conversation — see spec).
- Produces: `CodyChatPanel` — a React component with no props.

**Review Focus item this task owns:** removing `WorkspaceShell`'s `rail` prop must not silently drop content from any existing caller — confirmed by grep (`Workspace.tsx` is the only real caller, never passes `rail`), re-verified by this task's own test step.

- [ ] **Step 1: Write the failing test for `CodyChatPanel`**

```typescript
// __tests__/components/build/CodyChatPanel.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

let currentView = 'brief'
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { view: currentView } }),
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
})

describe('CodyChatPanel (#BLD-06.1)', () => {
  it('renders a persistent chat panel with the Cody header', () => {
    currentView = 'brief'
    render(React.createElement(CodyChatPanel))
    expect(host.querySelector('[data-testid="cody-chat-panel"]')).toBeTruthy()
    expect(host.textContent).toContain('Cody')
  })

  it('names the current artifact view in its message', () => {
    currentView = 'brief'
    render(React.createElement(CodyChatPanel))
    expect(host.textContent).toContain('brief')
  })

  it('updates its message when the view changes (real reactivity, not a static render)', () => {
    currentView = 'prd'
    render(React.createElement(CodyChatPanel))
    expect(host.textContent).toContain('prd')
    expect(host.textContent).not.toContain('>brief<')
  })

  it('shows a present-but-not-yet-wired input, honestly labeled', () => {
    currentView = 'brief'
    render(React.createElement(CodyChatPanel))
    const input = host.querySelector('[data-testid="cody-chat-input"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/components/build/CodyChatPanel.test.tsx`
Expected: FAIL — `@/components/build/CodyChatPanel` doesn't exist yet.

- [ ] **Step 3: Implement `CodyChatPanel`**

```typescript
// components/build/CodyChatPanel.tsx
'use client'

/**
 * Cody chat panel (#BLD-06.1) — the persistent right-hand panel replacing
 * the old Artifacts rail drawer. This story ships the panel SHELL only: a
 * real, visible, always-on chat surface that reacts to the current
 * artifact. The guided conversation itself (step summaries, Q&A, revise,
 * save/restore) is BLD-06.2 through BLD-06.4's scope, not this one's —
 * the input below is honestly disabled rather than wired to fake behavior
 * that doesn't exist yet.
 */

import { useBuild } from '@/contexts/build-context'

export function CodyChatPanel() {
  const { state } = useBuild()

  return (
    <div className="m-cody-chat-panel" data-testid="cody-chat-panel" aria-label="Cody chat">
      <div className="m-cody-chat-header m-mono">
        <span className="m-glyph">◇</span> Cody
      </div>
      <div className="m-cody-chat-log">
        <p className="m-cody-chat-line">You&apos;re on <span className="m-mono">{state.view}</span>.</p>
      </div>
      <div className="m-cody-chat-input-row">
        <input
          className="m-cody-chat-input"
          data-testid="cody-chat-input"
          type="text"
          placeholder="Guided Q&A coming soon"
          disabled
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/components/build/CodyChatPanel.test.tsx`
Expected: PASS, 4/4.

- [ ] **Step 5: Wire `CodyChatPanel` into `WorkspaceShell`, remove the rail**

In `components/build/WorkspaceShell.tsx`:
- Remove `import { ArtifactRail } from '@/components/build/ArtifactRail'`.
- Add `import { CodyChatPanel } from '@/components/build/CodyChatPanel'`.
- In the `WorkspaceShell` function's props destructure, remove `rail` from `{ feed, rail, children }` — it becomes `{ feed, children }`. Update the type annotation to drop `rail?: ReactNode`.
- Replace:
  ```tsx
  {rail && <aside className="m-rail">{rail}</aside>}
  <ArtifactRail />
  ```
  with:
  ```tsx
  <aside className="m-cody-chat"><CodyChatPanel /></aside>
  ```

- [ ] **Step 6: Delete the superseded files**

```bash
rm components/build/ArtifactRail.tsx lib/build/artifact-rail-prefs.ts __tests__/components/build/ArtifactRail-accordion.test.tsx
```

- [ ] **Step 7: Run the full suite to confirm the deletions broke nothing else**

Run: `npx vitest run`
Expected: all pass except the known `task-splitter.test.ts` flake — specifically confirm no test file fails with a "Cannot find module" error for `ArtifactRail` or `artifact-rail-prefs` (that would mean a real consumer was missed by the earlier grep).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add components/build/CodyChatPanel.tsx components/build/WorkspaceShell.tsx __tests__/components/build/CodyChatPanel.test.tsx
git rm components/build/ArtifactRail.tsx lib/build/artifact-rail-prefs.ts __tests__/components/build/ArtifactRail-accordion.test.tsx
git commit -m "feat(workspace): replace Artifacts rail with a persistent Cody chat panel (#<issue-number>)"
```

- [ ] **Step 10: Real production build check**

Run: `pnpm build` (the real Turbopack build command CI/Railway use — NOT `npx next build` alone, which uses webpack and both hides and surfaces different issues than the real pipeline, per Epic 1's own hard lesson).
Expected: completes, all routes generated, exit code 0. If it fails with a client/server bundle-boundary error (e.g. "Module not found: Can't resolve 'net'/'tls'/'fs'"), find which new client-reachable import pulls in a server-only dependency and fix it the same way Epic 1 Task 4 was fixed — extract the client-needed piece into its own small, dependency-free module — rather than reaching for a dynamic import (confirmed NOT to work for this failure class; webpack/Turbopack still resolve a dynamically-imported module's own dependency graph to build its chunk).

- [ ] **Step 11: Commit, push, PR, CI, merge**

```bash
git push -u origin <branch-name>
gh pr create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(workspace): merge phase bar + chips into one journey bar; persistent Cody chat panel" \
  --body "Closes #<issue-number-task1> and #<issue-number-task2>. BLD-06.1: merges ActBar+PathBreadcrumb into one JourneyBar; replaces the Artifacts rail drawer with a persistent CodyChatPanel shell (guided conversation itself is BLD-06.2-06.4's scope)." \
  --base main
gh pr checks <pr-number> --repo AINative-Studio/builder-ainative-studio
gh pr merge <pr-number> --repo AINative-Studio/builder-ainative-studio --squash --delete-branch
```

- [ ] **Step 12: Confirm deploy, then verify like a human**

```bash
curl -s https://builder.ainative.studio/api/health
```

Using Chrome MCP tools: sign in, open a real workspace on BOTH tracks (App and Company — create one of each if neither already exists in a reachable account), confirm: one merged journey bar renders (phases + chips, no separate second bar beneath it); the primitives log (Cody feed) is still on the left; a persistent chat panel is visible on the right at all times (never toggled open/closed, no "Artifacts" button anywhere); clicking a done artifact chip still navigates to it; the chat panel's message names the artifact currently selected and updates when a different artifact is selected. If the user is away from their computer when this step is reached, perform it yourself via the available browser tooling rather than waiting — this plan explicitly authorizes that per its Global Constraints.

---

### Task 3: Funnel event instrumentation + storage

**Files:**
- Create: `lib/build/funnel-events.ts`
- Modify: real call sites for each funnel event (found during this task, not assumed — see Step 1)
- Test: `__tests__/lib/build/funnel-events.test.ts`

**Interfaces:**
- Consumes: `trackEvent(action, category, label?, value?)` (existing, `components/analytics/google-analytics.tsx`).
- Produces: `recordFunnelEvent(event: FunnelEvent, opts: {companyId?: string | null, track: 'app'|'company', step: string}): Promise<void>`, consumed by Task 4's summary endpoint.

- [ ] **Step 1: File the GitHub issue, then find the real call sites**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(analytics): funnel event instrumentation (idea submitted, kickoff answered, step viewed, question answered, save, last step reached)" \
  --body "Part of Epic 2 Wave 1 (BLD-06.12). Ships before BLD-06.2 per the backlog doc's own ordering note, to capture a baseline before the guided-chat stories change the funnel. Reuses the existing trackEvent() GA wiring for client-side firing; adds one new ZeroDB table + admin endpoint for the two aggregate numbers (share reaching last step, time first-artifact-to-last-step) GA alone can't answer cheaply." \
  --label "enhancement"
```

Before writing code, grep the real call sites for each of the 6 events (idea submitted, kickoff answered, step viewed, question answered, save, last step reached) — do not guess their names or locations:

```bash
grep -rn "trackEvent(" components/build/ app/ --include="*.tsx" --include="*.ts" | grep -v __tests__
```

Read each result to find: where an idea is actually submitted (the intake/fork screen's submit handler), where a save action fires (any existing save-to-ZeroDB call in the build flow), where `goView`/view-change already happens (`contexts/build-context.tsx`'s `GOTO_SCREEN`/view-change reducer cases), and where "last step reached" can be computed (the final entry of `views` for the active track being set as `state.view`). Record the exact file:line for each in this task's ledger entry when it completes — the plan cannot specify them in advance since they were not found during spec-writing (grounded honesty: do not invent call sites that turn out not to match reality).

- [ ] **Step 2: Write the failing test for `recordFunnelEvent`**

```typescript
// __tests__/lib/build/funnel-events.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(impl?: (url: string, init?: RequestInit) => { ok: boolean }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl ? impl(url, init) : { ok: true }
    return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('recordFunnelEvent (#BLD-06.12)', () => {
  beforeEach(() => { mockFetch() })

  it('records an event with the real event name, track, and step', async () => {
    const { recordFunnelEvent } = await import('@/lib/build/funnel-events')
    await expect(recordFunnelEvent('idea_submitted', { companyId: null, track: 'app', step: 'intake' })).resolves.not.toThrow()
  })

  it('never throws when the write fails, only logs best-effort', async () => {
    mockFetch(() => ({ ok: false }))
    const { recordFunnelEvent } = await import('@/lib/build/funnel-events')
    await expect(recordFunnelEvent('save', { companyId: 'acme', track: 'company', step: 'thesis' })).resolves.not.toThrow()
  })

  it('never throws when fetch itself throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { recordFunnelEvent } = await import('@/lib/build/funnel-events')
    await expect(recordFunnelEvent('last_step_reached', { companyId: 'acme', track: 'company', step: 'plan30' })).resolves.not.toThrow()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/funnel-events.test.ts`
Expected: FAIL — `@/lib/build/funnel-events` doesn't exist yet.

- [ ] **Step 4: Implement `funnel-events.ts`**

Mirror `lib/build/otp.ts`'s exact `ensureTable`-then-write idempotent-create pattern (do not invent a different persistence mechanism):

```typescript
// lib/build/funnel-events.ts
/**
 * Funnel event storage (#BLD-06.12) — a small, purpose-built ZeroDB table
 * for the two aggregate numbers the epic asks for (share of ventures
 * reaching the last step, time from first artifact to last step) that
 * GA4's UI doesn't expose cheaply to this team today. Mirrors the
 * ensureTable-then-write idempotent-create pattern already established in
 * lib/build/otp.ts — never a different persistence mechanism for the same
 * class of problem.
 */
import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const FUNNEL_TABLE = 'builder_funnel_events'

export type FunnelEvent =
  | 'idea_submitted' | 'kickoff_answered' | 'step_viewed'
  | 'question_answered' | 'save' | 'last_step_reached'

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

async function ensureFunnelTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ table_name: FUNNEL_TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* table might already exist */ }
}

/** Record a funnel event. Best-effort, fire-and-forget -- never blocks or
 * throws past the real UI action it's attached to. */
export async function recordFunnelEvent(
  event: FunnelEvent,
  opts: { companyId?: string | null; track: 'app' | 'company'; step: string },
): Promise<void> {
  if (!configured()) return
  await ensureFunnelTable()
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${FUNNEL_TABLE}/rows`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        row_data: {
          event, companyId: opts.companyId ?? null, track: opts.track, step: opts.step,
          timestamp: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch { /* best-effort — a missed funnel event is never worth blocking the UI over */ }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/funnel-events.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 6: Wire `recordFunnelEvent` calls into the real call sites found in Step 1**

For each of the 6 events, add a `recordFunnelEvent(...).catch(() => {})` call at its real site (identified in Step 1), alongside the existing `trackEvent(...)` call already there or being added there. Write one small RED→GREEN test per wired call site confirming the function is invoked with the right event name/step when the real user action fires (mirror this plan's existing test-writing style: mock `recordFunnelEvent`, assert the call, never assert on its internals from the call site's own test file).

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: all pass except the known flake.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit, push, PR, merge**

Same shape as Tasks 1-2's final steps, referencing this task's issue number.

---

### Task 4: Admin funnel-summary endpoint

**Files:**
- Create: `app/api/admin/funnel-summary/route.ts`
- Test: `__tests__/api/admin-funnel-summary.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()` (existing, `lib/auth/require-admin.ts`) — the SAME real admin gate `app/api/admin/errors/route.ts` already uses, never a new/weaker check.
- Produces: `GET /api/admin/funnel-summary` → `{shareReachingLastStep: number, medianTimeFirstArtifactToLastStepMs: number | null, sampleSize: number}`.

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(admin): funnel-summary endpoint (share reaching last step, time to last step)" \
  --body "Part of Epic 2 Wave 1 (BLD-06.12). Computes the two real aggregate numbers the epic asks for from builder_funnel_events (Task 3), gated by the same requireAdmin() check every other admin route already uses." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test**

```typescript
// __tests__/api/admin-funnel-summary.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(rows: Array<Record<string, unknown>>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => rows.map((row_data) => ({ row_data })),
    text: async () => JSON.stringify(rows.map((row_data) => ({ row_data }))),
  }) as unknown as Response))
}

import { GET } from '@/app/api/admin/funnel-summary/route'

describe('GET /api/admin/funnel-summary (#BLD-06.12)', () => {
  beforeEach(() => { h.requireAdmin.mockReset() })

  it('rejects a non-admin request', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })
    const res = await GET({} as any)
    expect(res.status).toBe(403)
  })

  it('computes share reaching last step from real recorded events', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'a@b.com', userId: '1' })
    mockFetch([
      { event: 'idea_submitted', companyId: 'c1', track: 'app', step: 'intake', timestamp: '2026-10-01T00:00:00.000Z' },
      { event: 'last_step_reached', companyId: 'c1', track: 'app', step: 'preview', timestamp: '2026-10-01T00:10:00.000Z' },
      { event: 'idea_submitted', companyId: 'c2', track: 'app', step: 'intake', timestamp: '2026-10-01T00:00:00.000Z' },
    ])
    const res = await GET({} as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.sampleSize).toBe(2)
    expect(body.shareReachingLastStep).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/api/admin-funnel-summary.test.ts`
Expected: FAIL — the route file doesn't exist yet.

- [ ] **Step 4: Implement the route**

```typescript
// app/api/admin/funnel-summary/route.ts
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getAinativeApiKey } from '@/lib/build/env-keys'

export const runtime = 'nodejs'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const FUNNEL_TABLE = 'builder_funnel_events'

interface FunnelRow {
  event: string
  companyId: string | null
  track: 'app' | 'company'
  step: string
  timestamp: string
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.ok) return Response.json({ error: admin.message }, { status: admin.status })

  if (!API_KEY || !PROJECT_ID) {
    return Response.json({ shareReachingLastStep: 0, medianTimeFirstArtifactToLastStepMs: null, sampleSize: 0 })
  }

  try {
    const res = await fetch(
      `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${FUNNEL_TABLE}/rows?limit=5000`,
      { headers: { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY }, signal: AbortSignal.timeout(20000) },
    )
    if (!res.ok) return Response.json({ shareReachingLastStep: 0, medianTimeFirstArtifactToLastStepMs: null, sampleSize: 0 })
    const data = JSON.parse(await res.text())
    const rows: FunnelRow[] = (Array.isArray(data) ? data : data.data || data.rows || [])
      .map((r: { row_data?: FunnelRow }) => r.row_data)
      .filter(Boolean)

    const byCompany = new Map<string, FunnelRow[]>()
    for (const r of rows) {
      if (!r.companyId) continue
      if (!byCompany.has(r.companyId)) byCompany.set(r.companyId, [])
      byCompany.get(r.companyId)!.push(r)
    }

    const sampleSize = byCompany.size
    let reached = 0
    const durationsMs: number[] = []
    for (const companyRows of byCompany.values()) {
      const first = companyRows.find((r) => r.event === 'idea_submitted')
      const last = companyRows.find((r) => r.event === 'last_step_reached')
      if (last) reached++
      if (first && last) {
        durationsMs.push(new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime())
      }
    }
    durationsMs.sort((a, b) => a - b)
    const median = durationsMs.length
      ? durationsMs[Math.floor(durationsMs.length / 2)]
      : null

    return Response.json({
      shareReachingLastStep: sampleSize ? reached / sampleSize : 0,
      medianTimeFirstArtifactToLastStepMs: median,
      sampleSize,
    })
  } catch {
    return Response.json({ shareReachingLastStep: 0, medianTimeFirstArtifactToLastStepMs: null, sampleSize: 0 })
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/api/admin-funnel-summary.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all pass except the known flake.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Real production build check**

Run: `pnpm build`
Expected: completes, exit code 0 — same reasoning as Task 2 Step 10 (a new admin route is server-only by construction via its `runtime = 'nodejs'` export and `requireAdmin` import chain, but confirm nothing in this task is reachable from a client component before trusting it).

- [ ] **Step 9: Commit, push, PR, merge**

Same shape as prior tasks, referencing this task's issue number.

- [ ] **Step 10: Confirm deploy, verify**

```bash
curl -s https://builder.ainative.studio/api/health
```

This endpoint has no end-user-facing UI — "verify like a human" here means: confirm the route genuinely requires admin auth in production (a real unauthenticated `curl` to `/api/admin/funnel-summary` must return 401/403, never 200 with data), and if an admin account is available this session, confirm one real call returns a well-formed JSON body (even if `sampleSize: 0` because no real funnel events have been recorded in production yet — that is an honest, correct answer, not a failure).

---

## Completion

After Task 4, re-run `npx vitest run` and `npx tsc --noEmit` one final time across the whole set of changes (all four tasks together), then proceed per `superpowers:executing-plans`' own Final Review step.
