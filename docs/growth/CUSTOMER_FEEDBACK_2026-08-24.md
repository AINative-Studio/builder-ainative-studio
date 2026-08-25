# Customer Feedback Session — 2026-08-24

**Source:** `Audio_08_24_2026_18_47_55.mp3` (~24 min, 3,915 words), Toby demoing Builder live to a small group. One participant is the **exact target persona** — "a non-technical founder who was a developer-product person" — i.e. someone who understands builders but doesn't want to code. Polsia ($13M ARR) shown as the competitive reference throughout.

> Method: transcribed via Whisper, then filtered. **Not every suggestion is captured as an issue** — several are off-vision tangents (see "Ignored"). Extracted items are prioritized by *ease / least code / alignment with current UX flow*.

---

## Raw themes (what was actually said)

1. **The pay moment is the #1 open question.** Toby repeatedly: *"how do I get people to that pay button?"* Participants' honest answers:
   - *"I'm highly suspect of paying for anything… I need to experience it and then I'll pay."*
   - *"When I see a good design and what it's proposing… this is what I'm planning, this is what it'd cost to build."* → **design + a concrete proposal drives willingness to pay.**
   - The pain point that converts: *"I've already started down that path, getting excited, then suddenly 'sorry you're out of credits'."* → conversion happens mid-excitement, at the credit wall.
2. **"Simulating vs real" is confusing.** The primitive boxes / plan currently *simulate* ("none of this has been built… it just gave you a plan and it's simulating what it would build"). Users can't tell what's real vs planned.
3. **The tutorial video slot is loved.** *"this is like a tutorial video that'll land here… what do you think? — I love that."* (Already filed #51.)
4. **Polsia's readability/charm noted:** *"it doesn't look like an AI thing… shockingly readable… the craigslist of vibe coding."* And critically: the **logged-OUT page says what it does** ("that's nice… now I get it") — the logged-in view doesn't explain itself.
5. **Brand the primitives.** *"you should brand those things — 'zero pipeline'… as you hover it says what it does."* → hover tooltips on primitive chips explaining each.
6. **Structure the build as a team of agents you assemble** ("hire your team"): *"we recommend this is a 3-person startup, you'll need 3 agents that do these things"* / start with 2 agents, add more. Coach agent is free; specialized agents (design, PM, coder) are the paid unlock.
7. **A "coach/advisor agent" that's free** and walks you from idea → defined product → brings in design/PM agents. *"coach is free… at this point you need a product manager."*
8. **Founder pitch-deck export** as a paid deliverable: *"you've made your company, now go pitch it — export a slick deck."*
9. **Freemium framing:** free tier must *"set you up to use all your paid [AINative] tools."* The free product is the funnel into the paid primitives.

---

## Extracted, prioritized ACTIONABLE items (on-vision, easy, on-flow)

Ordered by ease × alignment. These become issues.

| # | Item | Why (from transcript) | Ease | Aligns |
|---|---|---|---|---|
| A | **Logged-out page must explain what Builder does** | "logged-out version says what it is… now I get it" — the value prop is missing when signed in / the front door must self-explain | Easy (copy/hero) | ✅ front door |
| B | **Hover tooltips on primitive chips** ("Powering this") — brand each + say what it does | "brand those things… hover says what it does" | Easy (UI) | ✅ existing chips |
| C | **Clear "simulated vs real" labeling** on the plan/preview | "none of this is built… it's simulating" is confusing | Easy-Med (badges/copy) | ✅ existing flow |
| D | **Concrete proposal at the pay gate**: what we'll build + what it costs + click-to-preview each system | "when I see the design + what it's proposing + what it'd cost… that's where I pay" | Med | ✅ Launch/paywall |
| E | **Founder pitch-deck export** (paid deliverable) | "export a slick deck to pitch to VCs" | Med | ✅ paid unlock |
| F | **Coach/advisor agent (free) → idea→product→assemble team** | "coach is free… now you need a PM" — the guided path to the pay moment | Med-Large | ✅ Cody character |

**Note:** Item F overlaps the "hire your team of agents" idea and the existing Cody character + swarm — it's the biggest but most strategic (it directly addresses the #1 pay-moment question).

---

## IGNORED (off-vision / not now / roadmap-to-test-only)
- **Business incorporation** (S-corp/Delaware/ZenBusiness, $300-500) — Toby himself said *"I don't want to get into all that."* Off-vision; at most a blog/SEO topic, not product.
- **Community / people-helping-people** ("Perry texts me constantly", build a community) — interesting but a separate product surface; Toby: *"this is v1."* Roadmap-to-consider, not now.
- **Local-AI / hardware / servers** (Chris, moving physical servers, $25k AWS credits) — infra/partnership tangent, unrelated to Builder UX.
- **Pricing/token-economics deep-dive** ("how many tokens to trigger value") — real, but a business/pricing exercise, not a buildable UI issue yet. Flag for the pay-gate work (D).

---

## The through-line
The session is dominated by ONE question: **how do you earn the pay click?** The answer from the target persona: *let me experience it + show me a concrete, well-designed proposal of what you'll build and what it costs, then I'll pay.* That points at items C + D (make real-vs-simulated clear, and make the pay gate a concrete proposal) as the highest-leverage, and F (coach → assemble team) as the strategic bet. Items A + B are near-free clarity wins.
