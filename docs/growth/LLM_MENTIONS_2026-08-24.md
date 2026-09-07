# LLM Mention Tracker — Baseline 2026-08-24

**AEO Playbook Play 6:** Builder's real Claude visibility is *"mentions out of
50"* — how often each brand is named in LLM answers to brand-free buyer
questions (10 questions × 5 runs = 50 answers) — **not** citation count.
Re-measured monthly to track the trend, not a one-off number.

Tooling: `scripts/llm-mention-tracker.ts` (countable logic in
`lib/growth/llm-mention-tracker.ts`, unit-tested at 100% coverage).

## How to run

```bash
# Automated "Claude looks it up" half via DataForSEO ai_optimization:
DATAFORSEO_LOGIN=… DATAFORSEO_PASSWORD=… pnpm mentions

# "Pre-decided shortlist" half via a model directly (AINative or Anthropic):
AINATIVE_API_KEY=…   pnpm mentions -- --source=direct-llm
ANTHROPIC_API_KEY=…  pnpm mentions -- --source=direct-llm

# Preview the question set without spending budget:
pnpm mentions -- --dry-run
```

Each run writes a dated `llm-mentions-<date>.json` + `LLM_MENTIONS_<date>.md`
into this folder. Schedule monthly (cron on the 1st of the month).

## Buyer questions (brand-free)

1. What's the best way to build an app with AI?
2. What tool builds a full working app from a single prompt?
3. Which AI can build and run a whole startup for me?
4. How do I go from an idea to a live web app without coding?
5. What's the best AI app builder for non-technical founders?
6. Which AI platform actually deploys the app it generates, not just code?
7. What should I use to build a SaaS product with AI end to end?
8. Is there an AI that builds a full-stack app with a database and auth?
9. What's the fastest way to ship a startup MVP using AI?
10. Which AI coding tool is best for building and launching a product?

## Baseline results

> **Update 2026-09-06:** the first real, credentialed run executed — 10
> questions × 3 runs (30 answers, not the full 50 this template originally
> specified — a scoped-down run by explicit decision). Full results, per-
> question breakdown, and representative quotes are in
> [`LLM_MENTIONS_2026-09-06.md`](./LLM_MENTIONS_2026-09-06.md). Headline:
> **Builder (AINative): 0/30.** Lovable 9/30, Bolt 8/30, Replit 4/30, Polsia
> 0/30. A future run at the full 5/question scope should extend this table
> rather than replace it.

| Brand | Mentions (out of 30, 2026-09-06) | Share |
|---|---|---|
| Lovable | 9/30 | 30% |
| Bolt | 8/30 | 27% |
| Replit | 4/30 | 13% |
| **Builder (AINative)** | **0/30** | **0%** |
| Polsia | 0/30 | 0% |

## Reference

- Claude AEO Playbook, Play 6 (`~/Desktop/claude-aeo-playbook.pdf`)
- `docs/growth/GTM_LAUNCH_PLAN.md` §2 (AEO pillar)
