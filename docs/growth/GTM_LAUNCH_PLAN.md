# Builder GTM Launch Plan — SEO · AEO · Paid Media

**Date:** 2026-08-24 · **Owner:** growth · **Launch:** this week
**Companion data:** `SEO_PAID_BRIEF_2026-08-24.md` (raw DataForSEO analysis), `META_ADS_MCP_SETUP.md`

This is the operational plan. It turns the Polsia gap analysis into a launch-ready checklist across three pillars, with dependencies and owners called out. **AEO is treated as a distinct pillar from SEO** (optimizing to be the answer an LLM gives, vs. ranking a blue link).

---

## 0. Strategic frame (one paragraph)
Polsia has **no organic moat** — 92% of its traffic is its own brand name, 76 organic keywords total, and it's LLM-invisible (no llms.txt/robots.txt, CSR shell). The "AI builds/runs your company" category is unclaimed in both search and AI-answer engines. Builder wins by (1) owning the category in organic + AEO where Polsia structurally can't, and (2) buying high-intent "app builder" traffic that our existing AINative-coding-tool campaigns don't cover. Every paid click lands on proof — a real app generating live at `/build` — not a marketing shell.

---

## 1. SEO pillar

**State:** Strong analysis; pages not yet built. Builder domain currently ranks for **0 organic keywords** (greenfield).

### This week (quick wins — KD 6–21, near-zero competition)
| Page | Target kw | Vol | KD | CPC |
|---|---|---|---|---|
| `/best/vibe-coding-tools` | best vibe coding tools | 1,900 | **6** | $17 |
| `/compare/lovable` | lovable ai app builder | 2,400 | **13** | $10 |
| `/best/ai-app-builder` | best ai app builder | 1,300 | **20** | $29 |
| `/compare/replit` | replit ai app builder | 2,400 | 27 | $14 |
| `/compare/bolt`, `/compare/base44`, `/compare/bubble` | "{x} alternative" | — | low | — |

Extend the existing `/compare/polsia` pattern. Each page: real SSR content, honest comparison table, embedded live `/build` demo, FAQPage + SoftwareApplication JSON-LD, added to sitemap.

### Weeks 2–6 (own the category)
Category hubs: `/ai-app-builder` (KD30), `/ai-website-builder` (KD40), `/ai-agent-builder`, `/vibe-coding` (110k vol explainer). Interlink hubs → comparison pages → `/build`.

**Owner:** eng (page build) + growth (copy/keywords). **Dependency:** none — can start now.

---

## 2. AEO pillar (Agent/Answer Engine Optimization) — *distinct from SEO*

**Why separate:** SEO ranks links for humans; AEO makes Builder the answer LLMs (Claude, ChatGPT, Perplexity, Google AI Overviews) return. 82% of B2B software buyers sourced vendor recs from an AI chatbot in the last 24 months (G2 2026). This is our structural moat — Polsia is LLM-invisible.

