# Builder Press &amp; Listing Kit

**Date:** 2026-09-07 · **Owner:** growth · **Purpose:** off-site AEO mentions
**Why this exists:** `LLM_MENTIONS_2026-09-06.md` found Builder at **0/30** real
Claude mentions, even on questions matching its own core positioning. Per the
Claude AEO Playbook (`GTM_LAUNCH_PLAN.md` §2, Play 6), pages alone can't fix
this — Claude forms a brand shortlist from off-site mentions (review sites,
press, comparison blogs) *before* it searches. This kit is everything needed
to submit Builder to those sites in minutes, not hours, once someone with
account-owner access executes it.

**What I can't do autonomously:** creating and verifying a company account on
G2/Product Hunt/Trustpilot/Capterra requires a real human identity, business
email verification, and often a live product demo during a call — that's
account-ownership work, not code. Everything below is prepared so that step
takes minutes once you (or whoever owns those accounts) sits down to do it.

---

## 1. Canonical facts (single source of truth — copy these verbatim)

Pulled directly from the live product and `lib/build/pricing-tiers.ts` —
**do not restate pricing/features from memory; copy from this table.**

| Fact | Value |
|---|---|
| Product name | AINative Builder |
| Parent company | AINative Studio |
| URL | https://builder.ainative.studio |
| One-line description | AI that builds AND runs your company — describe an idea, Cody (your AI co-founder) builds a real running app and an operating AI-native business on real primitives, then runs it 24/7. |
| Category | AI App Builder / No-Code AI Platform / AI Business Automation |
| Free tier | **Free** — 3 builds, no credit card required |
| Paid tiers | Starter $20/mo (~80 builds, Claude Haiku 4.5) · Pro $49/mo (real generation, Claude Sonnet 4.5, 1M tokens/50K API calls/10GB) · Business $199/mo (adds the nightly autonomous loop — CRM, invoicing, helpdesk, voice) |
| Revenue share / lock-in | None. Users own 100% of what Cody builds. |
| Founded / launched | AINative Studio is the parent; Builder is its flagship product (confirm exact launch date before submitting — not verified in this session) |
| Primary competitors (for "alternatives to X" framing) | Polsia, Lovable, Bolt.new, v0, Replit, Bubble, Base44 |
| Key differentiator vs. code generators (v0/Lovable/Bolt) | Builder produces a running product PLUS the operating company around it (real CRM/invoicing/helpdesk/voice via ZeroPipeline/ZeroInvoice/ServiceOS/ZeroVoice) — not just UI code |
| Key differentiator vs. Polsia | Builder BUILDS the company AND runs it, on real primitives the user owns; Polsia only runs, doesn't build, and is not agent/LLM-discoverable (no llms.txt/agents.txt) |
| Agent/AX infrastructure (verifiable, live) | `llms.txt` (200), `agents.txt` (200), `robots.txt` (200) — confirmed live 2026-09-07 |

**Do not claim:** a specific star rating, a specific user/customer count, "#1"
superlatives, or funding figures — none of these are established facts in
this codebase. If a listing site requires them, get the real number from
Toby before submitting rather than estimating.

---

## 2. Screenshots needed (not yet captured — action item)

Most listing sites (G2, Product Hunt, Capterra) require 3–5 real product
screenshots at submission time. Capture these from a real `/build` session
before submitting anywhere:

1. The `/build` chat interface mid-generation (shows Cody composing an app live)
2. A finished, running preview app (the shareable URL output)
3. The Live dashboard for a generated company (visitors metric, primitives wired)
4. The pricing page (`/pricing`) — shows the real tier table
5. (Optional) The autonomous nightly-loop / Company Track output

---

## 3. Product Hunt launch draft

**Tagline (60 char max):** `AI that builds AND runs your company, not just code`
(51 chars)

**Description (260 char max):**
> Describe an idea. Cody builds a real running app AND an operating business — CRM, invoicing, helpdesk, voice — on primitives you own. Not a prototype generator: a co-founder that builds, deploys, and then runs your company 24/7.
(228 chars)

