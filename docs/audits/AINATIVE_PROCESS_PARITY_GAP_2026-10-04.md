# AINative Process Parity Gap — Builder's Autonomous Loop vs. `.ainative/` Standards

**Date:** 2026-10-04
**Scope:** Whether Builder's autonomous dev loop (the thing that's supposed to work a founder's backlog nightly, unattended) actually implements AINative's own internal engineering standards (`.ainative/RULES.MD`, `.ainative/ISSUE_TRACKING_ENFORCEMENT.md`) — TDD/BDD, Fibonacci story-point sizing, mandatory issue tracking — applied to each generated company/project as its own "virtual AINative engineering org."

**Why this doc exists:** the founder asked, directly, whether a company's PRD is actually decomposed into a real, sized, prioritized backlog of epics/issues the way AINative's own engineering process requires internally — and whether that backlog is what free/paid-tier founders' nightly loop actually works through. It is not. This doc records what was verified, where, and what's missing, before splitting the gap into real, Fibonacci-sized GitHub issues (per the standard this doc is itself about enforcing).

---

## 1. What `.ainative/` actually requires (source of truth)

Read in full for this investigation: `.ainative/RULES.MD`, `.ainative/ISSUE_TRACKING_ENFORCEMENT.md`, `.ainative/CODY.md`. Older files (`AGENT_PERSONAS_TEST.md`, `INFRASTRUCTURE.md`, etc., dated Mar 31) describe a different repo's file paths (`/Users/tobymorning/Desktop/core/...`) and are not reliable for this repo's structure — the *principles* below are extracted from the parts that are standard, not path-specific.

- **Fibonacci story points: 0, 1, 2, 3, 5, 8.** Stories sized 3/5/8 must be **split into smaller stories first**, not implemented as one giant unit. (`RULES.MD` §2)
- **TDD/BDD mandatory, 80%+ coverage, tests must actually be run and their real output shown** before any claim of "passing" or "done." (`RULES.MD` §4)
- **Every unit of work requires a GitHub issue before code is written** — bug, feature, refactor, test, docs, devops, all of it. Branch name encodes the issue (`[type]/[issue-number]-[slug]`), every commit references it (`Refs #N`/`Closes #N`), every PR links it. "No Code Without An Issue. No PR Without A Link. No Merge Without Tracking." (`ISSUE_TRACKING_ENFORCEMENT.md`, the Golden Rule)
- **Issue template requires an estimate with rationale**, a testing plan, and measurable acceptance criteria — not free-text vibes.
- **CI gates:** install → lint/format → typecheck → unit → integration → (e2e) → package; merge only if green. (`RULES.MD` §5)
- **No AI attribution**, ever, in any commit/PR/issue on any AINative repo — including, per `CODY.md`'s activation rule, any repo Cody operates in. (`RULES.MD` §6, `CODY.md` Rule 1)

This is AINative's real internal engineering discipline. The founder's ask: **Builder's autonomous loop should be a virtual implementation of this same discipline, applied to each generated company's own repo** — not a separate, lesser process just because the "developer" is an unattended nightly agent instead of a human.

---

## 2. Prior history on this exact question (closed issues + memory, checked before writing this doc)

This gap was partially investigated and PARTIALLY, DELIBERATELY decided before. Checked closed issues + session memory so this doc doesn't re-litigate settled ground or miss a real fix that already shipped:

