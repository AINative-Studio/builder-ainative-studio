# AINative Builder — Improvement Plan (design + functionality)

Grounded in a live Playwright audit of the actual product (not screenshots):
pages were driven like a real user — every button clicked, inputs typed, forms
submitted, network watched — plus code inspection of the generated apps.

## TL;DR — the #1 issue is functionality, not looks

The apps **render beautifully but don't work**. Generated UIs are static mockups:
buttons do nothing, inputs don't accept/filter, forms don't submit, and **nothing
persists** — the AINative primitives (ZeroDB `/api/db`, agent framework) are
almost entirely unused. Fixing this is worth more than any visual polish.

---

## A. FUNCTIONALITY (the priority) — tracked in #132

### A1. Generated apps are static mockups [P0]
Live interaction results:
- **Kanban board: 0 / 17 buttons do anything.** "New Task", "Search", "Filter",
  column "+" — all dead. It's a picture of a task board.
- Analytics dashboard: ~0/12 interactive. Music player: 2/12 (the best case).

Code evidence (handlers in the generated source):
| app | onClick | onChange | setState | forms | /api/db |
|---|---|---|---|---|---|
| kanban | 0 | 0 | 0 | 0 | 0 |
| analytics | 1 | 0 | 1 | 0 | 0 |
| pricing | 2 | 0 | 2 | 0 | 0 |
| ecommerce | 5 | 0 | 4 | 0 | 0 |
| music | 10 | 0 | 17 | 1 | 0 |

**`onChange = 0` and `/api/db = 0` in EVERY app.** No working inputs, no
persistence, anywhere.

**Fix:**
1. **Prompt (enforce interactivity):** every actionable button MUST wire an
   onClick that mutates state; every "add/new/create" MUST implement the full
   add flow (input → setState → append to list); every search/filter input MUST
   have onChange that filters the rendered collection; tabs/toggles MUST switch
   state. Add 2-3 worked examples (a working "add todo", a working search filter)
   the model copies — the same technique that fixed the ZeroDB-vs-localStorage
   determinism earlier worked because it gave a concrete pattern.
2. **Post-gen interactivity gate:** count handlers vs controls. If a data app has
   0 onChange / 0 onClick / 0 `/api/db`, treat as low quality → retry with a
   stronger "make it functional" instruction (mirror the validation-retry loop).
3. **RLHF:** score functional completeness, not just render success.

### A2. Primitives are unused [P0] — the core differentiator, wasted
Despite ZeroDB being available and in the prompt, **0 `/api/db` calls** in any
sampled app. "Save to a database" prompts produce in-memory arrays that vanish
on refresh. The whole AINative pitch (agent-native, persistent, primitives) is
invisible in the output.
- **Fix:** hard-require `/api/db` for any app with add/edit/save semantics (gate
  A2 into the interactivity check); surface a "this app persists to ZeroDB" badge
  when it actually does, to make the primitive visible.
- Extend to the richer primitives (ZeroMemory, agent framework, real streaming)
  — the `@ainative/ai-kit` package has real StreamingMessage/AgentResponse
  components (see REAL_AIKIT_COMPONENTS.md) that would make agent/chat apps
  genuinely functional instead of static.

### A3. Broken historical previews [P1]
~4 of 5 user-sampled old previews have **unparseable generated code** (missing
operators, stray tokens) — pre-dating this session's autoFix improvements. No
renderer can display unparseable code.
- **Fix:** (a) add a **"Regenerate" action** on any preview that fails to
  parse/render (detect → one-click regen through the current pipeline);
  (b) a **backfill script** that scans persisted generations, flags unparseable
  ones, and regenerates them. (Renderer-side stale-HTML + errorRecovery + lenient
  gate already shipped this session: #129/#130/#131.)

### A4. Auth-gated zone is invisible/confusing [P2]
`/templates`, `/deployments`, `/chats`, `/insights` all 307-redirect to `/login`.
A logged-out user clicking these bounces to login with no explanation.
- **Fix:** either gate the nav links behind auth (don't show what you can't use),
  or show a "sign in to access" state instead of a bare redirect.

---

## B. DESIGN / UX

### B1. Landing page (looks clean, but thin) [P2]
- Lots of empty space; no "how it works", no example gallery, no social proof
  above the fold. The preset chips overflow-clip on the right ("E…→").
- Header is nearly empty for logged-out users (only the logo links anywhere) —
  no visible path to Showcase/Templates/Pricing.
- **Fix:** add a compact "3 steps" or live example strip under the hero; make the
  preset chips wrap or scroll cleanly; add real header nav (Showcase, Templates,
  Sign in).

### B2. Showcase (the strong point) [keep]
Polished: real thumbnails render (post-regeneration), category tags, good grid,
"Build Your Own" CTA. This is the best-looking surface — but note the detail
pages inherit A1 (the previewed apps are non-interactive).

### B3. Generation UX (works well) [minor]
Prompt → submit → stream is smooth: **first feedback in ~2s**, completes ~29s,
0 JS errors. Good. Minor: the preview sometimes shows "Refining your app" or a
blank while Sandpack boots — a skeleton/progress state would read better than a
sudden blank.

---

## C. RENDERER RELIABILITY (mostly fixed this session — for context)
Shipped: method-chain corruption (#107), component-object-as-child (#108/#117),
recharts scope (#115), ErrorBoundary scope (#124/#125), **React-hooks-on-window
+ the newline-that-broke-the-setup-script (the real blank-preview root cause,
#126/#127)**, shadcn wrong-subpath imports (#118), iframe allow-forms (#120),
stale-SSR re-render + Babel errorRecovery + lenient gate (#129/#130/#131),
regenerated all 11 seed snapshots (#128). Fresh generations now render cleanly.

---

## Prioritized roadmap
1. **#132 A1/A2 — make generated apps functional + use ZeroDB** (biggest lever;
   prompt enforcement + interactivity gate + retry). This is what turns "pretty
   mockup" into "real app" and finally showcases the primitives.
2. **A3 — Regenerate action + backfill** the broken/static historical previews.
3. **B1 — landing polish + real nav.**
4. **A4 — auth-gating UX.**
5. **Deepen primitive usage** via real @ainative/ai-kit components (streaming,
   agents) for the agent/chat categories.