**Grounded in the Claude AEO Playbook** (Searchable, 90k AI sources, Jul 2026 — `~/Desktop/claude-aeo-playbook.pdf`). Its 7 findings reshape our approach:
1. **Question-type split:** Claude *looks up* "best X 2026 / cheapest X / X vs Y / X pricing / X reviews / is X legit" (winnable with pages) vs *pre-decides* "how to pick X / is X worth it" (can't win with pages). Split our target questions accordingly before spending.
2. **Claude reads Brave (63%), not Google (34%).** Must be in Brave's index, not just Google.
3. **Top-10 is the whole game;** position within it barely matters. Chase keywords ranking 11–30, don't polish 7→3.
4. **PR → editorial/press + smaller comparison blogs, not aggregators.** Press ≈ 2.7× more valuable on Claude than ChatGPT. No single site holds >9% of mentions — open field, a small site can win.
5. **Owned content works ~half as well on Claude (31.6%) as ChatGPT (60.9%).** Keep publishing; put NEW budget into third-party placement.
6. **Claude forms a brand shortlist BEFORE searching; 86% of pre-decided brands reach the final answer.** If Claude doesn't name Builder unprompted, pages won't save us — must get mentioned elsewhere. Measure "mentions out of 50."
7. Local → business listings (N/A for Builder, a web product).

**FOCUS (per Toby, 2026-08-24): target the keywords + subjects that drive traffic to Polsia — capture their demand, don't chase a generic category.** Polsia's actual winnable traffic terms (from DataForSEO) are overwhelmingly brand-conquest, which is exactly Play 1's "Claude looks it up" set:

| Polsia traffic term | Vol | Polsia pos | Our play |
|---|---|---|---|
| polsia ai | 1,900 | 1 | conquest page + Claude mentions |
| is polsia legit | 170 | 17 | `/compare/polsia` answers this directly |
| polsia com reviews / polsia ai reviews | 210 | 9–15 | review-style content + G2/review-site presence |
| polsia pricing / polsia cost | 120 | 2 | pricing-comparison section |
| polsia alternative | (conquest) | — | dedicated `/compare/polsia` + "alternative" framing |

**State:** Infrastructure LIVE (llms.txt/agents.txt/robots.txt all 200; JSON-LD on /build; Builder domain IS in Brave index). Gap = not present for category/conquest queries; no off-site mention strategy; no LLM-mention tracking.

### This week
1. **Answer-shaped, Polsia-conquest content:** `/compare/polsia` (and lovable/replit/bolt) written as direct answers — one-sentence answer → comparison table → FAQ. Explicitly answer "is polsia legit", "polsia pricing", "polsia alternative". LLMs lift these verbatim.
2. **Brave index (Play 2):** submit key pages at search.brave.com/submit-url; confirm robots doesn't block Brave; keep sitemap current.
3. **Off-site mentions (Plays 4 & 6):** the real AEO lever. Get Builder mentioned on review sites (G2, Product Hunt), smaller comparison blogs, and press — this is what puts Builder in Claude's pre-search shortlist. NEW budget goes here, not just more pages.
4. **FAQPage JSON-LD** on every new page; Organization + Product schema on homepage.
5. **Track it (Play 6):** baseline "mentions out of 50" — 10 buyer questions × 5 runs — count how often Claude names Builder vs Polsia vs Lovable/Replit. Re-measure monthly. Also dfs-mcp `ai_optimization/llm_responses` for automated tracking.

**Owner:** growth (mentions/tracking) + eng (pages/schema). **Dependency:** pages ride on §1; off-site mentions are independent and the highest-leverage new work.

---

## 3. Paid media pillar

**Critical context (verified 2026-08-24):** the **AINative Studio Google Ads account (cust 8069645986) is already active with 16 campaigns**, several enabled — Brand Protection, Competitor Alternatives, Cody CLI, OpenCode/Blackbox Conquest, ZeroDB, TechWeek. These target the **AI-coding-tool** angle (cursor/windsurf/copilot alternatives, CLI). **They do NOT cover Builder's "app builder" category, and Builder's brand is undefended.** So new Builder paid = additive, not overlapping.

### Google Ads — draft PAUSED this week (no blockers)
New campaign **"Builder — App Builder"** (SEARCH, MAXIMIZE_CONVERSIONS, PAUSED), 3 ad groups:
1. **Brand-defense (Builder):** `ainative builder`, `ai native builder` — undefended today. Cheap, protects converting traffic. *(Coordinate with existing Brand Protection campaign to avoid self-competition; consider adding these keywords there instead — decision in draft.)*
2. **Category exact-match:** `ai app builder` [$36], `ai website builder` [$29], `ai powered app builder` [$44], `no code app builder` [$32], `ai agent builder` [$32]. Exact/phrase, tight negatives.
3. **Conquesting:** `polsia alternative` (~$5, undefended by Polsia), `lovable alternative`, `bolt alternative`, `base44 alternative` → land on matching `/compare/*` page.

**Negatives:** exclude `free` (unless trial-volume play), `jobs`, `course`, `tutorial`, `salary`, existing-product terms already covered (cursor/copilot handled by Competitor Alternatives — negative them here to avoid cannibalizing).
**Landing:** `/build` (product-led) or the relevant comparison page — NOT homepage.
**Budget:** start $50–70/day at these CPCs (~160–330 clicks/wk); read CVR before scaling.
**Owner:** growth. **Dependency:** none — draftable now via gads MCP.

### Meta Ads — draft PAUSED this week (2 blockers before it can SERVE)
Mirror Polsia's proven channel. Campaign structure + audiences + creative brief can be built now, but **cannot spend** until:
- ❌ **Payment method** attached to `act_1054115077255761` (currently none) — *Toby, Ads Manager billing*
- ❌ **Facebook Page** created + assigned to the `ainative-mcp` system user (ads require a page) — *Toby*

Once unblocked: OUTCOME_TRAFFIC (or LEADS) campaign, adsets by interest (`startups`, `no-code`, `web development`, `SaaS`) + lookalike later, geo US-first. **Creative angle Polsia can't run:** short screen-capture of `/build` generating a real app live — "Watch your app build itself, then own the code." (Polsia runs static B&W brand ads.)
**Owner:** growth (build) + Toby (unblock). **Dependency:** payment + page.

### Measurement (both channels)
Wire to the existing gclid→paid-conversion pipeline (`signup_source:builder`, core#6469) so ROAS is comparable Google-vs-Meta from day one. GA4 `ga4_conversions_by_campaign` for the read-out.

---

## 4. This-week checklist (dependency-ordered)

| # | Task | Owner | Blocker | Status |
|---|---|---|---|---|
| 1 | Ship KD 6–21 SEO/AEO pages (comparison + best) | eng+growth | none | ✅ built+committed (9d43848), deploying |
| 2 | FAQPage JSON-LD + answer-shaped copy on each | eng | rides #1 | ✅ verified in rendered HTML |
| 3 | Draft Google "Builder — App Builder" campaign (PAUSED) | growth | none | ✅ done (camp 24170486322) |
| 4 | Draft Meta campaign (PAUSED) | growth | none (to draft) | ✅ done (camp 120250720408120749) |
| 3b | gclid/UTM attribution | eng | none | ✅ NOT broken (audit was wrong; verified at build-context.tsx:109) |
| 3c | Add Meta pixel + CAPI (absent) | eng | rides #3b | ✅ built (gated no-op until env set) |
| 3d | fix /best/* middleware allowlist (was 307→/login) | eng | none | ✅ fixed (a02038a), deploying |
| 5 | **Attach payment method to Meta ad account** | **Toby** | — | ⬜ |
| 6 | **Create + assign FB Page to system user** (unblocks Meta creative) | **Toby** | — | ⬜ |
| 7 | Regenerate Meta token (it was exposed in chat) | Toby | — | ⬜ |
| 7b | **Submit new pages to Brave** (search.brave.com/submit-url — manual, CAPTCHA) | Toby | rides #1 | ⬜ |
| 8 | Review + enable Google campaign | Toby | #3, #3b deployed | ⬜ |
| 9 | Enable Meta campaign | growth | #4,5,6 | ⬜ |
| 10 | Baseline LLM-mention share (Builder vs Polsia/Lovable) | growth | dfs-mcp | ⬜ |

---

## 5. Tooling readiness (all verified 2026-08-24)
- ✅ **Google Ads MCP** (`ainative-gtm-mcp`) — connected to AINative Studio, full campaign control.
- ✅ **Meta Ads MCP** (`meta-ads-mcp`) — connected to `act_1054115077255761`, write verified (created+deleted a test campaign). Global across Claude Code/Desktop/Cursor. **Can't spend until payment+page.**
- ✅ **DataForSEO MCP** (`dfs-mcp` v3.0.1) — SEO/AEO research, global across clients.
- 📋 Core issue #6569 — add both to the AINative cloud MCP catalog.