**First comment (maker's comment — post immediately after launch):**
> Hey Product Hunt! Most AI app builders stop at a working prototype. We built Builder to go further: Cody (the AI co-founder inside Builder) builds a real app, deploys it to a live URL, and then keeps running the resulting business — sales pipeline, invoicing, support, voice — on a nightly autonomous loop, using real AINative primitives (ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice) you actually own, not a black box.
>
> Free tier is 3 builds, no credit card. Would love your feedback — especially on where the "build vs. run" split should sit for your own use case.

**Topics/tags to select:** Artificial Intelligence, No-Code, Developer Tools,
SaaS, Productivity

**Gallery order:** screenshot 2 (running app) first — Product Hunt users judge
in the first 2 seconds; lead with proof, not chat UI.

---

## 4. G2 listing draft

**Category to claim:** "No-Code Development Platforms" and/or "AI App
Development Platforms" (check G2's current taxonomy at submission time — it
changes).

**Short description:**
> AINative Builder turns a one-line idea into a real, deployed app and an operating AI-run company — CRM, invoicing, helpdesk, and voice included — built on open primitives you own, not a proprietary black box.

**Long description:**
> AINative Builder is an AI app builder that goes beyond code generation. Describe an idea, and Cody — Builder's AI co-founder — produces a full set of real artifacts (product brief, PRD, data model, agent definitions, business model, landing page) and a working, deployed app with a shareable URL. Unlike tools that stop at a prototype, Builder then keeps the resulting business running on a nightly autonomous loop, operating real CRM (ZeroPipeline), billing (ZeroInvoice), support (ServiceOS), and voice (ZeroVoice) systems — all built on AINative's open primitives, which users own outright with no revenue share or lock-in.
>
> Builder starts free (3 builds, no credit card) and scales to Pro ($49/mo, real production generation via Claude Sonnet 4.5) and Business ($199/mo, adds the full autonomous operations loop).

**Review-generation note:** G2 rewards *real, verified* customer reviews far
more than the listing copy itself — the highest-leverage move here is asking
2-3 actual paying customers (once there are some) to leave a review, not
polishing this description further.

---

## 5. Trustpilot / Capterra listing notes

Both are lighter-weight than G2 (no sales call required, self-serve claim
flow). Use the same "Short description" from §4. Trustpilot in particular
correlates with "is X legit" queries (`GTM_LAUNCH_PLAN.md` §2's Polsia
conquest table shows "is polsia legit" as a real 170 vol/mo term) — claiming
this listing directly serves the "is Builder legit" shortlist question Claude
is likely to check.

---

## 6. Comparison-blog / press outreach angle (Play 4 — editorial, not aggregators)

Per the AEO Playbook finding in `GTM_LAUNCH_PLAN.md` §2.4: press/editorial
coverage is ~2.7x more valuable on Claude than on ChatGPT, and no single site
holds more than 9% of mentions — a small, real comparison blog can move the
needle. Pitch angle for smaller AI-tool blogs (not aggregator sites):

> Subject: An AI app builder that doesn't stop at the prototype
>
> Most "AI app builder" roundups compare tools that generate code (v0, Lovable, Bolt) or tools that run automations (Zapier, n8n). AINative Builder is neither — it builds a real deployed app from an idea, then runs the resulting business (CRM, billing, support, voice) autonomously on open primitives the founder owns. Happy to give you a live walkthrough or trial access if you're covering AI app builders / AI cofounders this quarter.

This should be sent to a real, current list of AI-tool comparison bloggers —
**not fabricated here**; building that contact list is a separate, concrete
next step (see §7).

---

## 7. Concrete next steps (in order)

1. **Capture the 5 screenshots in §2** — blocks every submission below.
2. **Submit Product Hunt draft (§3)** — fastest, self-serve, no sales call.
3. **Claim Trustpilot + Capterra listings (§5)** — self-serve, serves the
   "is Builder legit" shortlist question directly.
4. **Start the G2 listing (§4)** — slower (may require a call); start early.
5. **Build a real target list of 10-15 AI-tool comparison blogs** and send
   the pitch in §6 to each, personalized — do not mass-blast identical copy.
6. **Re-run the LLM mention tracker 30-60 days after §2-5 land** to measure
   whether off-site presence moved Builder off 0/30 (`LLM_MENTIONS_2026-09-06.md`
   is the baseline to compare against).
