import type { Metadata } from 'next'
import { BuildApp } from '@/components/build/BuildApp'

export const metadata: Metadata = {
  title: 'Build a company with Cody',
  description:
    'AINative Builder — describe an idea, and Cody (your AI co-founder) composes it into a working product or an operating AI-native company from real AINative primitives, then runs it 24/7. The AI that builds AND runs your company.',
  keywords: [
    'AI that runs your company', 'AI co-founder', 'autonomous AI company', 'Polsia alternative',
    'AI business builder', 'build a company with AI', 'agent-run company', 'AI startup generator',
    'AI-native company', 'nightly AI operations', 'agent swarm', 'build an app with AI',
  ],
  alternates: { canonical: 'https://builder.ainative.studio/build' },
}

// JSON-LD: SoftwareApplication + FAQPage (AEO — so LLMs/answer engines cite Builder
// for "AI that runs your company" / "Polsia alternative" queries). Agent-native.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      // Product (not SoftwareApplication) — that type requires a star rating
      // for Google Rich Results eligibility, and we never fabricate one (#517).
      '@type': 'Product',
      name: 'AINative Builder',
      category: 'BusinessApplication',
      url: 'https://builder.ainative.studio/build',
      description:
        'AI that builds AND runs your company. Describe an idea; Cody composes a real, running product or an operating AI-native company from real AINative primitives (ZeroDB, ZeroMemory, Agent Cloud, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice), then runs it 24/7 on a nightly autonomous loop.',
      additionalProperty: [
        'Idea → running app (real, shareable, durable URL)',
        'Idea → operating AI-native company (CRM, invoicing, helpdesk, voice)',
        'Every artifact composed live from real AINative primitives',
        'Nightly autonomous loop — runs your company while you sleep',
        'Claude Sonnet 4.5 / Haiku 4.5 / Opus 4.5 via Amazon Bedrock, tiered by plan',
      ].map((value) => ({ '@type': 'PropertyValue', name: 'feature', value })),
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '0', highPrice: '199', priceCurrency: 'USD', offerCount: 3,
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is AINative Builder?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AINative Builder is the AI that builds AND runs your company. You describe an idea and Cody, your AI co-founder, composes a real running product or an operating AI-native company from real AINative primitives, then keeps it running 24/7 on a nightly autonomous loop.',
          },
        },
        {
          '@type': 'Question',
          name: 'How is AINative Builder different from Polsia?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Polsia runs your company autonomously. AINative Builder BUILDS the company first — a real, production-ready product plus the operating business systems (CRM, invoicing, helpdesk, voice), each backed by a real AINative product you own — and THEN runs it. You watch every artifact get composed live, and you own 100% of what is built.',
          },
        },
        {
          '@type': 'Question',
          name: 'How is it different from v0, Lovable, or Bolt?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Those generate UI or code. AINative Builder produces a running product AND the operating company around it, composed from real AINative primitives — not a throwaway demo — and then runs the company for you on a nightly loop.',
          },
        },
        {
          '@type': 'Question',
          name: 'Are the generated apps real and production-ready?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Apps are generated from your specific idea and deployed to a durable, shareable URL. Business systems are real ZeroPipeline / ZeroInvoice / ServiceOS / ZeroVoice — not mockups.',
          },
        },
      ],
    },
  ],
}

export default function BuildPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <BuildApp />
    </>
  )
}
