# Epic 2, Wave 1 — Workspace Layout + Funnel Baseline (Design Spec)

**Status:** self-approved under the standing autonomous-loop authorization (no human review gate for this spec pass).

**Scope:** the first two Wave 1 stories of Epic 2 (Cody-guided workspace) from the Oct 2026 backlog doc:

- **BLD-06.1** — Workspace layout (8 pts, P0): merge the phase bar + artifact chip row into one journey bar; replace the right-hand Artifacts index with a persistent Cody chat panel; keep the primitives log on the left; artifact stays in the middle.
- **BLD-06.12** — Funnel instrumentation and baseline (3 pts, P1): ship *before* BLD-06.2 (per the backlog doc's own ordering note) so a baseline exists before the guided-chat stories change the funnel.

Later Epic 2 stories (BLD-06.2 through BLD-06.13) depend on the chat panel this spec creates existing as a real component, but their own behavior (step summaries, question/revise, save/restore, off-topic steering, primitive confirmations, routing, mobile) is **out of scope here** — each gets its own spec/plan as its own wave lands, per this session's established "one spec per epic, in wave order" decomposition.

## Codebase reality (confirmed by direct reads, not assumption)

- **Phase bar today** = `ActBar` in `components/build/WorkspaceShell.tsx:22-69`. Renders `APP_ACT_LABELS`/`COMPANY_ACT_LABELS` (`lib/build/acts.ts`) as an ordered list, done/current/upcoming driven by `currentActIndex(state)` (`WorkspaceShell.tsx:171-192`).
- **Artifact chip row today** = `PathBreadcrumb` in `WorkspaceShell.tsx:109-131`. Renders `views` (the ordered artifact list for the current track) as clickable crumbs, done/current/upcoming driven by `state.done[v]`.
- **Artifacts index to replace** = `ArtifactRail` (`components/build/ArtifactRail.tsx`, 112 lines) — a right-side drawer toggled by `state.railOpen`/`TOGGLE_RAIL`, built from `buildArtifactGraph(state.track, state.done)`, grouped into 6 categories with a persisted collapse/expand accordion (`lib/build/artifact-rail-prefs.ts`). This is NOT the same thing as `IndexPanel` (`WorkspaceShell.tsx:72-107`, `state.indexOpen`/`TOGGLE_INDEX`) — a separate flat jump-to-any-screen modal that this epic does not mention and that stays as-is.
- **No two-way Cody chat exists in the build workspace today.** `CodyFeed` (`components/build/CodyFeed.tsx`) is a read-only, left-panel commentary log — one line per completed artifact, no input, no Q&A. A real two-way chat UI (turn-by-turn log, free-text input, `.m-chat-cody`) exists only in `components/build/screens/Live.tsx` (~lines 1457-1570), the *post-build* company-dashboard screen — useful as a style/pattern reference, not currently wired into the build workspace.
- **Primitives log** = `CodyFeed` itself, rendered as `<aside className="m-feed">` at the shell's left slot (`WorkspaceShell.tsx:158`, fed via the `feed` prop). The epic's "primitives log on the left" requirement is already satisfied by this component as-is — no structural change needed.
- **State shape** (`lib/build/state.ts`): `view` (current artifact), `done: Record<string,string>` (artifact→status, already drives both the chip row and the rail), `screen`, `track`, `tablet: boolean`, `railOpen`/`indexOpen: boolean` (mutually exclusive panel toggles), `designStepDone`/`builtCompany`/`builtMVP: boolean` (phase-completion flags `currentActIndex` reads). Merging the two top bars and swapping the rail for a chat panel needs **no new top-level state fields** — it's UI composition over state that already exists, plus new state scoped to the chat panel's own concerns (below).
- **Mobile breakpoint pattern**: `contexts/build-context.tsx` installs `window.matchMedia('(max-width: 1024px)')`, dispatching `SET_TABLET`; consumers read `state.tablet` for an `is-tablet` CSS class (`WorkspaceShell.tsx:157`, `Live.tsx:1085`). This is a *tablet* threshold. BLD-06.11 (mobile full-screen chat, a later Wave 3 story) will need its own, narrower breakpoint — out of scope for this spec, but the journey bar and chat panel built here must not hard-code assumptions that make that follow-up harder (e.g., the chat panel component must be able to render full-bleed without the shell's `m-ws-body` grid getting in the way).
- **Existing analytics**: `trackEvent(action, category, label?, value?)` in `components/analytics/google-analytics.tsx` is real, already wired (GA4), and already used elsewhere in this codebase (e.g. `Auth.tsx`). BLD-06.12 reuses this for client-side firing — but GA alone cannot answer "share of ventures reaching the last step" as a queryable dashboard metric, so a small real backend store is needed too (see below).

## Design

### BLD-06.1 — Workspace layout

**New component: `JourneyBar`** (`components/build/JourneyBar.tsx`), replacing `ActBar` + `PathBreadcrumb` as the thing `WorkspaceShell` renders in their place. It is NOT a merge of their internals into one file by accident — it is a deliberate single component because the epic's own acceptance scenario requires one bar showing phases *and* the current phase's artifacts together, which `ActBar`/`PathBreadcrumb` being two separately-rendered siblings cannot express (today they stack as two bars, not one).

Behavior, grounded in what each replaced piece already does:
- Renders `actLabels` (from `lib/build/acts.ts`, unchanged) as the phase row, done/current/upcoming via the existing `currentActIndex(state)` helper (kept, unmoved, in `WorkspaceShell.tsx` since other code may still reference it — confirmed by grep before the plan is written).
- Beneath the phase row, renders the full `views` sequence as chips (the SAME set `PathBreadcrumb` renders today — confirmed `trackViews()`/`APP_VIEWS`/`COMPANY_VIEWS` carry no per-view phase/act membership anywhere in this codebase; `currentActIndex` answers "which phase is the whole workspace in" from `state.screen`/completion flags, never "which phase does artifact X belong to." Building a position-based view→act mapping to filter chips down to only the current phase's artifacts is real, non-trivial new logic the epic doc does not actually require — its acceptance scenario needs the chips to exist and show done/current/upcoming, not to be grouped and hidden by phase. Filtering is explicitly OUT of scope for this story; a later story may add it once a real mapping is designed and verified against both tracks' actual act boundaries, including the Company track's documented quirk of having no dedicated Design act at all). Done/current/upcoming driven by `state.done[v]`, clickable the same way `PathBreadcrumb` already is (`!state.auto && (isDone || isCurrent)`).
- Keeps `ActBar`'s right-side controls (`woven/totalPrimitives` count, the "Index" button for `IndexPanel`, `AccountMenu`) — these are unrelated to the rail removal and the epic doesn't ask to remove them.
- Removes the "Artifacts · {doneCount}" toggle button (it toggled the rail being deleted) and the whole `railOpen`/`TOGGLE_RAIL` toggle button from the bar — the chat panel this story adds is **persistent**, not a drawer, so there is nothing left to toggle open/closed here. (`railOpen`/`TOGGLE_RAIL` themselves stay in `state.ts`/the reducer for now — deleting a reducer action is a larger blast radius than this story's scope; the plan's tests confirm nothing else still dispatches `TOGGLE_RAIL` before removing it is considered, but removal is NOT required for this story to be correct, only removing the UI that triggers it from the new bar.)

**New component: `CodyChatPanel`** (`components/build/CodyChatPanel.tsx`), replacing `ArtifactRail` in `WorkspaceShell`'s right-side slot. This story's scope is the *persistent panel shell*, not the guided conversation behavior (summaries, Q&A, save/restore are BLD-06.2 through BLD-06.4's job). For this story, `CodyChatPanel` is a real, visible, always-on right panel with:
- A header ("Cody").
- A message log area, seeded with a single static placeholder message per artifact view change (e.g. "You're on {current artifact}.") — genuinely rendered from real state (`state.view`), not a hardcoded string, so the component is truthfully "the chat panel" and not an empty shell, while not overclaiming BLD-06.2's actual summarization behavior.
- A disabled-looking (but present) text input at the bottom, with a placeholder like "Guided Q&A coming soon" — this is the real, honest state of the feature at the end of THIS story; later stories (BLD-06.2/06.3) wire it live. Disabled rather than absent, because the epic's acceptance scenario requires "the Cody chat is open in the right panel" to be literally true after this story, and a present-but-not-yet-functional input is the honest way to satisfy that without faking functionality that doesn't exist yet.

**`WorkspaceShell.tsx` changes:**
- Remove `<ActBar />`, `<PathBreadcrumb />`, `<ArtifactRail />`.
- Add `<JourneyBar />` in their place (same position in the DOM as `ActBar` was).
- Replace the right-side `<aside className="m-rail">{rail}</aside>` + unconditional `<ArtifactRail />` with a single `<aside className="m-cody-chat"><CodyChatPanel /></aside>`, unconditional (no `railOpen` gating — it is always present, per "persistent").
- The `rail` prop `WorkspaceShell` currently accepts becomes dead (no caller needs to pass rail content anymore) — confirmed by grep across all `<WorkspaceShell` call sites before the plan removes the prop, so removing it doesn't silently drop content some screen still relies on.
- `IndexPanel` is untouched — different feature, not in scope.

**CSS**: new `.m-journey-bar` and `.m-cody-chat` rules replace `.m-actbar`/`.m-breadcrumb`/`.m-rail-drawer` in the stylesheet the shell uses — written to visually match the existing modernist theme (reuse existing tokens/colors, don't invent a new palette).

### BLD-06.12 — Funnel instrumentation and baseline

**Client-side firing**: add `trackEvent('idea_submitted' | 'kickoff_answered' | 'step_viewed' | 'question_answered' | 'save' | 'last_step_reached', 'funnel', label, value)` calls at the real call sites that already exist for each of these actions (idea submission handler, kickoff answer handler, `goView`/view-change in `build-context.tsx`, the save action, reaching the final `views` entry for the track) — reusing the existing `trackEvent` function, no new client library.

**Server-side storage** (needed because "share of ventures reaching the last step" and "time from first artifact to last step" are aggregate queries GA4's UI doesn't expose cheaply to this team today, and this codebase's own pattern — e.g. `builder_otp_delivery` from Epic 1 — is a small, purpose-built ZeroDB table per real need, not a general analytics warehouse): a new `builder_funnel_events` ZeroDB table (same `ensureTable`-then-write idempotent-create pattern as `lib/build/otp.ts`), one row per event: `{event: string, companyId: string | null (null pre-signup), track: 'app'|'company', step: string, timestamp: string}`. A thin `lib/build/funnel-events.ts` module (`recordFunnelEvent`, best-effort, never blocks the UI action it's attached to — matches this codebase's established fire-and-forget pattern for non-critical telemetry) and one new admin-only read endpoint (`app/api/admin/funnel-summary/route.ts`) that computes the two real numbers the epic asks for (share reaching last step, median time first-artifact→last-step) from that table. No new dashboard UI framework — a simple JSON endpoint an admin can hit, consistent with this codebase's existing `/api/admin/*` surface (confirmed to exist via the `app/api/admin/errors/route.ts` reference the earlier build log already showed).

## Review Focus

- A user on the App track (not Company) must see the journey bar's phase set correctly switch to `APP_ACT_LABELS` — the merged component must not hard-code the Company phase list.
- `state.auto` (Cody actively auto-building) must still gate chip clickability in the merged bar exactly as `PathBreadcrumb` already does — a founder must not be able to jump ahead mid-autobuild.
- The chat panel's placeholder message must update when `state.view` changes (real reactivity), not render once and go stale — a reasonable person would expect the panel to reflect where they actually are.
- Removing the `rail` prop from `WorkspaceShell` must not silently drop content from any existing caller — every call site is checked, not assumed empty.
- The new `builder_funnel_events` writes must never throw past the UI action they're attached to (e.g. a ZeroDB outage must not block a founder from submitting their idea) — same honest, best-effort pattern as every other telemetry/alerting call added this session.

## Global Constraints (carried into the plan)

- TDD: RED test first, watched failing, then GREEN, never skip.
- `npx tsc --noEmit` clean.
- Full `npx vitest run` green except the known pre-existing `task-splitter.test.ts` flake (CPU-contention/vi.spyOn module-caching race, confirmed harmless across many PRs this session).
- One GitHub issue per story before any code.
- Real PR per story, real CI, real Railway deploy verification via `/api/health` SHA match.
- Genuine human-style verification for anything user-facing before calling a story done — for layout/visual changes this means a real Chrome-driven look at the rendered workspace, not just passing unit tests.
- No jargon in new user-facing copy (the epic's own design principle, inherited project-wide): the chat panel's placeholder text and any new labels must read in plain language.
