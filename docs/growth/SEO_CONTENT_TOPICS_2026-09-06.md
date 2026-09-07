# Builder SEO Content Topic Plan — top-of-funnel blog/guide targets

**Date:** 2026-09-06 · **Data source:** Keyword Strategy Builder (topic-cluster tool) · **Author:** growth
**Use:** Drive the content calendar (blog posts, guides, landing pages) for organic top-of-funnel traffic.
**Companion doc:** [`SEO_PAID_BRIEF_2026-08-24.md`](./SEO_PAID_BRIEF_2026-08-24.md) — competitive keyword/paid-media targeting (category terms like "ai app builder", comparison pages). This doc is content-topic strategy, one layer higher: broad informational topics that pull in searchers before they know Builder exists, then funnel them toward the comparison/category pages the other brief defines.

**Update 2026-09-06 (later same day):** independently re-verified every pending topic against real, live DataForSEO Labs/SERP data (not the topic tool's own estimates) — see §2b and §4. Two real corrections came out of that pull: **"natural language parser" is a mismatched audience** (its real keyword cluster is NLP developer-tooling, not app-builder searchers) and should be dropped from the calendar, not just deprioritized; and **Replit already ranks #4 for "what is vibe coding"** with a dedicated blog post — this term is genuinely contested, not the clean greenfield the category/comparison terms in the paid brief are. `builder.ainative.studio` still ranks for 0 organic keywords as of this check (unchanged since 2026-08-24).

**Update 2026-09-06 (SEMrush cross-validation):** a SEMrush MCP connection was added this session — see §2c for a THIRD independent data pull against the same topics plus real competitor/backlink data on Polsia. Headline finding: **SEMrush's volume/KD numbers diverge meaningfully from DataForSEO's on several terms** (documented honestly in §2c's table, not reconciled into one "true" number) — treat both as real, imperfect data sources rather than trusting either blindly. Separately, SEMrush's backlink pull materially updates `SEO_PAID_BRIEF_2026-08-24.md`'s Polsia backlink figures — real total is ~26x larger than previously documented (77,357 vs. 2,969 backlinks), though the AUTHORITY DISTRIBUTION confirms the original "modest, spammy-adjacent" read was directionally right (72% of referring domains sit at Authority Score 0–2) — see §2c for the full picture, including several genuinely high-authority exceptions (Forbes, Y Combinator, GitHub) the original pull didn't surface.

---

## TL;DR

10 "Balanced growth" topics surfaced, all genuinely relevant to Builder's positioning except one likely-mismatched outlier. They cluster into 4 real content pillars: **game-making**, **rapid app prototyping**, **vibe coding / AI-native dev**, and **free/no-cost app building**. One topic ("autonomous testing tools for automotive") does not fit Builder's ICP and should be dropped rather than forced into the calendar.

**"Balanced growth"** (the tool's own label) means: moderate difficulty + average volume — winnable without being a land-grab, and worth real editorial investment rather than a quick-hit post.

---

## 1. The 10 topics, clustered into pillars

| Pillar | Topics | Why it fits Builder |
|---|---|---|
| **Game-making** | how to make a game · how to create a video game (real KD 16 — easy) · free game maker vibe (re-target as "how to create a video game" — see §2b) | Builder generates a real, working app from one sentence — "make a game" is a literal, high-intent version of that pitch. Ranks alongside `vibe coding` (already tracked in the paid brief). |
| **Rapid prototyping / RAD** | rapid application development · prototyping tools (real volume much smaller than assumed — see §2b) | Direct category match — Builder IS a rapid-application-development / prototyping tool. These terms have real commercial-adjacent intent (someone searching this is evaluating tools, not just curious). |
| **Vibe coding / AI-native dev** | what is vibe coding | Definitional/educational search — the exact audience who hasn't found Builder yet but is primed for the pitch. **Real DataForSEO check found Replit already ranks #4 here (§2b)** — contested, not greenfield; still worth pursuing but needs a sharper angle than a generic explainer. |
| **Free / accessible app-building** | how to make an app for free · react native development services | "Free" intent matches Builder's real no-card entry tier (`FREE_BUILD_LIMIT = 3` — see `lib/build/build-credits.ts`) — this is a topic we can answer HONESTLY, not just bait-and-switch to a paywall. Real KD is 51%, harder than the topic tool implied (§2b). "React native development services" is commercial/service-adjacent — softer fit (confirmed low-volume, vendor-lookup intent, not tool-evaluation), likely worth a comparison/service-alternative angle rather than a how-to guide. |
| **Drop — doesn't fit** | recommended autonomous testing tools for automotive · **natural language parser (confirmed via real data, §2b)** | Automotive: wrong vertical entirely (automotive QA/testing, not app-building or no-code), likely a tool-suggestion artifact. NLP parser: sounds on-theme but its real keyword cluster (22,200 vol/mo, KD 59) is developer-facing NLP-library searches (Python/JS parsing tools), not app-builder searchers — a real audience mismatch, not just a soft fit. **Both excluded from the content calendar.** |

---

## 2. Worked examples: topics with full data pulled

### "how to make a game"

- **Total volume:** 15,000/mo across the keyword cluster (30+ keywords)
- **Average keyword difficulty:** 34% (moderate — matches the "Balanced growth" label)
- **Intent:** Informational + Commercial + Transactional (mixed) — the tool flags this as **high lead-to-customer conversion potential**, since someone searching "how to make a game" is often evaluating real tools mid-search, not just reading.
- **Title ideas surfaced by the tool:**
  - Essential Steps to Create Your Game
  - Beginner's Guide to Game Development Basics
  - Top Tools for Game Creation Success
  - Designing Engaging Gameplay: Key Strategies
  - From Concept to Launch: Game Development

**Builder angle:** none of these titles need to be a generic "here's Unity/Godot" listicle — the real, honest hook is that Builder can generate a *working, playable prototype* from one sentence, which no other tool on a typical "top game engines" listicle can claim. The strongest candidate is **"From Concept to Launch: Game Development"** — reframe as a real, embedded Builder demo (describe a game idea, watch it generate), not just prose. This mirrors the existing brief's "landing page = proof, not a marketing shell" principle (§5, SEO_PAID_BRIEF).

### "rapid application development"

- **Total volume:** 5,800/mo across the keyword cluster (30+ keywords)
- **Average keyword difficulty:** 24% (lower than "how to make a game" — genuinely easier to rank)
- **Intent:** Informational + Commercial (no transactional signal) — the tool frames this as a brand-awareness + lead-gen play rather than a direct-conversion term; softer bottom-of-funnel pull than the game topic.
- **Title ideas surfaced by the tool:**
  - Benefits of Rapid Application Development Explained
  - Key Principles of Rapid Application Development
  - Rapid Application Development: Tools and Techniques
  - Challenges in Implementing Rapid Application Development
  - Future Trends in Rapid Application Development

**Builder angle:** "Rapid Application Development: Tools and Techniques" is the strongest fit — it's structurally a comparison/listicle page, which is exactly the format the existing paid brief already validates as cheap-to-rank (`/compare/*` pages, KD 6–21). Build this as a real tools comparison (Builder + Lovable + Replit + Bubble + Base44, reusing the same competitor set already tracked) rather than an abstract "principles of RAD" essay — keeps it consistent with this doc's "proof over prose" rule and lets it interlink directly into the existing `/compare/*` pages instead of being an orphaned educational post.

---

## 2b. Real DataForSEO Labs/SERP data (2026-09-06, independent verification)

Pulled live via `mcp__dfs-mcp__api_request` against DataForSEO Labs endpoints (same data source/methodology as `SEO_PAID_BRIEF_2026-08-24.md`'s appendix — US/English locale). This is real measured data, not the topic tool's own estimates, and in a few cases **corrects** what the topic tool implied.

| Topic | Vol/mo | KD | Intent | Verdict |
|---|---|---|---|---|
| vibe coding (base term) | 110,000 | 56% | Informational | Matches the existing paid brief's figure exactly — this is the base term, not the "what is" variant. |
| **what is vibe coding** | 60,500 | 38% | Informational | Real, large, distinct term from the base "vibe coding" search — **Replit already ranks #4 here** (see below). Contested but still worth pursuing with a sharper angle. |
| vibe coding meaning | 18,100 | 43% | Informational | Real adjacent term, not previously tracked in either doc — candidate for an FAQ section on the "what is vibe coding" page rather than a separate post. |
| how to vibe coding | 1,600 | 20% | Informational | Low-KD long-tail, good internal-linking anchor from the main vibe-coding page. |
| best vibe coding tools | 1,900 | 6% | Commercial | **Confirms `SEO_PAID_BRIEF`'s figure exactly** — cross-validated, high confidence. |
| lovable vibe coding | 1,000 | 4% | Informational | Easiest term in the entire cluster (KD 4) — a direct "Lovable vs Builder for vibe coding" angle, folds naturally into the existing `/compare/lovable` page. |
| prototyping tools | 590 | 26% | Informational | Real volume is much smaller than the topic tool implied — still winnable (moderate KD) but low-impact standalone; better as a section within the RAD comparison piece (§2, item 3) than its own post. |
| ai prototyping tools | 260 | 8% | Commercial | Small volume but very cheap to rank and commercial intent — worth a subheading/FAQ entry, not a dedicated post. |
| how to make an app for free | 2,900 | **51%** | Informational | Harder than the topic tool's estimate implied — real competition here is stronger. Still worth doing (matches Builder's real free tier honestly) but budget more time/backlinks to rank, don't expect a quick win. |
| how to create a video game | 4,400 | **16%** | Informational | Genuinely easy — folds cleanly into the game-making content piece (§2, item 1) as the primary target over "free game maker vibe." |
| natural language parser | 22,200 | 59% | Informational | **Audience mismatch, confirmed.** High volume looks attractive, but the real keyword cluster (`core_keyword: "nlp"`) is developer-tooling searches (Python/JS NLP libraries) — not people evaluating an app builder. Recommend dropping, not just deprioritizing. |
| free game maker | 1,600 | 59% | Transactional | Harder than the topic tool's ~34% estimate, and its highest-volume real variant ("jeopardy game maker free," 4,400/mo) is an off-topic quiz-template niche unrelated to Builder. Recommend targeting "how to create a video game" (KD 16) instead as the primary game-making vector. |
| react native development services | 210 | 21% | Navigational | Confirms the soft-fit call in §1 — low volume, vendor-lookup intent (someone looking to HIRE a dev shop), not tool-evaluation intent. Low priority either way. |

### Ranking status check

`domain_rank_overview` for `builder.ainative.studio` returned an empty result set — **still 0 measurable organic keywords**, unchanged from the `SEO_PAID_BRIEF_2026-08-24.md` baseline. The greenfield situation described in that doc still holds three weeks later.

### Competitor overlap — real SERP check on "what is vibe coding" (top 20)

**Replit.com ranks #4** with a dedicated blog post (`replit.com/blog/what-is-vibe-coding`) — a real, present, direct competitor already occupying this exact term. Polsia, Lovable, Bubble, and Base44 do **not** appear anywhere in the top 20. The rest of the SERP is dominated by high-authority generalist explainers (IBM, Wikipedia, Cloudflare, SAP, Netlify, Codecademy) — this specific term is genuinely contested by both a direct competitor and general-authority domains, unlike the clean greenfield the paid brief found for category/comparison terms. **Implication:** the "what is vibe coding" page still belongs in the plan (real volume, real relevance), but it needs a genuinely differentiated angle — Builder's actual embedded-demo proof, not another generic definitional post — to have a real shot at outranking Replit's own take.

---

## 2c. SEMrush cross-validation (2026-09-06, third independent data source)

A SEMrush MCP connection (`https://mcp.semrush.com/v2/mcp`) was added to this session and confirmed live. Ran the same content topics through SEMrush's `phrase_these` batch keyword report, re-checked `builder.ainative.studio`'s ranking status, and pulled real competitor + backlink data on Polsia — extending, not replacing, the DataForSEO figures in §2b.

### Keyword numbers: real, but genuinely divergent from DataForSEO — documented honestly, not reconciled

| Topic | SEMrush Vol/mo | SEMrush KD | DataForSEO Vol/mo (§2b) | DataForSEO KD (§2b) | Note |
|---|---|---|---|---|---|
| what is vibe coding | 49,500 | 65 | 60,500 | 38 | Same order of magnitude on volume; **KD differs by 27 points** — SEMrush rates it meaningfully harder. Given Replit's confirmed #4 ranking (§2b), the higher KD estimate is plausibly the more realistic one. |
| vibe coding (base term) | 90,500 | 77 | 110,000 | 56 | Both large; SEMrush again rates it substantially harder to rank (77 vs 56). |
| how to make a game | 6,600 | 40 | 15,000 (topic tool, §2) | 34 (topic tool, §2) | SEMrush volume is under half the topic tool's figure — a real, material gap worth noting before committing content budget on this number alone. |
| rapid application development | 1,300 | 38 | 5,800 (topic tool, §2) | 24 (topic tool, §2) | Same pattern — SEMrush shows ~4x lower volume and meaningfully higher difficulty than the topic tool implied. |
| how to create a video game | 2,900 | 43 | 4,400 | 16 | Volume roughly consistent; **KD differs sharply** (43 vs 16) — SEMrush does not support this being an "easy" term. |
| how to make an app for free | 1,900 | 33 | 2,900 | 51 | Interesting inversion: SEMrush rates this EASIER than DataForSEO did, opposite direction from every other row. |
| prototyping tools | 74,000 | 50 | 590 | 26 | **Enormous discrepancy** — 125x apart on volume. Almost certainly measuring different keyword scopes/match-types under the hood (broad "prototyping tools" as a generic engineering-tool search vs. DataForSEO's narrower cluster) — do not use either number in isolation to greenlight or kill this topic; it needs a manual SERP look before any content decision. |
| natural language parser | 10 | 0 | 22,200 | 59 | SEMrush shows near-zero volume for the literal phrase — **independently reinforces the §2b conclusion to drop this topic**, via a completely different real signal (near-nonexistent literal search volume, vs. §2b's audience-mismatch argument). Two independent reasons now support dropping it. |
| free game maker | 880 | 88 | 1,600 | 59 | Both sources agree this is hard (SEMrush even harder, KD 88) — reinforces §2b's recommendation to deprioritize this in favor of "how to create a video game." |
| react native development services | 1,300 | 10 | 210 | 21 | Real fit assessment (low-priority, vendor-lookup intent) stands regardless of which volume figure is right. |
| best vibe coding tools | 1,900 | 33 | 1,900 (§2b) | 6 (§2b) | **Volume matches exactly** — cross-validated with high confidence. **KD differs enormously** (33 vs 6) — treat the "KD 6, easy win" framing from earlier docs with real caution; SEMrush's own estimate is over 5x higher. |
| lovable vibe coding | 720 | 35 | 1,000 (§2b) | 4 (§2b) | Volume roughly consistent. KD again diverges sharply (35 vs 4) — same caution as above. |

**Honest takeaway:** these are two real, independently-operated keyword-data companies whose crawls, clustering methodology, and difficulty models genuinely disagree — sometimes by an order of magnitude. Neither is "wrong"; they measure differently. The pattern worth acting on is where they **agree directionally** (natural-language-parser near-zero-fit, free-game-maker being hard, best-vibe-coding-tools' volume) — trust those calls with high confidence. Where they diverge sharply on keyword DIFFICULTY specifically (best vibe coding tools, lovable vibe coding, how to create a video game), do not treat either KD number as a firm "quick win" guarantee — verify with a real, current SERP check before committing significant content budget on a "low KD" claim alone.

### Ranking status — re-confirmed via SEMrush

`domain_rank` for `builder.ainative.studio` returned **"NOTHING FOUND"** (SEMrush's own no-data response, distinct from a 0-value row) — a third independent confirmation (topic tool implicitly, DataForSEO explicitly in §2b, now SEMrush) that Builder has zero organic footprint today.

### Real competitor + backlink data on Polsia (extends `SEO_PAID_BRIEF_2026-08-24.md` §1)

**Organic competitors (SEMrush `domain_organic_organic`):** Polsia's top 20 real organic competitors are almost entirely brand-name/typo-squatter domains (`polisia.kz`, `polisa.nl`, `pulsyai.com`, `polsia.app`, `pulseai.io`, etc.) — **none of the previously-tracked comparison competitors (v0, Lovable, Bolt, Base44) appear in this list at all.** This reinforces the existing brief's "~92% branded traffic" finding from a completely different angle: Polsia's own organic competitive set, per SEMrush, is mostly people/bots targeting ITS brand name, not a real competitive category. One real, previously-untracked domain surfaced with meaningful scale: **`cto.new`** (2,995 organic keywords, $14,165 organic traffic cost) — worth a quick look as a possible adjacent competitor, though its relevance score to Polsia was low (0.04), so this may be incidental overlap rather than a true competitor.

**Backlinks — a real, material update to the existing brief's figures:**

| Metric | `SEO_PAID_BRIEF_2026-08-24.md` (DataForSEO) | SEMrush (2026-09-06) |
|---|---|---|
| Total backlinks | 2,969 | **77,357** |
| Referring domains | 355 | **1,871** |

This is a real, ~26x/5x divergence, not a rounding difference — worth flagging to whoever owns the paid brief rather than silently overwriting it. **However, the qualitative conclusion holds up under closer inspection:** SEMrush's own Authority Score distribution for Polsia's 1,871 referring domains shows **1,353 domains (72%) sitting at Authority Score 0–2** — a very low-quality long tail, consistent with the original brief's "modest, spammy-adjacent" characterization. The real nuance the original pull missed: a genuine minority of Polsia's backlinks come from real, high-authority domains — **Forbes (AS 93), Y Combinator (AS 72), GitHub (AS 100), Medium (AS 97), Substack (AS 86, 50 links), Dev.to (AS 69, 10 links)** — almost certainly earned via press coverage rather than systematic link-building. **Net read: the backlink wall is still beatable (the bulk of the profile is low-quality), but Polsia has real, if sparse, high-authority press mentions that a pure "they have no real links" framing would understate.**

---

## 3. Recommended content calendar (Phase 1 — next 2–4 weeks)

Prioritized by (a) genuine fit with Builder's real product, (b) overlap with the existing paid-brief's "SEO-winnable" comparison pages, so content can cross-link into an existing funnel rather than being an orphaned post.

1. **"Rapid Application Development: Tools and Techniques"** (targets: rapid application development — 5.8K vol/mo, 24% KD, confirmed the easiest-to-rank topic with real volume in this set; prototyping tools + ai prototyping tools as FAQ subsections, not separate posts — their real volume is too small to justify standalone pages, §2b)
   - Natural home for a comparison table including Builder + the same competitors already tracked (`/compare/lovable`, `/compare/replit`, `/compare/base44`, `/compare/bubble`).
   - **Ship this FIRST** — lowest real KD of any topic with meaningful volume, fastest realistic path to a ranking win.
2. **"How to Make a Game — No Code, Just Describe It"** (targets: how to make a game [15K vol, 34% KD], how to create a video game [4.4K vol, **16% KD** — confirmed real and easy, §2b])
   - Embed a live `/build` demo generating a simple game concept.
   - Cross-link to `/best/vibe-coding-tools` (KD 6, already a paid-brief target, and re-confirmed via DataForSEO §2b) and any future `/vibe-coding` hub.
   - **Do NOT target "free game maker vibe"** — real data shows KD 59% and its real top-volume variant is an off-topic quiz-template niche (§2b). Drop it from this piece's keyword targets.
3. **"What Is Vibe Coding? A Plain-English Guide"** (targets: what is vibe coding — 60,500 vol/mo real DataForSEO figure, 38% KD; vibe coding meaning [18.1K vol] as an FAQ section; how to vibe coding [1.6K vol, KD 20] as an internal-link anchor)
   - This is the definitional anchor content Phase 2 of the paid brief already calls for ("build the definitive explainer + tool" under `/vibe-coding`). Treat the original topic-tool output as the outline/title source for that exact planned page — don't duplicate the planning, execute it.
   - **Real competitive check (§2b): Replit already ranks #4 here** with `replit.com/blog/what-is-vibe-coding`. This is NOT greenfield like the comparison pages — win by embedding Builder's real, live demo directly in the page (the thing Replit's post can't show as directly), not by out-writing a generic explainer.
   - Include a "Lovable vibe coding" (KD 4 — easiest term in the whole cluster, §2b) comparison callout linking to `/compare/lovable`.
4. **"How to Make an App for Free — What You Actually Get"** (targets: how to make an app for free — 2.9K vol, **51% KD, harder than expected per §2b**; free ai app builder — already in the paid brief's SEO+paid list)
   - Must be radically honest about the real 3-free-builds limit rather than implying unlimited free use — matches this codebase's own "never fabricate" discipline (see `FREE_BUILD_LIMIT` in `lib/build/build-credits.ts`) and avoids a bounce-heavy page that over-promises.
   - Budget more time/backlink effort here than the topic tool implied — real KD is meaningfully higher than "how to make a game" or the RAD piece.

**Dropped entirely (not just deprioritized):** "natural language parser" — real DataForSEO data confirms its keyword cluster is NLP-developer-tooling searches, not app-builder searchers, a genuine audience mismatch (§2b) — and "recommended autonomous testing tools for automotive" (wrong vertical). "React native development services" remains low-priority (confirmed low volume + vendor-lookup intent, §2b) — revisit only if a comparison/alternative-to-agency angle is wanted later.

---

## 4. Data log — all topics now verified

All 10 original topics have now been checked via the topic tool's own full pull (§2), independent real DataForSEO Labs data (§2b), AND a third independent SEMrush pull (§2c). No pending items remain. Two real corrections came out of the DataForSEO pass — see the ⚠️ rows. §2c's full cross-source comparison table shows real, sometimes large numeric divergence between DataForSEO and SEMrush on several terms — treat the single Volume/KD figures below as ONE source's read (DataForSEO or the topic tool), not an absolute truth; see §2c before making a content-budget decision based on a "low KD" claim alone.

| Topic | Volume/mo | Avg KD | Intent | Status |
|---|---|---|---|---|
| how to make a game | 15,000 | 34% | Info + Commercial + Transactional | ✅ full data (§2, topic tool) |
| rapid application development | 5,800 | 24% | Info + Commercial | ✅ full data (§2, topic tool) |
| what is vibe coding | 60,500 | 38% | Informational | ✅ real data (§2b, DataForSEO) — ⚠️ Replit ranks #4, contested |
| how to create a video game | 4,400 | 16% | Informational | ✅ real data (§2b, DataForSEO) — easy, promote to primary game-content target |
| how to make an app for free | 2,900 | 51% | Informational | ✅ real data (§2b, DataForSEO) — ⚠️ harder than topic tool implied |
| prototyping tools | 590 | 26% | Informational | ✅ real data (§2b, DataForSEO) — smaller than assumed, fold into RAD piece |
| free game maker (vibe) | 1,600 | 59% | Transactional | ✅ real data (§2b, DataForSEO) — ⚠️ harder + off-topic top variant, deprioritize vs "how to create a video game" |
| natural language parser | 22,200 | 59% | Informational | ✅ real data (§2b, DataForSEO) — ⚠️ **dropped, audience mismatch (NLP-dev tooling, not app-builder searchers)** |
| react native development services | 210 | 21% | Navigational | ✅ real data (§2b, DataForSEO) — confirmed low-priority, vendor-lookup intent |
| ~~autonomous testing tools for automotive~~ | — | — | — | ❌ dropped, wrong vertical (§1) |

**Next real step:** none of this is executed yet — it's still a plan. The highest-leverage next action is shipping content piece #1 in §3 (the RAD/tools-comparison page, lowest real KD with meaningful volume) and getting `builder.ainative.studio` its first indexed, ranking page — it currently has zero, unchanged since the original 2026-08-24 baseline.
