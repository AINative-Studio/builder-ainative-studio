# Polsia Dashboard → Builder Live UX Gap Analysis

**Date:** 2026-08-24 · Source: Polsia "ShelfMind" company dashboard (`polsia.com/dashboard/{slug}`)
**Lens:** similar-but-different, built on **AINative platform primitives** + our **AX (agent-experience) focus**.

## What Polsia's dashboard IS (the layout to learn from)
A single operating console for one AI-run company. Regions:
- **Left rail — the "org":** company card + "Shipped" status, **AUTO MODE / NIGHTSHIFT** toggle, "Hire Your AI Employee" + SEE PLANS (monetization), **Routines** (Ongoing cycle / Nightly task), **Teams** (+ Add member).
- **Center — the work:** **Tasks** (agent task cards w/ credit cost + "NEW TASK"), **Website** (manage/deploy), **Documents** (Research, Product Roadmap, Mission — auto-written).
- **Right — the channels:** **Twitter** (auto-tweet), **Ads** ("Not running yet"), **Email**, **Media**, and a persistent **chat/console** where the agent narrates + asks (e.g. picking & buying a domain: "My pick: onubrand.app").

It's dense, editorial, and reads as *a company operating itself*. That's the emotional win we must match.

## The core strategic difference (our moat)
Polsia's dashboard is a **closed black box**: every panel (Twitter, Email, Ads, DB, Website) is Polsia's own opaque service. The user owns nothing and can't inspect or leave. **Builder's every panel should map to an AINative primitive the user actually OWNS and can call directly** — and every panel should be **agent-accessible (AX)**, not just human-clickable. Same console feel, opposite ownership model.

---

## Gap analysis → Builder improvements (similar, different, primitive-backed, AX-first)

### 1. Business-systems panels → real, owned AINative primitives (not opaque services)
Polsia shows Twitter/Email/Ads/DB as its own black boxes. Builder's Live already has a business-systems grid (ZeroPipeline/ZeroInvoice/ZeroCommerce/ZeroVoice) — **push it further to full parity with Polsia's channel set, each backed by a primitive the user owns:**
| Polsia panel | Builder equivalent (owned primitive) |
|---|---|
| Tasks / Routines | AgentCloud / OpenClaw swarm (real task_ids, our nightly loop) |
| Documents (Research/Roadmap/Mission) | ZeroMemory + doc generation (already have artifacts) |
| Website | Builder deploy + custom domain (owned, on Railway) |
| Email | **ServiceOS / ZeroVoice** or a ZeroPipeline email sequence |
| Twitter/social | (gap) — a social primitive or integration |
| Ads | our GTM/Ads integration (we have Google Ads MCP + Meta) |
| DB | **ZeroDB** (user owns the project + data) |
| Payments | **ZeroInvoice / ZeroCommerce** |
- **Differentiator UI:** each panel shows a **"docs ↗" + "you own this" + "call the API" affordance** (Polsia has "docs" links but you can't leave with your data). Reinforce the "N/34 primitives woven — you own all of them" counter.

### 2. AX-first: make every panel agent-accessible, not just clickable
This is the thing Polsia structurally can't do (they're LLM-invisible). For each dashboard panel/action:
- Expose an **`agent.json` / MCP endpoint** so a user's *own* agent can drive the same action (create task, send email, deploy) programmatically — the dashboard is a human view over an agent-native API.
- Semantic HTML + `data-agent` attributes + ARIA on the dashboard so agents can read state.
- A visible **"Drive this with your agent"** affordance per panel (copy the MCP/endpoint) — turns the console into an AX showcase, our brand.

### 3. AUTO MODE / NIGHTSHIFT toggle (adopt — it's great)
Polsia's AUTO MODE / NIGHTSHIFT toggle is a strong, legible metaphor for "runs while you sleep." Builder has the nightly loop (real, executing) but **no equivalent prominent toggle.** Add an **Auto/Nightshift control** on Live that maps to our real `builder_loop_enrollments` + nightly-loop dispatch — and show the last run's morning summary (we already compute it). Honest states when off.

### 4. Persistent Cody console with in-context decisions (adopt + improve)
Polsia's right-rail chat where the agent narrates and asks ("My pick: onubrand.app — buy?") is excellent — decisions happen *in flow*. Builder has "Ask Cody" but make it a **persistent narrating console** that (a) streams what the swarm is doing, (b) surfaces decisions inline (domain, next task) with one-click approve — reusing our existing decision-modal pattern. Difference: Cody cites the **owned primitive** it's about to use.

### 5. Routines / Teams (adopt the vocabulary)
- **Routines** (Ongoing cycle / Nightly task) = clean UI for our recursive loop. Adopt.
- **Teams / "Add member" / "Hire Your AI Employee"** = onboarding real collaborators or agents. Maps to AINative workspaces (multi-user) + AgentCloud (add an agent to the swarm). This also ties to the **real-auth gap (#49)** — "add member" is meaningless without accounts.

### 6. Density + editorial polish (match, in Modernist)
Polsia's dashboard is confidently dense and editorial. Builder's Live is cleaner but can feel emptier ("0 visitors / $0"). Match the *confidence* via honest, populated states (real intelligence data, real swarm activity) rather than zeros — and keep our Modernist chrome (0-radius, Archivo/Newsreader/IBM Plex Mono) as the visual differentiator vs Polsia's serif+terminal look.

---

## What to IGNORE (off-vision / anti-moat)
- Don't copy Polsia's closed-service model (opaque Twitter/Email/DB you can't leave). Our whole pitch is ownership.
- Don't chase every channel Polsia has for parity's sake — prioritize channels backed by a **real AINative primitive** we can hand the user.
- Don't hide business metrics behind vanity (Polsia leaks its own metrics publicly). Show real, owned numbers.

## Priority (for next-version testing)
1. AX affordances per panel (our unique moat) — **highest differentiation**
2. Auto/Nightshift toggle wired to the real loop
3. Persistent Cody console w/ inline decisions
4. Full business-systems parity mapped to owned primitives
5. Routines/Teams vocabulary (gated on real auth #49)

---
## Batch 2 — more Polsia dashboard screens (2026-08-24) → issues #56-60

| Polsia feature | Builder gap | Issue |
|---|---|---|
| Account nav dropdown (My Portfolio/Credits/Billing/Settings/Help & Docs/Refer & Earn/Logout) | Scattered; no unified menu; missing Credits view, Help, Refer | #56 |
| Settings → Profile (name/email/twitter/**content language**) + Danger Zone | Account.tsx is READ-ONLY (0 inputs); no content-language; no danger zone | #57 |
| Auto Mode ("works nonstop, you choose how long" + duration slider) | Loop is on/off; no user-set bounded run duration | #58 |
| Refer & Earn (cash credits on subscribe, no cap, instant, referral stats) | No referral program at all | #59 |
| Help Center (help.polsia.com — AI "ask anything grounded in docs/FAQ" + Guides + FAQ) | Only static /guides; no AI ask-anything help hub | #60 |

**Content language (from #57) is notable:** Polsia writes daily reports + research in the user's chosen language and follows the business's signup language. Builder should let content language drive Cody's generation across artifacts, summaries, and auto-media (#54).

**Help Center (#60) is a strong on-vision AEO/AX play:** an "ask anything grounded in docs" hub is answer-engine optimization applied to support — crawlable Q&A + agent-queryable, exactly our moat.