- **Issue #367** ("PRD and backlog artifacts are one-shot display text — never drive real execution," closed 2026-09-01): raised the exact PRD-as-dead-end-artifact question. **Closed by an explicit product decision**, recorded in its own closing comment: *"PRD/backlog artifacts stay intentionally display-only. Real execution was deliberately built on a separate, already-shipped path instead"* (`build_tasks` + epic #371's coverage-gated resolver). One acknowledged, never-filed residual gap: `components/build/artifacts/Swarm.tsx` sends only the raw idea string to swarm dispatch, never the generated backlog artifact's actual content.
- **Issue #670** ("Backlog shown to founders never becomes real tracked work," closed 2026-09-12, no closing comment): raised the *other* "backlog" — `/api/build/backlog`'s primitive-provisioning checklist telling founders items are "actively queued for the next nightly loop" when nothing was. **Verified this session: this WAS genuinely fixed**, just closed without a comment recording it. `app/api/build/backlog/route.ts:111-124` now calls `createTask()` for every `queued` item once a founder is on a paid plan + has a domain (the same gate the message claims), idempotent against re-asking. This part of the gap is real and closed — not open.
- **Issue #532** ("No planning artifact is ever read back into real code generation," closed with no comment): a broader, still-apparently-unresolved finding that NONE of the 12-13 planning artifacts (prd, dataModel, memoryPolicy, codingStandards, backlog, sprintPlan, etc.) feed the actual MVP code-generation prompt — codegen re-derives everything from the raw idea string independently. Filed as "needs a product decision," closed without one being recorded. Still appears accurate; not re-verified line-by-line in this pass since it's adjacent to, not the direct subject of, the Fibonacci/issue-tracking question this doc is about — flagged here so it isn't lost, and left as its own concern rather than folded into the backlog split below.
- **Memory (`project_builder_backlog_fleet.md`, 40 days old):** confirms real prior process discipline WAS applied at scale once — the #44-84 Polsia-parity backlog was shipped with ≥80% coverage (eventually 98%/87%), real issue-closing discipline, and a real deploy→Playwright-verify loop. That memory also flagged `vitest.config has NO enforced threshold` as a gap. **Verified this session: this is now fixed** — `vitest.config.ts`'s `coverage.thresholds` (`statements/branches/functions/lines: 80`) is live today, scoped to `lib/build`/`lib/growth`/`lib/help`, matching `RULES.MD`'s 80% requirement exactly.

**Net correction to this doc's own findings below:** the real remaining gap is narrower than "nothing is connected to anything." The provisioning-checklist backlog (#670) and the CI coverage floor are both genuinely fixed. What remains genuinely unaddressed — confirmed fresh this session, not previously decided or fixed — is: the PRD's actual **product features** (`prd.features`, P0/P1/P2) never become sized, tracked, issue-linked work; no Fibonacci sizing concept exists anywhere; no per-company GitHub/Gitea issue is ever opened before a task is implemented; and nightly backlog throughput has no plan-tier awareness. Sections 3a-3g below are corrected to reflect this.

---

## 3. What Builder actually does today (verified this session, direct code read + live production checks)

### 3a. The PRD's real feature list is, BY DECISION (#367), not wired to execution — but the residual gap that decision left open is still open

`lib/build/artifact-prompts.ts`'s `prd` artifact IS real and reasonably well-shaped:
```
features: [{ name, desc, priority: "P0"|"P1"|"P2" }]  // 4-6 of them
acceptance: [str]                                      // 3 acceptance criteria for v1
```
This is generated once per company and shown to the founder as a readable document. Per #367's recorded decision, this is **intentional** — real execution runs on the separate `build_tasks` primitive instead, not on parsing the PRD artifact's text back out. What #367 flagged as a residual gap, and what's confirmed still true this session, is narrower: `prd.features`' own P0/P1/P2 priority never informs *anything* `build_tasks` does — not the nightly seed (today's generic "ship the highest-leverage thing" prose, #898/#899), not the interactive chat flow, not Swarm.tsx. A founder's PRD can say feature X is P0 and feature Y is P2, and nothing downstream knows or cares.

### 3b. `build_tasks` (the real backlog primitive) is disconnected from the PRD's feature list

