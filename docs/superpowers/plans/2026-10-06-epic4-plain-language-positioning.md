# Epic 4 — Plain-Language, Positioning, and Usage Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "Grow my company" dead-end, remove internal jargon from user-facing copy, make the landing page explain concrete outcomes (including for physical businesses), soften the positioning-artifact prompt's forced "unlike X" framing with a pinning test, and add a static usage-messaging slot during generation.

**Architecture:** Five independent, bounded content/wiring fixes across existing files. No new subsystems, no new ZeroDB tables, no new API routes. Every task is a content change or a one-line wiring fix plus its test.

**Tech Stack:** Next.js/TypeScript, Vitest, React (via `react-dom/client` + `act`, matching this repo's existing component test pattern).

**Spec:** `docs/superpowers/specs/2026-10-06-epic4-plain-language-positioning-design.md`

## Global Constraints

- One GitHub issue per task before any code ("No Code Without An Issue" — repo's own CLAUDE.md rule).
- Real TDD: RED test first, watched failing for the right reason, then GREEN — never written after the fact.
- `npx tsc --noEmit` clean after every task.
- Full `npx vitest run` suite green after every task. One known pre-existing flake to expect and NOT chase: `__tests__/lib/build/task-splitter.test.ts`'s "never throws when splitTaskViaLLM itself... throws" test — a CPU-contention/`vi.spyOn` module-caching race, confirmed harmless across ~10 PRs this session.
- Real PR per task referencing its issue number.
- Real Railway deploy verification via `curl https://builder.ainative.studio/api/health` matching the new commit SHA after merge (note: this session has an open, known issue — GitHub-auto-deploy-to-Railway is unreliable; verify via the health endpoint regardless of which path triggered the deploy, and flag if the SHA does not update within a reasonable window rather than silently assuming success).
- Genuine human-style Chrome-browser verification for anything user-facing before calling a task done — not just API/unit-test checks.
- This is an autonomous loop: no human checkpoints between tasks. Each task's acceptance criteria is fully self-contained.

## Review Focus

(Carried verbatim from the design spec's own Review Focus section — each line gets its test added to the task that owns the code.)

- Stale `growthIntent` across a repeat visit → Task 1's test.
- `ARTIFACT_TITLES` fallback for an unmapped view id → Task 2's test.
- BLD-11's physical-business sentence must read sensibly for both tracks → Task 3's test/manual check.
- BLD-09's eval test must assert on the real exported prompt-building function, not a hand-copied duplicate → Task 4's test.
- SEP-06's static usage message must not claim a precise dollar/credit figure → Task 5's test.

---

### Task 1: BLD-10 — "Grow my company" reaches kickoff, not a dead-end login wall

**Files:**
- Modify: `lib/build/state.ts` (add `growthIntent` to `BuildState`, a new `SET_GROWTH_INTENT` action + reducer case, add to initial state)
- Modify: `components/build/screens/Start.tsx:36-41` (`goBuild()`)
- Modify: `components/build/screens/KickoffQuestions.tsx:28`
- Test: `__tests__/lib/build/state-growth-intent.test.ts` (new)
- Test: `__tests__/components/build/Start.test.tsx` (new)
- Test: `__tests__/components/build/KickoffQuestions-growth.test.tsx` (new)

**Interfaces:**
- Consumes: `BuildState` (`lib/build/state.ts:79-...`), `getKickoffQuestions(track, isGrowth)` (`lib/build/kickoff-questions.ts`, already accepts a boolean second arg — confirmed signature unchanged).
- Produces: `BuildState.growthIntent: boolean`, `{type: 'SET_GROWTH_INTENT', value: boolean}` action, both consumed by `KickoffQuestions.tsx`.

- [ ] **Step 1: Write the failing reducer test**

```typescript
// __tests__/lib/build/state-growth-intent.test.ts
import { describe, it, expect } from 'vitest'
import { reducer, initialState } from '@/lib/build/state'

describe('growthIntent (#BLD-10)', () => {
  it('defaults to false', () => {
    expect(initialState.growthIntent).toBe(false)
  })

  it('SET_GROWTH_INTENT sets the flag', () => {
    const next = reducer(initialState, { type: 'SET_GROWTH_INTENT', value: true })
    expect(next.growthIntent).toBe(true)
  })

  it('SET_GROWTH_INTENT can clear the flag back to false', () => {
    const grown = reducer(initialState, { type: 'SET_GROWTH_INTENT', value: true })
    const cleared = reducer(grown, { type: 'SET_GROWTH_INTENT', value: false })
    expect(cleared.growthIntent).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/build/state-growth-intent.test.ts`
Expected: FAIL — `initialState.growthIntent` is `undefined`, not `false`; `SET_GROWTH_INTENT` is not a recognized action type (TS error or runtime no-op depending on reducer's default case).

- [ ] **Step 3: Add `growthIntent` to `BuildState`, initial state, action union, and reducer**

In `lib/build/state.ts`, add to the `BuildState` interface (near `answers`, `:103`):
```typescript
  growthIntent: boolean   // #BLD-10 — true when the visitor picked "Grow my company" on Start.tsx
```
Add to the initial state object (near `answers: {}`, `:200`):
```typescript
  growthIntent: false,
```
Add to the `BuildAction` union (near `SET_BRAND_DRAFT`, `:242`):
```typescript
  | { type: 'SET_GROWTH_INTENT'; value: boolean }
```
Add a reducer case (near `SET_BRAND_DRAFT`'s case, `:402`):
```typescript
    case 'SET_GROWTH_INTENT':
      return { ...state, growthIntent: action.value }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/build/state-growth-intent.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add lib/build/state.ts __tests__/lib/build/state-growth-intent.test.ts
git commit -m "feat(state): add growthIntent flag and SET_GROWTH_INTENT action (#BLD-10)"
```

- [ ] **Step 6: Write the failing Start.tsx test**

```typescript
// __tests__/components/build/Start.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ dispatch: dispatchMock }) }))

import { Start } from '@/components/build/screens/Start'

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

describe('Start — "Grow my company" reaches kickoff (#BLD-10)', () => {
  it('picking "Grow my company" then Continue dispatches GOTO_SCREEN build AND SET_GROWTH_INTENT true', async () => {
    render(React.createElement(Start))
    const growBtn = host.querySelector('[data-testid="start-grow"]') as HTMLButtonElement
    const continueBtn = host.querySelector('[data-testid="start-continue"]') as HTMLButtonElement
    await act(async () => { growBtn.click() })
    await act(async () => { continueBtn.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_GROWTH_INTENT', value: true })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'build' })
  })

  it('picking "Create a new company" then Continue dispatches SET_GROWTH_INTENT false', async () => {
    render(React.createElement(Start))
    const continueBtn = host.querySelector('[data-testid="start-continue"]') as HTMLButtonElement
    await act(async () => { continueBtn.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_GROWTH_INTENT', value: false })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'build' })
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/Start.test.tsx`
Expected: FAIL — `goBuild()` still dispatches `screen: 'login'` for the grow path and never dispatches `SET_GROWTH_INTENT` at all.

- [ ] **Step 8: Fix `Start.tsx`'s `goBuild()`**

Replace `components/build/screens/Start.tsx:36-41`:
```typescript
  const goBuild = () => {
    window.scrollTo(0, 0)
    // #BLD-10 — both paths now reach the SAME idea-entry/kickoff flow;
    // growthIntent tells KickoffQuestions.tsx which question variant to show.
    // The auth-wall decision stays exactly where Epic 3 put it, inside
    // KickoffQuestions.tsx's proceed() — this screen never decides auth.
    dispatch({ type: 'SET_GROWTH_INTENT', value: path === 'grow' })
    dispatch({ type: 'GOTO_SCREEN', screen: 'build' })
  }
```
Also update the file's header comment (`:4-12`) to remove the now-stale "Grow my company → straight to auth" line, replacing with: "Both paths reach the same build/kickoff flow; growthIntent (set here) selects which kickoff question variant KickoffQuestions.tsx shows."

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/Start.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 10: Write the failing KickoffQuestions growth-variant test**

```typescript
// __tests__/components/build/KickoffQuestions-growth.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }), getSession: vi.fn(async () => null) }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: () => 'continue' }))
vi.mock('@/lib/build/anon-draft-token', () => ({ getOrCreateAnonDraftToken: () => 'tok-growth' }))
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { track: 'company', idea: 'x', appSub: 'acme', companyName: 'Acme', brandTagline: '', brandColor: '#000', answers: {}, growthIntent: true },
    dispatch: dispatchMock,
  }),
}))

import { KickoffQuestions } from '@/components/build/screens/KickoffQuestions'
import { COMPANY_GROW_BUSINESS_QUESTIONS } from '@/lib/build/kickoff-questions'

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

describe('KickoffQuestions — growth variant reachable (#BLD-10)', () => {
  it('shows the first COMPANY_GROW_BUSINESS_QUESTIONS question when state.growthIntent is true', () => {
    render(React.createElement(KickoffQuestions))
    expect(host.textContent).toContain(COMPANY_GROW_BUSINESS_QUESTIONS[0].text)
  })
})
```

- [ ] **Step 11: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/KickoffQuestions-growth.test.tsx`
Expected: FAIL — `getKickoffQuestions(state.track, false)` hard-codes `false`, so the new-business question set shows regardless of `state.growthIntent`.

- [ ] **Step 12: Fix `KickoffQuestions.tsx:28`**

```typescript
  const questions = getKickoffQuestions(state.track, state.growthIntent ?? false)
```

- [ ] **Step 13: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/KickoffQuestions-growth.test.tsx`
Expected: PASS, 1/1.

- [ ] **Step 14: Commit**

```bash
git add components/build/screens/Start.tsx components/build/screens/KickoffQuestions.tsx __tests__/components/build/Start.test.tsx __tests__/components/build/KickoffQuestions-growth.test.tsx
git commit -m "fix(start): route Grow my company into kickoff instead of a dead-end login wall (#BLD-10)"
```

**Completion contract:** `npx vitest run __tests__/lib/build/state-growth-intent.test.ts __tests__/components/build/Start.test.tsx __tests__/components/build/KickoffQuestions-growth.test.tsx` → 6/6 pass. `npx tsc --noEmit` clean.

---

### Task 2: BLD-08 — remove internal jargon from user-facing copy

**Files:**
- Modify: `lib/build/titles.ts` (4 entries: `dataModel`, `memoryPolicy`, `thesis`, `wedge`)
- Modify: `components/build/JourneyBar.tsx:77` (title lookup instead of raw `v`)
- Modify: `components/build/screens/Pricing.tsx:43,48`
- Modify: `components/build/screens/Account.tsx:289,349-350`
- Modify: `components/build/BuildOverlays.tsx:57,82-83`
- Modify: `components/build/AutoModePanel.tsx:176`
- Modify: `components/build/DocumentsPanel.tsx:367`
- Modify: `components/build/OnboardingVideo.tsx:122`
- Modify: `components/build/LiveTicker.tsx:23`
- Test: `__tests__/lib/build/titles-plain-language.test.ts` (new)
- Test: `__tests__/components/build/JourneyBar-title-fallback.test.tsx` (new)
- Test: `__tests__/components/build/no-jargon-strings.test.ts` (new — a single repo-wide guard test)

**Interfaces:**
- Consumes: `ARTIFACT_TITLES` (`lib/build/titles.ts`, existing `Record<string,string>` export, shape unchanged).
- Produces: nothing new consumed elsewhere — this task only changes string content and one lookup call.

- [ ] **Step 1: Write the failing titles-content test**

```typescript
// __tests__/lib/build/titles-plain-language.test.ts
import { describe, it, expect } from 'vitest'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

describe('ARTIFACT_TITLES — plain language (#BLD-08)', () => {
  it('dataModel, memoryPolicy, thesis, wedge no longer use internal jargon', () => {
    expect(ARTIFACT_TITLES.dataModel).not.toBe('Data Model')
    expect(ARTIFACT_TITLES.memoryPolicy).not.toBe('Memory Policy')
    expect(ARTIFACT_TITLES.thesis).not.toBe('Venture Thesis')
    expect(ARTIFACT_TITLES.wedge).not.toBe('Initial Wedge')
    expect(ARTIFACT_TITLES.dataModel).toMatch(/your|the/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/build/titles-plain-language.test.ts`
Expected: FAIL — current values are exactly `'Data Model'` / `'Memory Policy'` / `'Venture Thesis'` / `'Initial Wedge'`.

- [ ] **Step 3: Update `lib/build/titles.ts`**

```typescript
export const ARTIFACT_TITLES: Record<string, string> = {
  design: 'Design System', brief: 'Product Brief', prd: 'Product Requirements', comp: 'AINative Composition Plan',
  dataModel: 'Your data model', memoryPolicy: 'What Cody remembers', agentDef: 'Agent Definition',
  codingStandards: 'Engineering Standards', apiSpec: 'Integrations',
  backlog: 'Build Backlog', sprintPlan: 'Sprint Plan', swarm: 'The swarm',
  infra: 'Infrastructure', preview: 'Running Preview',
  thesis: 'Your business thesis', wedge: 'Your first customers', businessModel: 'Business Model',
  positioning: 'Positioning', landing: 'Landing Page', plan30: '30-Day Plan',
  pipeline: 'Sales Pipeline', 'rescope-intent': 'Re-scope the wedge', conflict: 'Dependency Conflict', graph: 'The artifact graph',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/build/titles-plain-language.test.ts`
Expected: PASS, 1/1.

- [ ] **Step 5: Write the failing JourneyBar fallback test**

```typescript
// __tests__/components/build/JourneyBar-title-fallback.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { track: 'company', view: 'thesis' },
    views: ['thesis', 'unmappedFutureView'],
    dispatch: vi.fn(),
    goView: vi.fn(),
    woven: 0,
    totalPrimitives: 10,
  }),
}))
vi.mock('@/components/build/WorkspaceShell', () => ({ currentActIndex: () => 0 }))

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

describe('JourneyBar chip labels (#BLD-08)', () => {
  it('shows the plain ARTIFACT_TITLES label, not the raw view id, for a mapped view', () => {
    render(React.createElement(JourneyBar))
    expect(host.textContent).toContain('Your business thesis')
    expect(host.textContent).not.toContain('thesis')
  })

  it('falls back to the raw view id for an unmapped view rather than rendering blank', () => {
    render(React.createElement(JourneyBar))
    expect(host.textContent).toContain('unmappedFutureView')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/JourneyBar-title-fallback.test.tsx`
Expected: FAIL — first assertion fails because `JourneyBar.tsx:77` renders the raw `v` (`"thesis"`), not `ARTIFACT_TITLES['thesis']`.

- [ ] **Step 7: Fix `JourneyBar.tsx:77`**

Add the import (near the other `lib/build` imports, `:18`):
```typescript
import { ARTIFACT_TITLES } from '@/lib/build/titles'
```
Change line 77 from `{v}` to:
```typescript
{ARTIFACT_TITLES[v] ?? v}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/JourneyBar-title-fallback.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 9: Write the failing repo-wide jargon guard test**

```typescript
// __tests__/components/build/no-jargon-strings.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const JARGON = /agent[- ]?swarm|autonomous loop/i
const FILES = [
  'components/build/screens/Pricing.tsx',
  'components/build/screens/Account.tsx',
  'components/build/BuildOverlays.tsx',
  'components/build/AutoModePanel.tsx',
  'components/build/DocumentsPanel.tsx',
  'components/build/OnboardingVideo.tsx',
  'components/build/LiveTicker.tsx',
]

describe('no internal jargon in user-facing copy (#BLD-08)', () => {
  for (const file of FILES) {
    it(`${file} contains no "agent swarm" / "autonomous loop" string`, () => {
      const content = readFileSync(file, 'utf-8')
      expect(content).not.toMatch(JARGON)
    })
  }
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/no-jargon-strings.test.ts`
Expected: FAIL on at least `Pricing.tsx`, `Account.tsx`, `BuildOverlays.tsx`, `AutoModePanel.tsx`, `DocumentsPanel.tsx`, `OnboardingVideo.tsx`, `LiveTicker.tsx` (7 failures) — each still contains "agent swarm"/"autonomous loop" per the confirmed grep hits.

- [ ] **Step 11: Replace jargon strings in all 7 files**

- `Pricing.tsx:43`: "The nightly autonomous loop + real agent swarm" → "Cody keeps working overnight, with a full team of AI workers"
- `Pricing.tsx:48`: "Full agent-swarm autonomy." → "Cody's full team works independently."
- `Account.tsx:289`: "nightly loop & swarm on paid plans" → "overnight work and Cody's full team on paid plans"
- `Account.tsx:349-350`: "agent swarm" → "Cody's team of AI workers"
- `BuildOverlays.tsx:57`: "Cody's swarm is building the MVP" → "Cody's team is building your MVP"
- `BuildOverlays.tsx:82-83`: "Provisioning your infrastructure" / "Provision everything, ask nothing" → keep "Provisioning your infrastructure" (not jargon, a real technical step name users understand in context) — remove only "Provision everything, ask nothing" (internal engineering-principle phrasing) → "Setting everything up automatically"
- `AutoModePanel.tsx:176`: "swarm" → "Cody's team"
- `DocumentsPanel.tsx:367`: "swarm" → "Cody's team"
- `OnboardingVideo.tsx:122`: "swarm" → "Cody's team"
- `LiveTicker.tsx:23`: "swarm" → "Cody's team"

Read each file's exact surrounding context before editing (string interpolation, JSX structure may require preserving exact punctuation/capitalization at sentence boundaries).

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/no-jargon-strings.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 13: Commit**

```bash
git add lib/build/titles.ts components/build/JourneyBar.tsx components/build/screens/Pricing.tsx components/build/screens/Account.tsx components/build/BuildOverlays.tsx components/build/AutoModePanel.tsx components/build/DocumentsPanel.tsx components/build/OnboardingVideo.tsx components/build/LiveTicker.tsx __tests__/lib/build/titles-plain-language.test.ts __tests__/components/build/JourneyBar-title-fallback.test.tsx __tests__/components/build/no-jargon-strings.test.ts
git commit -m "fix(copy): remove internal jargon (swarm/autonomous loop) from user-facing strings (#BLD-08)"
```

**Completion contract:** `npx vitest run __tests__/lib/build/titles-plain-language.test.ts __tests__/components/build/JourneyBar-title-fallback.test.tsx __tests__/components/build/no-jargon-strings.test.ts` → 10/10 pass. `npx tsc --noEmit` clean.

---

### Task 3: BLD-11 — landing page explains what you get, handles physical businesses

**Files:**
- Modify: `components/build/screens/Landing.tsx` (new section between beat 1 and beat 2)
- Modify: `components/build/screens/Auth.tsx:28-29`
- Test: `__tests__/components/build/Landing-what-you-get.test.tsx` (new)
- Test: `__tests__/components/build/Auth-copy.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed elsewhere — pure content/markup addition.

- [ ] **Step 1: Write the failing Landing test**

```typescript
// __tests__/components/build/Landing-what-you-get.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ dispatch: vi.fn() }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))

import { Landing } from '@/components/build/screens/Landing'

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

describe('Landing — what you get + physical business framing (#BLD-11)', () => {
  it('names a concrete software-track deliverable (an app)', () => {
    render(React.createElement(Landing))
    expect(host.textContent).toMatch(/app/i)
  })

  it('explicitly names a physical/local business example', () => {
    render(React.createElement(Landing))
    expect(host.textContent).toMatch(/bakery|gym|landscaping|local business/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/Landing-what-you-get.test.tsx`
Expected: FAIL on the second assertion — confirmed via the design spec's direct read, zero mention of physical/local-business examples anywhere in `Landing.tsx` today.

- [ ] **Step 3: Add the "what you get" section to `Landing.tsx`**

Insert a new section between beat 1 (`:293-295`, "You Are Not Alone") and beat 2 (`:334`, "A cofounder from another world"), following the same JSX/CSS-class structure the surrounding beats already use (read the exact surrounding beat markup before inserting to match its wrapper div/className pattern):

```tsx
<section className="m-land-beat" aria-label="What you get">
  <h2>What you actually get</h2>
  <p>
    Building software? You get a real, running app — not a mockup.
    Running a bakery, a gym, a landscaping company, or any other local
    business? Cody builds the website, the customer intake forms, and
    the first-customer outreach plan — no code, no software background
    needed either way.
  </p>
</section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/Landing-what-you-get.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 5: Write the failing Auth.tsx copy test**

```typescript
// __tests__/components/build/Auth-copy.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: { track: 'company' }, dispatch: vi.fn() }) }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn(), useSession: () => ({ data: null }) }))

import { Auth } from '@/components/build/screens/Auth'

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

describe('Auth.tsx subtitle — plain language (#BLD-11)', () => {
  it('does not say "primitives" or "building blocks"', () => {
    render(React.createElement(Auth))
    expect(host.textContent).not.toMatch(/primitives|building blocks/i)
  })

  it('names a concrete outcome (website, plan, or customers)', () => {
    render(React.createElement(Auth))
    expect(host.textContent).toMatch(/website|plan|customers/i)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/Auth-copy.test.tsx`
Expected: FAIL on the first assertion — confirmed exact string at `Auth.tsx:29`: "AINative primitives are the building blocks."

- [ ] **Step 7: Update `Auth.tsx:28-29`**

```typescript
"Describe your idea."
"Cody builds the website, the plan, and your first customers."
```
(Match whatever exact JSX/string-literal structure lines 28-29 actually use — read them directly before editing, preserving any surrounding element wrapper.)

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/Auth-copy.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 9: Commit**

```bash
git add components/build/screens/Landing.tsx components/build/screens/Auth.tsx __tests__/components/build/Landing-what-you-get.test.tsx __tests__/components/build/Auth-copy.test.tsx
git commit -m "feat(landing): explain concrete outcomes, including for physical businesses (#BLD-11)"
```

**Completion contract:** `npx vitest run __tests__/components/build/Landing-what-you-get.test.tsx __tests__/components/build/Auth-copy.test.tsx` → 4/4 pass. `npx tsc --noEmit` clean. Human-style Chrome verification: load `/` (landing) live, confirm the new section renders and reads sensibly.

---

### Task 4: BLD-09 — positioning prompt softened + minimal pinning eval

**Files:**
- Modify: `lib/build/artifact-prompts.ts:95-101`
- Test: `__tests__/lib/build/artifact-prompts-positioning.test.ts` (new)

**Interfaces:**
- Consumes: the real, exported prompt-building function for the `positioning` artifact in `lib/build/artifact-prompts.ts` (read the file to confirm its exact exported name before writing the test — do not guess or hand-duplicate the prompt string).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Read `lib/build/artifact-prompts.ts` to find positioning's real exported function name**

Run: `grep -n "export function\|positioning" lib/build/artifact-prompts.ts`
Identify the exact function that builds the `positioning` artifact's prompt (the one containing the `'unlike (array of 3 "unlike the alternatives" contrasts)'` instruction at `:95-101`). Use that exact function name in the test below — do not invent one.

- [ ] **Step 2: Write the failing pinning test**

```typescript
// __tests__/lib/build/artifact-prompts-positioning.test.ts
import { describe, it, expect } from 'vitest'
// Replace `buildPositioningPrompt` below with the REAL exported function
// name found in Step 1 — call it exactly as artifact generation calls it.
import { buildPositioningPrompt } from '@/lib/build/artifact-prompts'

describe('positioning prompt — no forced "unlike X" framing (#BLD-09)', () => {
  it('the real prompt-building function does not instruct the model to produce "unlike" contrasts', () => {
    const prompt = buildPositioningPrompt({ idea: 'a scheduling app', track: 'company', companyName: 'Acme' } as any)
    expect(prompt.toLowerCase()).not.toContain('unlike')
  })
})
```

(Adjust the function's argument shape to match its real signature, confirmed in Step 1 — do not invent parameters; read the function's existing call site in `app/api/build/artifact/route.ts` or wherever it is invoked to get the real argument shape.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/build/artifact-prompts-positioning.test.ts`
Expected: FAIL — confirmed via direct read, `artifact-prompts.ts:95-101` contains the literal instruction `'unlike (array of 3 "unlike the alternatives" contrasts)'`.

- [ ] **Step 4: Soften the prompt**

Replace the `'unlike (array of 3 "unlike the alternatives" contrasts)'` line (`:95-101`, exact surrounding structure preserved — this is one field within a larger prompt-construction template) with:
```
'differentiators (array of up to 3 things that make this company distinct, phrased positively rather than as contrasts against named competitors)'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/build/artifact-prompts-positioning.test.ts`
Expected: PASS, 1/1.

- [ ] **Step 6: Commit**

```bash
git add lib/build/artifact-prompts.ts __tests__/lib/build/artifact-prompts-positioning.test.ts
git commit -m "fix(prompts): soften positioning artifact's forced 'unlike X' framing, pin with a test (#BLD-09)"
```

**Completion contract:** `npx vitest run __tests__/lib/build/artifact-prompts-positioning.test.ts` → 1/1 pass. `npx tsc --noEmit` clean.

---

### Task 5: SEP-06 — usage-based pricing message during generation

**Files:**
- Modify: `components/build/BuildOverlays.tsx` (add a static usage-message line to the `swarm` and `infra` overlay kinds)
- Test: `__tests__/components/build/BuildOverlays-usage-message.test.tsx` (new)

**Interfaces:**
- Consumes: `BuildOverlays.tsx`'s existing overlay-kind rendering structure (read the file's real per-kind headline/sub-copy structure before editing — do not assume a shape not already confirmed).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Read `BuildOverlays.tsx`'s real per-overlay-kind structure**

Run: `grep -n "forming\|swarm\|infra\|provisioning\|sub-copy\|subCopy" components/build/BuildOverlays.tsx`
Confirm the exact prop/variable names used to distinguish overlay kinds and render sub-copy, to match the plan's steps below to the real structure rather than an assumed one.

- [ ] **Step 2: Write the failing usage-message test**

```typescript
// __tests__/components/build/BuildOverlays-usage-message.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import { BuildOverlays } from '@/components/build/BuildOverlays'

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

describe('BuildOverlays — usage message during generation (#SEP-06)', () => {
  it('shows a plan-inclusive usage message on the swarm overlay, with no specific dollar or credit figure', () => {
    // Render with whatever real prop shape triggers the 'swarm' overlay kind —
    // confirmed from Step 1's grep before finalizing this render call.
    render(React.createElement(BuildOverlays, { kind: 'swarm' } as any))
    expect(host.textContent).toMatch(/included in your plan|no surprise charges/i)
    expect(host.textContent).not.toMatch(/\$\d|‎\d+ credits?/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/BuildOverlays-usage-message.test.tsx`
Expected: FAIL — confirmed via direct read, no usage-messaging slot exists in any of the three overlay kinds today.

- [ ] **Step 4: Add the static usage-message line**

In `BuildOverlays.tsx`, add a new string constant alongside the existing fixed headline/sub-copy, shown only for `swarm` and `infra` kinds (not `forming` or `preview`, matching the design spec's "longest-running, most resource-intensive stages" scoping):
```typescript
const USAGE_MESSAGE = "This build uses your plan's included generation credits — no surprise charges."
```
Render it as an additional line within the `swarm`/`infra` overlay branches, following the exact same JSX pattern the existing sub-copy line already uses in that branch (read the real branch structure from Step 1 before inserting — match indentation/wrapper element).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/BuildOverlays-usage-message.test.tsx`
Expected: PASS, 1/1.

- [ ] **Step 6: Commit**

```bash
git add components/build/BuildOverlays.tsx __tests__/components/build/BuildOverlays-usage-message.test.tsx
git commit -m "feat(build): show plan-inclusive usage message during long generation stages (#SEP-06)"
```

**Completion contract:** `npx vitest run __tests__/components/build/BuildOverlays-usage-message.test.tsx` → 1/1 pass. `npx tsc --noEmit` clean.

---

## Final Verification (all tasks)

- [ ] Run the full suite: `npx vitest run` — all tests green except the known `task-splitter.test.ts` flake (do not chase it).
- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Merge each task's PR (or combine into fewer PRs if issues are filed together — executor's call, ledgered either way).
- [ ] Verify Railway deploy picks up the final merged SHA via `curl https://builder.ainative.studio/api/health`.
- [ ] Human-style Chrome MCP verification: visit landing page live, confirm new "what you get" section renders; complete a "Grow my company" flow live through to kickoff questions (confirming the growth-variant question set actually shows); confirm JourneyBar chips show plain titles, not raw view ids, in a live build.
