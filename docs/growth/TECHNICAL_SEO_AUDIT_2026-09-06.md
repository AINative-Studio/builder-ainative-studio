# Builder Technical SEO Audit — remediation plan

**Date:** 2026-09-06 · **Data source:** third-party site-audit crawl (summary counts pasted by the user; full per-page export not yet available) · **Author:** growth
**Companion docs:** [`SEO_CONTENT_TOPICS_2026-09-06.md`](./SEO_CONTENT_TOPICS_2026-09-06.md) (content strategy), [`SEO_PAID_BRIEF_2026-08-24.md`](./SEO_PAID_BRIEF_2026-08-24.md) (competitive/paid targeting). This doc is the technical-health layer underneath both — content and keyword strategy don't matter if the crawl itself is broken.

---

## TL;DR

The audit surfaced 17 findings (4 errors, 5 warnings, 8 notices). **One root cause directly confirmed and fixed this session:** the sitemap listed two auth-gated routes (`/templates/analytics`, `/templates/submit`) that 307-redirect to `/login` for any anonymous crawler — accounting for 2 of the "3 incorrect pages in sitemap.xml" and likely the "1 page returned a 4XX" finding (a crawler treating an unexpected redirect chain as an error page). Fixed directly in `app/sitemap.ts` — see §1.

**Everything else in this doc is diagnosed from the summary counts only** — the audit tool's full per-page export (CSV/detail report) has not been pulled into this session yet. Several findings (444 invalid structured-data items, 86 broken internal links) are large enough that guessing at a fix without the real per-page list risks fixing the wrong thing at scale. §2 below flags what's needed to close each one out for real.

---

## 1. Confirmed and fixed this session

### 3 incorrect pages in sitemap.xml (2 of 3 confirmed) + 1 page returned a 4XX status code (likely the same root cause)

**Real, direct verification:** curl'd every one of the 50 real URLs in the live sitemap (`https://builder.ainative.studio/sitemap.xml`). Two returned `307` instead of `200`:

```
307 https://builder.ainative.studio/templates/analytics  →  Location: /login
307 https://builder.ainative.studio/templates/submit     →  Location: /login
```

