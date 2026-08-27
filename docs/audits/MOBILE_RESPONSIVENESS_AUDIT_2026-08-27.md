# Mobile Responsiveness Audit — 2026-08-27

**Target:** https://builder.ainative.studio (production)
**Viewports:** iPhone SE (375x667), iPhone 14 (390x844), Chromium mobile emulation (touch, mobile UA)
**Method:** Playwright dynamic audit (horizontal overflow, per-element bounding rects, tap-target heights, computed font sizes, full-page screenshots) + static audit of `app/modernist.css` and screen components. Screenshots + raw JSON in the session scratchpad (`mobile-<screen>-<viewport>.png`, `mobile-audit-results.json`).

> **Measurement note (important):** Chromium mobile emulation "shrinks to fit" — when content is wider than the device, `window.innerWidth` and the layout viewport silently expand to `scrollWidth`, so a naive `scrollWidth > innerWidth` check reports 0 overflow. True overflow below is computed as **layout-viewport width minus device width**. Prod serves `<meta name="viewport" content="width=device-width, initial-scale=1"/>`, so on a real iPhone this overflow renders as clipping/panning — exactly the broken login screenshot the user reported.

---

## Executive summary (worst first)

| # | Screen(s) | Severity | Measured | Root cause |
|---|-----------|----------|----------|------------|
| 1 | `?screen=login`, `?screen=signup` | **P0** | content min-width **516px** at 375px device (**+141px**, +38%) | `.m-auth { grid-template-columns: 1fr 1fr }` (modernist.css:983) never collapses; `1fr` tracks bottom out at min-content (brand 253px + form 263px) |
| 2 | `?screen=pricing` (in-app tiers / launch gate) | **P0** | content min-width **513px** at 375px (**+138px**) | `.m-tiers { grid-template-columns: repeat(3, 1fr) }` (748) never stacks; plus `.m-pricing` fixed `padding: 56px 44px` (733) |
| 3 | Workspace / Live (logged-in, static finding) | **P0 (latent)** | n/a (auth-gated; verified statically) | `.m-ws-body` `34% 1fr auto` (199) and `.m-live-grid` `1fr 1.2fr 1fr` (815) only collapse via `.is-tablet` — and `SET_TABLET` (lib/build/state.ts:185) is **never dispatched anywhere**, so the collapse is dead code |
| 4 | `?screen=companies` (and `.m-account` screens) | **P1** | content min-width **423px** at 375px (**+48px**) | `.m-account-head` flex row (back + h1 + "+ New company" + account chip) can't wrap inside `.m-account { padding: 40px 44px }` (997) |
| 5 | `?screen=fork` | **P1** | no overflow; cards squeezed to **148px** wide each | `.m-fork-cards { grid-template-columns: 1fr 1fr }` (228) never stacks; `.m-fork` 44px side padding leaves 287px for two cards |
| 6 | `?screen=landing` beat 2 | **P1** | no overflow; columns squeezed to **146.25px** each | inline `style={{ gridTemplateColumns: '1fr 1fr' }}` in `components/build/screens/Landing.tsx:135` |
| 7 | All builder screens | **P2** | tap targets 18–39px tall throughout | `.btn-ghost` (no padding, 13px), `.m-land-signin` (20px), `.m-back` (18px), `.m-account-chip` (26px), `.m-billing-switch` buttons (31px), marketing nav links (20px) |
| 8 | All builder screens | **P2** | body text below 14px | design-system mono labels 9.5–13px: `.m-proof-label` 9.5px, `.m-field-l` 10px, `.m-chip` 10.5px, `.m-helper` 11px, footer links 12px |

**Screens that passed clean at both widths:** `?screen=start`, `?screen=build`, `?screen=intake`, `/help`, `/guides`, `/guides/how-to-build-a-saas-with-ai`, `/about`, `/pricing` (marketing). The marketing pages use Tailwind `md:` responsive classes and collapse correctly; the funnel screens (start/build/intake) are single-column with `maxWidth: 420` and behave.

Overall root cause: **`app/modernist.css` has effectively no sub-tablet strategy.** In 1,287 lines there are only three `max-width` media queries — `480px` (`.m-byo-record` only), `600px` (`.m-value-strip` only), `860px` (`.m-proposal-grid` only). The design handoff deferred sub-tablet widths and every multi-column `.m-*` layout shipped without a phone collapse.

