/**
 * SEO Guides Catalog — single source of truth for the blog/guides section that
 * powers the individually indexable long-form articles at /guides/[slug] and the
 * /guides index (Issue #35).
 *
 * These are static, build-time data (NOT fetched from the DB at request time) so
 * that each article can be statically generated, crawled, and indexed by search
 * engines. Each entry targets a specific long-tail keyword search intent
 * (e.g. "how to build a SaaS with AI", "v0 vs Lovable vs AINative",
 * "what is AX optimization").
 *
 * Keep this list in sync with:
 *   - app/guides/[slug]/page.tsx (generateStaticParams reads GUIDE_SLUGS)
 *   - app/guides/page.tsx (renders the index of GUIDES)
 *   - app/sitemap.ts (emits one URL per slug)
 */

/** A single content section rendered as an <h2> + paragraphs on the article. */
export interface GuideSection {
  /** Section heading (rendered as <h2>). */
  heading: string
  /** One or more paragraphs of body copy. */
  paragraphs: string[]
  /** Optional bullet list rendered under the paragraphs. */
  bullets?: string[]
}

/** A frequently-asked question rendered on the page + emitted as FAQ JSON-LD. */
export interface GuideFaq {
  question: string
  answer: string
}

export interface SeoGuide {
  /** URL slug — must be unique and URL-safe. */
  slug: string
  /** Article title (used as <h1> + <title>). */
  title: string
  /** Short one-line summary (used in cards + meta description). */
  excerpt: string
  /** Top-level content category, shown as a badge and used for grouping. */
  category: 'Tutorial' | 'Comparison' | 'Concept' | 'Best Practices'
  /** SEO keywords for <meta keywords> + JSON-LD. */
  keywords: string[]
  /** Short tags shown as pills + used for "related" grouping. */
  tags: string[]
  /** Estimated read time in minutes (shown in the byline). */
  readTimeMinutes: number
  /** ISO date the article was published (used in metadata + JSON-LD). */
  datePublished: string
  /** ISO date the article was last updated. */
  dateModified: string
  /** A single-sentence lede shown under the title. */
  intro: string
  /** The ordered body sections of the article. */
  sections: GuideSection[]
  /** FAQ entries — rendered on the page and emitted as FAQPage JSON-LD. */
  faqs: GuideFaq[]
}