**Root cause:** `middleware.ts` explicitly gates both routes behind auth ("Submit/analytics stay gated below" — a deliberate, correct design choice, since they're account-scoped actions/data, not public content). But `app/sitemap.ts` still listed both as if they were public, crawlable pages.

**Fix (shipped):** removed both entries from `app/sitemap.ts`. Added a regression test (`__tests__/lib/sitemap-templates.test.ts`) asserting neither URL ever reappears in the sitemap. The routes themselves are untouched — they're correctly gated; only the sitemap's false claim that they're public was wrong.

**Still open:** the audit says "3 incorrect pages" — only 2 were found via this direct crawl. The third is either a different URL entirely (needs the full audit export to identify) or a URL that started resolving correctly between the audit's crawl and this check (the sitemap is dynamically generated per-request from `TEMPLATE_SLUGS`/`GUIDE_SLUGS`/`SEED_SHOWCASE`, so a transient data issue at crawl time is possible). Re-run the third-party audit after this fix deploys to confirm the count drops to 0–1, and if 1 remains, get its exact URL.

---

## 2. Needs the real per-page audit export to fix correctly

These are real, live counts from the audit summary, but a blind guess at "here's probably what's wrong" risks fixing the wrong 5% of a 444-item or 86-item finding while leaving the rest broken. **Ask for the CSV/detail export from whatever tool produced the summary** (Semrush Site Audit and similar tools always offer a per-issue page list) before spending real engineering time here.

| Finding | Count | What's needed to diagnose for real | Plausible root cause (unverified) |
|---|---|---|---|
| Structured data items are invalid | 444 | The exact JSON-LD field/type failing validation, and which pages. 444 is large enough that this is very likely ONE systemic bug (a shared component or schema helper) repeated across many pages, not 444 independent issues. | This codebase generates FAQPage/SoftwareApplication JSON-LD across `/compare/*`, `/best/*`, `/templates/*`, `/guides/*` (per `SEO_PAID_BRIEF_2026-08-24.md` §3's own plan to ship these). A single malformed shared schema-builder function would explain a count this large. |
| Internal links are broken | 86 | The exact source pages and target URLs. | Could be stale links to old `/templates/*` or `/guides/*` slugs after a content update, or links generated from a data file (`lib/data/seo-templates.ts` / `lib/data/seo-guides.ts`) that's drifted out of sync with the real route slugs — same class of bug as §1's sitemap issue (a static list not matching real routing state). |
| Pages have low text-HTML ratio | 84 | Which pages — likely the same large surfaces (templates/guides/showcase) if they're heavy on layout/nav markup relative to real content. | Not urgent to fix blind; likely resolves naturally as the content pieces in `SEO_CONTENT_TOPICS_2026-09-06.md` ship with real, substantial prose. |
| Pages have too much text in title tags | 56 | The exact `<title>` values — likely a shared title-template pattern appending too much boilerplate (e.g. brand name + tagline + category) on every page in a given route group. | Check the `generateMetadata` title-building logic for `/templates/[slug]`, `/guides/[slug]`, `/compare/[competitor]` — a shared suffix pattern is the most likely single cause of 56 pages sharing this problem. |
| Pages have a low word count | 48 | Which pages — likely overlaps heavily with the low-text-HTML-ratio 84. | Same as above — likely resolves as real content ships, not a code bug. |
| Resources are formatted as page link | 77 | Unclear what this specifically flags without the tool's own definition (possibly non-HTML resources — images, PDFs — being linked with `<a>` instead of appropriate markup, or internal links pointing at API/asset routes instead of real pages). | Needs the tool's exact definition + example URLs. |
| Pages have only one incoming internal link | 49 | Which pages — likely the `/templates/[slug]` or `/guides/[slug]` long-tail pages if nothing links to them except the index/sitemap. | Matches a real, known gap: `SEO_PAID_BRIEF_2026-08-24.md` §2's Phase 2 plan calls for hub pages that interlink into comparison/category content — if those hubs don't exist yet, every long-tail page is genuinely an orphan except for its one index-page link. This is a real, expected symptom of a content plan that's still in progress, not necessarily a bug. |
| Pages are blocked from crawling | 5 | Which 5 pages, and whether the block is intentional (e.g. `/api/*`, `/build/[slug]` preview iframes that legitimately shouldn't be indexed) or accidental. | Check `robots.txt`/middleware for anything unintentionally disallowed. |
| An external image is broken | 1 | The exact URL. | Low priority, single instance. |
| A page doesn't have an h1 heading | 1 | Which page. | Low priority, single instance — likely a specific template/guide page missing its `<h1>`. |
| A subdomain doesn't support HSTS | 1 | Which subdomain (likely NOT `builder.ainative.studio` itself, but something adjacent — e.g. a wildcard `{slug}.ainative.studio` deploy target, per this session's earlier work on `AINATIVE_WILDCARD_HOST`). | Needs the exact hostname flagged. |
| A link has no anchor text | 1 | Which link/page. | Low priority, single instance. |
| Llms.txt file has formatting issues | 1 | **Directly checked this session** — the live `llms.txt` (`https://builder.ainative.studio/llms.txt`) is clean UTF-8 with a proper trailing newline and a real `# AINative Builder` H1 as the first line. Whatever the tool flags is more specific than a gross formatting error — need the tool's exact complaint (e.g. a specific required section header, line-length limit, or spec-version mismatch) to act on it. | Unknown — the file looks structurally sound on direct inspection. |
| A page has low semantic HTML usage | 1 | Which page. | Low priority, single instance. |
| A page requires content optimization | 1 | Which page, and what "requires optimization" means per the tool's own rubric. | Low priority, single instance. |

---

## 3. Recommended next step

**Get the full per-page audit export** (every tool that produces a summary like this — Semrush Site Audit, Ahrefs Site Audit, etc. — has a "download issues" / "export to CSV" action) and drop it into `docs/growth/` alongside this doc. With real page-level detail, the 444-item structured-data finding and the 86-item broken-links finding in particular can very likely each be traced to one or two shared root causes (a schema-builder function, a stale data file) and fixed with the same kind of small, surgical, single-source fix as §1 — rather than guessed at 444 times.

**Note on SEMrush MCP:** a SEMrush MCP server (`https://mcp.semrush.com/v2/mcp`) was added to this project's config this session but requires a session restart (and possibly a one-time OAuth login) to connect — once live, it may be able to pull this same audit data programmatically instead of needing a manual export.