---

## Per-screen findings

### 1. Login (`?screen=login`) — **P0, unusable**

- **Measured:** layout min-width 516px at 375px device → **141px of horizontal clipping** on a real iPhone (126px at 390). `document.scrollingElement.scrollWidth = 516`.
- **What breaks:** `.m-auth` (modernist.css:983) is `min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr` with **no media query**. At phone width the two `1fr` tracks clamp to min-content: `.m-auth-brand` resolves to 253px (driven by the 34px `.m-auth-statement` longest word + `padding: 56px 44px`) and `.m-auth-form` to 263px (input min-width + `padding: 56px 44px`). 253 + 263 = 516px. With `initial-scale=1` the brand panel and/or form clip off-screen; the "Continue with AINative" button (measured 175px wide) wraps to two lines.
- Matches the user's iPhone screenshot: brand panel clipped left, form squeezed, dead gutter right.
- **Fix:** in `modernist.css` add e.g.
  ```css
  @media (max-width: 760px) {
    .m-auth { grid-template-columns: 1fr; min-height: 0; }
    .m-auth-brand { padding: 28px 24px; }  /* or display: none / collapse to a slim banner */
    .m-auth-form { padding: 32px 24px; max-width: none; }
    .m-auth-statement { font-size: 26px; }
  }
  ```
  Single-column stack: form first (or brand as a short header band), full-width fields and buttons.

### 2. Signup (`?screen=signup`) — **P0, unusable**

- Identical to login: same `.m-auth` shell, measured **516px / +141px** at 375. "Already have an account? Log in" ghost link also wraps awkwardly in the 263px column. Same fix (shared classes — one CSS change covers both, plus the verify-email panel which reuses `m-auth`).

### 3. In-app Pricing / launch gate (`?screen=pricing`) — **P0, unusable**

- **Measured:** layout min-width **513px** at 375 (**+138px**; +123px at 390).
- **What breaks:** `.m-tiers { grid-template-columns: repeat(3, 1fr) }` (748) never stacks; each `.m-tier` clamps to min-content (measured 163/140/163px tracks) inside `.m-pricing { padding: 56px 44px; max-width: 1040px }` (733). Tier cards render ~110–160px wide with clipped feature lists and the whole page pans horizontally. The `.m-billing-switch` buttons are 31px tall (below tap minimum). Note `.m-proposal-grid` on the same screen already collapses at 860px (770) — the tiers grid is the one that was missed. This screen is the **paywall**: it is unusable at the exact moment a mobile user tries to pay.
- **Fix:** `@media (max-width: 760px) { .m-tiers { grid-template-columns: 1fr; } .m-pricing { padding: 32px 20px; } }`.

### 4. Workspace / Live dashboard — **P0 latent (static finding; auth-gated so not dynamically measured)**

- `.m-ws-body { grid-template-columns: 34% 1fr auto }` (199) and `.m-live-grid { grid-template-columns: 1fr 1.2fr 1fr }` (815) each have an `.is-tablet` single-column variant (200, 816, 830, 833) — but the flag that applies it, `state.tablet` (`lib/build/state.ts:76`, action `SET_TABLET`:185), is **never dispatched anywhere in the codebase** (grep confirms zero dispatch sites; default `false`). The responsive collapse is dead code, so a phone-width signed-in user gets the full 3-column workspace with the same min-content blowout pattern as `.m-auth`.
- **Fix (either):** dispatch `SET_TABLET` from a `matchMedia('(max-width: 900px)')` listener in `BuildApp`/`WorkspaceShell`, **or** delete the JS flag and make the collapse pure CSS: `@media (max-width: 900px) { .m-ws-body, .m-live-grid { grid-template-columns: 1fr; } .m-live-col-chat { position: static; max-height: none; order: -1; } }`. Also `.m-live-masthead` / `.m-live-funnel` fixed `padding: …44px` should drop to ~20px.

### 5. My companies (`?screen=companies`) — **P1, degraded**