export const GUIDES: SeoGuide[] = [
  {
    slug: 'how-to-build-a-saas-with-ai',
    title: 'How to Build a SaaS with AI (2026 Step-by-Step Guide)',
    excerpt:
      'A practical, end-to-end walkthrough for shipping a production SaaS using AI app builders — from idea to auth, database, payments, and deploy.',
    category: 'Tutorial',
    keywords: [
      'how to build a SaaS with AI',
      'build a SaaS with AI',
      'AI SaaS builder',
      'build a SaaS app fast',
      'no-code SaaS with AI',
      'AI app builder tutorial',
    ],
    tags: ['SaaS', 'Tutorial', 'AI', 'Full-stack', 'Deployment'],
    readTimeMinutes: 9,
    datePublished: '2026-01-15',
    dateModified: '2026-08-01',
    intro:
      'You no longer need a full engineering team to launch a SaaS. With an AI app builder you can go from a one-line prompt to a deployed, multi-page product in an afternoon. This guide shows you exactly how.',
    sections: [
      {
        heading: 'Start with a sharp problem, not a feature list',
        paragraphs: [
          'The single biggest predictor of a successful SaaS is a clearly-defined problem for a specific audience. Before you write a single prompt, describe your product in one sentence: who it is for, the painful job they are hiring it to do, and the outcome they get. AI builders are exceptionally good at turning a crisp description into working UI, but they cannot invent product-market fit for you.',
          'Write the sentence down, then expand it into a short spec: the three core screens, the key data objects, and the one action that delivers value. That spec becomes the prompt you feed the builder.',
        ],
      },
      {
        heading: 'Generate the UI from a prompt',
        paragraphs: [
          'Open AINative Builder and describe your app in plain English — for example, "a project management app with a dashboard, a kanban board, and a settings page." The builder streams back real, editable React code using production components (shadcn/ui), not throwaway mockups. Because the output is real code, you can iterate: ask for a dark mode, add a filter, or change the layout, and the diff is applied live.',
          'Work screen by screen. Generate the dashboard, review it in the live preview, then move to the next screen. Small, focused prompts produce cleaner code than one giant prompt trying to build everything at once.',
        ],
        bullets: [
          'Describe one screen per prompt for the cleanest output',
          'Use the live preview to verify each iteration before moving on',
          'Ask for accessibility and responsive behavior explicitly',
        ],
      },
      {
        heading: 'Add a database and real data',
        paragraphs: [
          'A SaaS needs to persist data. AINative Builder wires generated apps to a hosted data layer (ZeroDB) so your CRUD screens actually read and write live records instead of using hardcoded arrays. Describe your entities — "users have projects, projects have tasks" — and let the builder scaffold the schema and the queries.',
          'Keep your data model small at first. Ship with the two or three objects that deliver the core value, and add more once real users tell you what is missing.',
        ],
      },
      {
        heading: 'Layer in auth, payments, and deploy',
        paragraphs: [
          'Authentication and billing are the two pieces every SaaS shares. Add sign-in, gate the app behind a login, and connect a payments provider for subscriptions. Then deploy — a single click ships your app to a public URL with automatic HTTPS, so you can share it with your first users the same day.',
          'Because the builder emits standard React and exports open-source code, you are never locked in: you can keep iterating inside the builder or take the codebase and run it anywhere.',
        ],
        bullets: [
          'Gate the app behind authentication before launch',
          'Start with a single paid plan; add tiers later',
          'Deploy early and iterate against real usage',
        ],
      },
    ],
    faqs: [
      {
        question: 'Can I really build a SaaS with AI without coding?',
        answer:
          'Yes. AI app builders like AINative Builder generate real, production-ready React code from plain-English prompts, so you can build and ship a functional SaaS without writing code yourself. Because the output is standard code, developers can also jump in and customize it at any point.',
      },
      {
        question: 'How long does it take to build a SaaS with an AI builder?',
        answer:
          'A focused MVP with a few screens, a database, auth, and deploy can be built in an afternoon. The timeline depends mostly on how clearly you have defined the problem and the core screens before you start prompting.',
      },
      {
        question: 'Will I be locked into the AI builder?',
        answer:
          'Not with AINative Builder. It emits open-source React code that you own and can export, so you can continue in the builder or take the codebase and host it independently.',
      },
    ],
  },
  {
    slug: 'v0-vs-lovable-vs-ainative',
    title: 'v0 vs Lovable vs AINative: The 2026 AI App Builder Comparison',
    excerpt:
      'An honest, feature-by-feature comparison of v0, Lovable, and AINative Builder across models, SEO, agent optimization, pricing, and code ownership.',
    category: 'Comparison',
    keywords: [
      'v0 vs Lovable vs AINative',
      'v0 vs Lovable',
      'Lovable alternative',
      'v0 alternative',
      'best AI app builder 2026',
      'AI UI generator comparison',
    ],
    tags: ['Comparison', 'v0', 'Lovable', 'AINative', 'AI builders'],
    readTimeMinutes: 8,
    datePublished: '2026-02-10',
    dateModified: '2026-08-01',
    intro:
      'v0, Lovable, and AINative Builder all turn prompts into apps — but they make very different trade-offs. Here is how they compare on the things that actually matter when you ship real products.',
    sections: [
      {
        heading: 'Model choice: one model vs many',
        paragraphs: [
          'v0 and Lovable are effectively single-model tools — you get whatever frontier model they have wired up, with little say in the matter. AINative Builder is multi-model: you can generate with Claude, Qwen, Gemma, or DeepSeek and pick the model that best fits the task and your budget. That flexibility matters because different models excel at different kinds of generation, and pricing varies widely.',
        ],
        bullets: [
          'v0: single hosted model',
          'Lovable: single hosted model',
          'AINative: multi-model (Claude, Qwen, Gemma, DeepSeek)',
        ],
      },
      {
        heading: 'SEO and structured data',
        paragraphs: [
          'Most AI builders produce client-rendered apps with no consideration for search engines. AINative Builder is different: it generates SEO-friendly output with automatic JSON-LD structured data and a sitemap, so the apps and landing pages you ship can actually be found. If organic discovery matters to your product, this is a decisive difference.',
        ],
      },
      {
        heading: 'Agent optimization (AX)',
        paragraphs: [
          'AINative Builder includes built-in AX (Agent Experience) scoring — it evaluates how well your generated app can be operated by AI agents, not just humans. As more traffic becomes agent-driven, shipping agent-accessible interfaces becomes a real advantage. Neither v0 nor Lovable offers this today.',
        ],
      },
      {
        heading: 'Code ownership and pricing',
        paragraphs: [
          'AINative Builder emits open-source React code you fully own and can export, whereas v0 and Lovable keep you closer to their platforms. On price, all three offer an entry point and paid tiers; AINative starts with a 7-day trial on the Hobbyist plan with professional plans from $49/mo. The right choice depends on whether you value multi-model flexibility, SEO, and agent optimization — the areas where AINative pulls ahead.',
        ],
      },
    ],
    faqs: [
      {
        question: 'What is the main difference between v0, Lovable, and AINative?',
        answer:
          'v0 and Lovable are single-model builders focused on fast UI generation. AINative Builder adds multi-model AI (Claude, Qwen, Gemma, DeepSeek), automatic SEO with structured data, built-in AX (agent) optimization, and open-source code ownership.',
      },
      {
        question: 'Which AI app builder is best for SEO?',
        answer:
          'AINative Builder is built for SEO — it generates automatic JSON-LD structured data and sitemaps so your apps and landing pages are crawlable and indexable. v0 and Lovable do not provide built-in SEO tooling.',
      },
      {
        question: 'Is AINative a good v0 or Lovable alternative?',
        answer:
          'Yes. AINative is a strong alternative for teams that want multi-model flexibility, agent-optimized output, automatic SEO, and full ownership of open-source code — capabilities that v0 and Lovable do not offer.',
      },
    ],
  },
  {
    slug: 'what-is-ax-optimization',
    title: 'What Is AX Optimization? A Guide to Agent Experience',
    excerpt:
      'AX (Agent Experience) optimization makes your app usable by AI agents, not just people. Learn what it is, why it matters, and how to score well.',
    category: 'Concept',
    keywords: [
      'what is AX optimization',
      'AX optimization',
      'agent experience',
      'agent accessibility',
      'AI agent optimization',
      'agentic web',
    ],
    tags: ['AX', 'Concept', 'Agents', 'Accessibility', 'SEO'],
    readTimeMinutes: 6,
    datePublished: '2026-03-05',
    dateModified: '2026-08-01',
    intro:
      'AX — Agent Experience — is the discipline of designing software so that AI agents can perceive, understand, and operate it reliably. It is fast becoming as important as UX and SEO.',
    sections: [
      {
        heading: 'From UX and SEO to AX',
        paragraphs: [
          'For two decades we optimized for two audiences: humans (UX) and search-engine crawlers (SEO). A third audience is now arriving at scale — autonomous AI agents that browse, click, fill forms, and complete tasks on a user\'s behalf. AX optimization is the practice of making sure those agents can succeed. A site that is beautiful to a human but opaque to an agent will lose traffic and transactions as agent-driven usage grows.',
        ],
      },
      {
        heading: 'What makes an app agent-accessible',
        paragraphs: [
          'Agent accessibility overlaps heavily with good accessibility and good SEO, but adds its own requirements. Agents rely on semantic structure, predictable interactions, machine-readable metadata, and stable, well-labeled actions to navigate an interface without a human in the loop.',
        ],
        bullets: [
          'Semantic HTML with clear landmarks and headings',
          'Descriptive, stable labels on every actionable element',
          'Machine-readable structured data (JSON-LD) describing the page',
          'Predictable, non-flaky interactions and states',
          'Documented APIs or endpoints agents can call directly',
        ],
      },
      {
        heading: 'How AX scoring works',
        paragraphs: [
          'An AX score evaluates a page against these criteria and returns a rating that tells you how well an agent could operate it. AINative Builder includes built-in AX scoring so that every app you generate is measured for agent-accessibility as you build — surfacing gaps like missing labels or absent structured data before you ship, rather than after an agent fails to complete a task.',
          'Treat the AX score the way you treat a Lighthouse score: a fast, actionable signal you improve iteratively.',
        ],
      },
      {
        heading: 'Why it matters now',
        paragraphs: [
          'Agent traffic is compounding. Assistants and autonomous agents increasingly complete purchases, bookings, and workflows directly. Products that are agent-ready capture that demand; products that are not become invisible to it. Optimizing for AX today is the same strategic bet that optimizing for mobile or for search was in earlier eras.',
        ],
      },
    ],
    faqs: [
      {
        question: 'What does AX optimization mean?',
        answer:
          'AX (Agent Experience) optimization is the practice of designing an app so AI agents can perceive, understand, and operate it reliably — using semantic structure, stable labels, machine-readable metadata, and predictable interactions.',
      },
      {
        question: 'How is AX different from SEO and accessibility?',
        answer:
          'SEO optimizes for search crawlers and accessibility optimizes for humans with assistive technology. AX builds on both but targets autonomous AI agents that navigate and complete tasks without a human, adding requirements like machine-readable actions and structured data.',
      },
      {
        question: 'How do I measure my AX score?',
        answer:
          'AINative Builder includes built-in AX scoring that evaluates generated apps against agent-accessibility criteria and surfaces gaps like missing labels or structured data as you build, so you can fix them before shipping.',
      },
    ],
  },
  {
    slug: 'ai-app-builder-seo-best-practices',
    title: 'SEO Best Practices for AI-Generated Apps',
    excerpt:
      'AI builders ship fast — but do your generated apps rank? Follow these SEO best practices to make AI-generated apps crawlable, indexable, and discoverable.',
    category: 'Best Practices',
    keywords: [
      'AI app builder SEO',
      'SEO for AI-generated apps',
      'SEO best practices',
      'structured data JSON-LD',
      'indexable single page app',
      'sitemap for web app',
    ],
    tags: ['SEO', 'Best Practices', 'JSON-LD', 'Sitemap', 'Structured data'],
    readTimeMinutes: 7,
    datePublished: '2026-04-20',
    dateModified: '2026-08-01',
    intro:
      'Speed is only half the battle. If search engines cannot crawl and understand your AI-generated app, it will not rank. Here are the SEO fundamentals that make generated apps discoverable.',
    sections: [
      {
        heading: 'Render content so crawlers can read it',
        paragraphs: [
          'Many AI builders produce purely client-rendered apps where the initial HTML is nearly empty and everything appears only after JavaScript runs. Crawlers can struggle with that. Prefer output that server-renders or statically generates your key marketing and content pages so the important text and links are in the initial HTML. AINative Builder favors indexable output for the pages that matter for discovery.',
        ],
      },
      {
        heading: 'Give every important page its own URL',
        paragraphs: [
          'Search engines index URLs, not tabs or modals. Each distinct piece of content — a template, a comparison, an article — should live at its own crawlable URL with a unique title and meta description. This is why AINative Builder generates individually indexable pages for templates, comparisons, and guides rather than hiding them behind client-side state.',
        ],
        bullets: [
          'One URL per indexable piece of content',
          'Unique <title> and meta description per page',
          'A canonical URL to avoid duplicate-content dilution',
        ],
      },
      {
        heading: 'Add structured data (JSON-LD)',
        paragraphs: [
          'Structured data tells search engines exactly what a page is — an article, a FAQ, a product, a breadcrumb trail — and unlocks rich results. Emit JSON-LD for your content types. AINative Builder adds JSON-LD automatically (Article, FAQPage, BreadcrumbList, SoftwareApplication) so your generated pages are eligible for enhanced search listings without manual effort.',
        ],
      },
      {
        heading: 'Ship a sitemap and internal links',
        paragraphs: [
          'A sitemap helps crawlers discover every URL, and internal links spread authority and help both users and crawlers navigate. Make sure new content is added to your sitemap and cross-linked from related pages. AINative Builder maintains a sitemap and encourages internal linking between related content, so newly published pages are found quickly.',
        ],
        bullets: [
          'Keep an up-to-date sitemap.xml',
          'Cross-link related pages (e.g. related articles and templates)',
          'Use descriptive anchor text, not "click here"',
        ],
      },
    ],
    faqs: [
      {
        question: 'Do AI-generated apps rank in search engines?',
        answer:
          'They can — but only if they are crawlable. Apps that render content server-side or statically, give each page a unique URL and metadata, emit structured data, and ship a sitemap are far more likely to be indexed and ranked. AINative Builder produces this kind of SEO-friendly output.',
      },
      {
        question: 'What structured data should my app include?',
        answer:
          'Common, high-value types are Article for content, FAQPage for question-and-answer sections, BreadcrumbList for navigation, and SoftwareApplication for product pages. AINative Builder emits these as JSON-LD automatically.',
      },
      {
        question: 'Why does each page need its own URL for SEO?',
        answer:
          'Search engines index URLs, not client-side tabs or modals. Giving every important piece of content a unique, crawlable URL with its own title and description is what lets it appear as a distinct result in search.',
      },
    ],
  },
]

/** All guide slugs — used by generateStaticParams and the sitemap. */
export const GUIDE_SLUGS = GUIDES.map((g) => g.slug)

/** Look up a guide by its URL slug. */
export function getGuideBySlug(slug: string): SeoGuide | undefined {
  return GUIDES.find((g) => g.slug === slug)
}