`lib/build/task-store.ts`'s `build_tasks` ZeroDB table is a genuinely well-built primitive: six real lifecycle stages (`todo/recurring/in_progress/completed/rejected/failed`), a `source` field (`cody/swarm/recurring`), a working `createTask`/`listTasks`/`updateTask` API. But every real task in production (10 rows total, system-wide, confirmed via direct ZeroDB query on 2026-10-04) came from **the founder's own live chat request** (`source: 'cody'`), not from the PRD. Before today's fix (issue #898, PR #899), the nightly loop created **zero** tasks of any kind — `tasksAttempted: 0` on every run for weeks, across all 77 enrolled companies.

### 3c. No Fibonacci / story-point sizing exists anywhere in the product

Repo-wide search for `fibonacci`/`story point`/`storyPoint` in `lib/`, `app/` returns zero real hits (a few substring false-positives like `fontSize` only). The concept that `.ainative/RULES.MD` mandates for AINative's own engineering — size the work, split anything over 3 points — has never been implemented as something Cody applies to a *founder's* backlog. A generated task today is an unsized blob of prose (`buildTaskDescription()`'s output: one paragraph, "ship the single highest-leverage improvement tonight") — there's no mechanism to tell a 1-point typo fix from an 8-point rewrite, and nothing ever splits the latter.

### 3d. `/api/build/backlog` is misleadingly named — it's a provisioning checklist, not a product backlog

`app/api/build/backlog/route.ts` returns `built`/`queued`/`blocked` items, but these are **primitive-provisioning steps** ("ZeroDB wired," "auth built," "ZeroVoice queued — needs subscription") derived from `selectPrimitives()`, not product features from the PRD. This is a real, useful thing (it's what Cody cites when a founder asks "what's next"), and — per #670's fix, confirmed live this session — its `queued` items DO now create real `build_tasks` rows once a founder is paid + has a domain. It is still not the same thing as the PRD's own product-feature backlog, and conflating the two names has likely been a source of confusion, but this specific route is not a gap anymore.

### 3e. No per-company GitHub issue tracking exists at all

`.ainative/ISSUE_TRACKING_ENFORCEMENT.md`'s entire model — an issue per unit of work, in GitHub, with labels/estimate/branch/PR linkage — has **zero equivalent** for a generated company's own repo (the per-company Gitea repo provisioned via `lib/git/company-repo.ts`). `lib/git/task-git-sync.ts`'s `commitTaskWithPR` opens a real PR per resolved task (confirmed working, real merged PRs exist), but:
  - There is no GitHub/Gitea **issue** opened first — the task goes straight from `build_tasks` row to implementation to PR, skipping the "issue first" step entirely.
  - No story-point label, no estimate, no rationale.
  - No `[TYPE]` prefix, no required template fields (acceptance criteria, test plan) beyond whatever free text `buildTaskDescription()` produced.
  - This is true whether the task came from a founder's live chat OR (per #899, once merged) the nightly loop's generic seed.

### 3f. No plan/credit-aware backlog throughput

`lib/build/task-resolution-loop.ts`'s `MAX_TASKS_PER_COMPANY_PER_RUN = 1` is a flat, hardcoded constant — identical for free, Starter, Pro, Business, and Enterprise tiers. `lib/build/build-credits.ts` gates the **initial idea→prototype build count** (3/free, 80/mo Starter, unlimited paid) but has no relationship whatsoever to nightly backlog-task throughput. The founder's intuition — "a free account should maybe get one issue worked per day" — isn't wrong as a *design goal*, but today it's an accident of one unrelated hardcoded constant, not a deliberate plan-tiered backlog velocity.

### 3g. TDD/coverage gate exists, but only inside the resolver — nothing upstream of it enforces story sizing or issue-first discipline

To be fair to what IS real: `lib/build/task-resolver.ts`'s `resolveTask()` pipeline is genuinely solid — implement → commit to Gitea → `runCoverage()` with an 80% floor (`COVERAGE_FLOOR = 80`, matching `RULES.MD`'s own 80% requirement) → auto-merge only on a real, verified pass → auto-deploy. This is the one piece of `.ainative/` discipline that Builder's autonomous loop DOES faithfully implement today, for whatever single task happens to reach it. The gap is entirely upstream: nothing decides *what* that task should be in a sized, prioritized, issue-tracked way before handing it to this otherwise-correct pipeline.

---

## 5. Summary table

| `.ainative/` standard | Exists for AINative's own eng (this repo)? | Exists for a generated company's backlog? |
|---|---|---|
| PRD → epics/features decomposition | N/A (humans write PRDs) | **No** — PRD `features[]`/priority never read programmatically (by decision, #367; residual priority-wiring gap still open) |
| Provisioning checklist → real tracked work | N/A | **Fixed** (#670) — `/api/build/backlog`'s queued items create real `build_tasks` rows when paid+domain |
| Fibonacci sizing (0,1,2,3,5,8), split >3 | Yes (RULES.MD §2) | **No** — zero sizing concept anywhere |
| Issue-per-unit-of-work, labels, template | Yes (ISSUE_TRACKING_ENFORCEMENT.md) | **No** — tasks skip straight to PR, no issue |
| Branch/commit/PR issue linkage | Yes | Partial — PR exists (task-git-sync.ts), no issue to link to |
| TDD/BDD + 80% coverage gate | Yes — `vitest.config.ts` thresholds (statements/branches/functions/lines: 80), confirmed live | **Yes** — task-resolver.ts's COVERAGE_FLOOR=80, real and verified (the one piece already at parity) |
| CI gate before merge | Yes (repo's own `npx vitest run` + `npx tsc --noEmit`) | Partial — coverage gate yes, no lint/typecheck step confirmed in the per-company resolver pipeline |
| Plan-tier-aware throughput | N/A | **No** — hardcoded `MAX_TASKS_PER_COMPANY_PER_RUN = 1` for every tier |
| Planning artifacts inform codegen at all | N/A | **No** (separate, broader finding — #532, closed without a decision; not re-verified line-by-line this pass, flagged not fixed) |
| No AI attribution | Yes, enforced by git hook (this repo) | Unverified — not checked whether generated companies' Gitea commits are scanned the same way |

---

## 6. What this doc does NOT do

This doc records the gap. It does not propose or pre-commit to a specific implementation — that's deliberately left to the Fibonacci-sized issue breakdown (next step, tracked on GitHub, linked from here once filed) so each piece gets its own right-sized story, sub-3-point stories implemented directly and anything larger split further, per the same standard being enforced.

---

## 7. Context-load checklist (why this doc did a history pass before concluding anything)

Section 2 above exists because the first draft of this investigation (this session, same day) nearly mis-reported two things as open gaps that were already fixed — #670's backlog-to-task wiring, and the vitest coverage threshold — simply because neither closed issue had a closing comment recording the fix, and the fix post-dated the memory file that flagged it as missing. That's a real, repeatable failure mode for any agent (human-directed or autonomous) picking up a "is X wired up" question in this codebase. Before concluding a capability is missing — here, or in any future investigation of this kind — check, in this order:

1. **Closed issues**, searched by keyword (`gh issue list --state closed --search "<topic>"`), not just open ones — a "gap" may already have a recorded decision or a silent fix.
2. **Session memory** (`~/.claude/projects/.../memory/`) for the same topic — but treat every claim in it as point-in-time, and re-verify against current code before repeating it (memories in this project are explicitly marked with their own age and this caveat).
3. **The actual current code**, last — because both of the above can be stale, and only the code is ground truth for "does this exist right now."

This is the same discipline `.ainative/ISSUE_TRACKING_ENFORCEMENT.md` §2 already requires before starting ANY work ("Search for existing issue... before writing ANY code") — it just hadn't been written down as applying to investigation/gap-analysis work specifically, not only to implementation work. Worth keeping as a standing step (e.g. a short checklist in `CLAUDE.md` or a loaded skill) rather than something each investigation has to rediscover.