- **Measured:** layout min-width **423px** at 375 (**+48px**; +33px at 390).
- **What breaks:** `.m-account-head` (998) is a no-wrap flex row: `← Back` + 28px `h1` "My companies" + `.btn-secondary` "+ New company" + `.m-account-chip` usage meter, inside `.m-account { padding: 40px 44px }` (997). Min-content sum exceeds the viewport, so the account chip/meter clips off the right edge. Signed-in state with company rows (`.m-company-row`) will be tighter still.
- **Fix:** `@media (max-width: 600px) { .m-account { padding: 24px 16px; } .m-account-head { flex-wrap: wrap; row-gap: 10px; } }`.

### 6. Fork (`?screen=fork`) — **P1, degraded**

- **Measured:** no overflow, but `.m-fork-cards { grid-template-columns: 1fr 1fr }` (228) leaves each `.m-fork-card` **148px wide** (287px content after `.m-fork`'s 44px side padding, line 213). Card copy wraps to 2–3 words per line; the two primary CTAs ("Build an App →" / "Build a Company →") wrap to two lines. Usable but visibly broken-looking for the **front door** of the product.
- **Fix:** `@media (max-width: 700px) { .m-fork-cards { grid-template-columns: 1fr; } .m-fork, .m-intake { padding-inline: 20px; padding-block: 32px; } }`.

### 7. Landing (`?screen=landing`, all 4 beats) — **P1, degraded (beat 2 only)**

- Beats 1, 3, 4 render correctly at 375/390 (verified with per-beat viewport screenshots; no overflow).
- **Beat 2** ("Builder is your team") uses inline `style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', … }}` in `components/build/screens/Landing.tsx:135` — measured tracks **146.25px + 146.25px**. The text column wraps hard and the 64vh photo is a 146px-wide sliver. No CSS class to patch; the inline style needs a responsive treatment.
- **Fix:** move the beat-2 grid to a `.m-land-beat-cols` class with `@media (max-width: 700px) { grid-template-columns: 1fr; }` (hide or shrink the photo on phones), or make the inline style conditional on a `matchMedia` hook.

### 8. Start (`?screen=start`) / Build (`?screen=build`) / Intake (via fork click) — **pass**

- Single-column, `maxWidth: 420` center column, full-width option cards and CTAs. No overflow at either width; screenshots clean. Only P2 nits: `.m-back`/`.m-land-signin` tap targets 18–20px; `.m-helper` 11px body text.

### 9. Help (`/help`), Guides (`/guides`, `/guides/how-to-build-a-saas-with-ai`), About (`/about`), Marketing pricing (`/pricing`) — **pass**

- All Tailwind-based with `md:` breakpoints (`grid gap-6 md:grid-cols-2`, `grid-cols-1 md:grid-cols-3`); collapse to single column correctly, no overflow at either width. P2 nits only: marketing header/nav links 20–32px tall; 12px footer/badge text.

### 10. Tap targets (cross-cutting) — **P2**

Buttons/links under the 40px height floor (44px is the iOS HIG minimum), measured at 375px:

| Element | Height | Where |
|---|---|---|
| `.m-back` "← Back" | 18px | intake, companies, account |
| footer links (`.m-land-foot a`) | 18px | landing |
| `.m-land-signin` "Sign in" / "← Back" | 20px | landing, build |
| nav links (marketing header) | 20px | help/guides/about/pricing |
| `.m-account-chip` "GU▾" | 26px | fork, companies (signed-in chrome) |
| `.m-billing-switch` Monthly/Yearly | 31px | pricing-app |
| marketing header buttons | 32px | help/guides/about/pricing |
| `.btn-ghost` links ("Forgot password?", "Create account") | 39px | login/signup |

**Fix:** give `.btn-ghost`, `.m-back`, `.m-land-signin`, `.m-account-chip` a `min-height: 44px` + padding on touch/narrow viewports (`@media (pointer: coarse)` or the same max-width query).

### 11. Small body text (cross-cutting) — **P2**

Top sub-14px occurrences (most are intentional mono-label design; flagging only where it carries real content): `.m-proof-label` 9.5px, `.m-field-l` 10px (form labels on login/signup), `.m-chip` 10.5px x11 on fork, `.m-helper` 11px x2 on intake (instructional copy), `.m-value-step-detail` 11px, tier feature `li` 13px x16 on pricing-app. Recommend a phone-width bump to >=12px for labels and >=14px for instructional copy (`.m-helper`, tier features).

---

## Static audit — `.m-*` layout classes with no `@media (max-width)` rule

Complete list of `max-width` media queries in `app/modernist.css` (1,287 lines): **480px** → `.m-byo-record` only; **600px** → `.m-value-strip` only; **860px** → `.m-proposal-grid` only. Everything else has none:

| Class (line) | Desktop layout | Phone breakpoint? | Impact at 375px |
|---|---|---|---|
| `.m-auth` (983) | grid `1fr 1fr` | **none** | P0 — 516px min-width, login/signup clip |
| `.m-auth-brand` / `.m-auth-form` (984/988) | `padding: 56px 44px` | **none** | 88px horizontal padding per column |
| `.m-tiers` (748) | grid `repeat(3, 1fr)` | **none** | P0 — 513px min-width paywall |
| `.m-pricing` (733) | `padding: 56px 44px` | **none** | compounds tiers overflow |
| `.m-ws-body` (199) | grid `34% 1fr auto` | only `.is-tablet` (200) — **flag never set** | P0 latent, signed-in workspace |
| `.m-live-grid` (815) | grid `1fr 1.2fr 1fr` | only `.is-tablet` (816) — **flag never set** | P0 latent, Live dashboard |
| `.m-fork-cards` (228) | grid `1fr 1fr` | **none** | P1 — 148px cards on the front door |
| `.m-fork`, `.m-intake` (213) | `padding-inline: max(44px, …)` | **none** | 88px of 375px lost to padding |
| `.m-account` (997) | `padding: 40px 44px`, max-width 760 | **none** | P1 — head row overflows 48px |
| `.m-account-head` (998) | flex, no wrap | **none** | P1 — clips account chip |
| `.m-landing-features` (664) | grid `repeat(3, 1fr)` | **none** | squeezed 3-col in generated-landing preview |
| `.m-live-masthead` (803) / `.m-live-funnel` (398) | `padding: …44px`, flex-wrap | **none** (wrap saves it) | degraded padding only |
| `.m-actbar` (180) | flex `padding: 8px 24px` | **none** (flex tolerates) | minor |
| `.m-breadcrumb` (194) | `overflow-x: auto` | n/a — scrolls by design | OK |
| `.m-proposal-grid` (769) | grid `1.1fr 1fr` | **860px → 1fr (770)** ✓ | OK — the one that was done right |
| `.m-land-*` beats (1150+) | absolute 100vh layers | **none** | beats 1/3/4 OK; beat 2 broken by inline style |
| `Landing.tsx:135` (component) | inline `gridTemplateColumns: '1fr 1fr'` | **none** | P1 — 146px columns |
| `BuildStart.tsx` / `Start.tsx` (components) | flex column, `maxWidth: 420` | responsive by construction | OK (no `margin-left: calc(50% - 210px)` pattern found in current code) |

**Dead-code finding:** `SET_TABLET` action exists (`lib/build/state.ts:185`, reducer :349, default `tablet: false` :136) and gates `.is-tablet` on `WorkspaceShell.tsx:154` and `Live.tsx:541`, but no `dispatch({ type: 'SET_TABLET' … })` exists anywhere in the repo — the only responsive mechanism the workspace has can never fire.

---

## Recommended fix order

1. **P0 auth collapse** (`.m-auth` + brand/form padding) — unblocks mobile login/signup, the reported break.
2. **P0 tiers stack** (`.m-tiers` + `.m-pricing` padding) — unblocks mobile payment.
3. **P0 workspace collapse** — wire `SET_TABLET` to `matchMedia` or replace with pure-CSS media queries on `.m-ws-body`/`.m-live-grid`.
4. **P1 grid stacks** — `.m-fork-cards`, Landing beat-2 inline grid, `.m-account`/`.m-account-head` wrap + padding scale-down (one shared `@media (max-width: ~700px)` block can carry all of these plus `.m-fork/.m-intake/.m-landing-features` padding/columns).
5. **P2 ergonomics** — 44px tap minimums for ghost/nav/chip controls; >=12px labels, >=14px instructional copy at phone widths.

A single "phone" breakpoint (~700–760px) added to `modernist.css` covering the classes in the static table would close every P0/P1 found. No JS changes are strictly required except the workspace `.is-tablet` wiring (or its CSS replacement) and the Landing beat-2 inline style.
