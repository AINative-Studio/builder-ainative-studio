/**
 * /terms — Terms of Service for AINative Builder
 *
 * Refs #794: builder.ainative.studio had no public ToS/Privacy of its own —
 * both paths fell through to the auth-gated catch-all and 307'd to /login.
 * This is the real gap that blocked Twilio's A2P 10DLC campaign review
 * (errors 30882/30908: unverifiable TERMS_AND_CONDITIONS_URL /
 * PRIVACY_POLICY_URL for the Cody SMS campaign, sid
 * QE2c6890da8086d771620e9b13fadeba0b) — carriers could not resolve a public,
 * unauthenticated legal page for the product actually sending the texts.
 *
 * SSR, Modernist chrome (matches /about, /help, /pricing) — must stay on the
 * middleware's public allowlist so it renders for anonymous visitors and for
 * Twilio's/carriers' automated review, not just logged-in founders.
 */

import type { Metadata } from 'next'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'

const PAGE_URL = 'https://builder.ainative.studio/terms'
const ORG_NAME = 'AINative Studio'
const LAST_UPDATED = '2026-09-17'

export const metadata: Metadata = {
  title: 'Terms of Service | AINative Builder',
  description:
    'Terms of Service for AINative Builder, including SMS/text messaging terms for Cody, the AI co-founder that replies to founders by text.',
  alternates: {
    canonical: PAGE_URL,
  },
  openGraph: {
    title: 'Terms of Service | AINative Builder',
    description:
      'Terms of Service for AINative Builder, including SMS/text messaging terms for Cody.',
    type: 'website',
  },
}

const webPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Terms of Service | AINative Builder',
  url: PAGE_URL,
  dateModified: LAST_UPDATED,
  publisher: {
    '@type': 'Organization',
    name: ORG_NAME,
    url: 'https://ainative.studio',
  },
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 48 }}>
      <p className="m-eyebrow" style={{ marginBottom: 8 }}>
        {eyebrow}
      </p>
      <h2 className="m-h2">{title}</h2>
      <div
        style={{
          fontSize: 15.5,
          lineHeight: 1.7,
          color: 'var(--color-text)',
          marginTop: 12,
        }}
      >
        {children}
      </div>
    </section>
  )
}

export default function TermsPage() {
  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />

      <PublicNav />

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '64px 24px 32px' }}>
        <header style={{ marginBottom: 56 }}>
          <p className="m-eyebrow" style={{ marginBottom: 12 }}>
            Legal
          </p>
          <h1 className="m-h1" style={{ fontSize: 'clamp(32px, 5vw, 52px)' }}>
            Terms of Service
          </h1>
          <p className="m-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Last updated {new Date(LAST_UPDATED).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </header>

        <Section eyebrow="01" title="Agreement to these terms">
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of AINative
            Builder (&quot;Builder,&quot; &quot;the Service&quot;), a product of AINative Studio
            / AINative Lab, Inc. (&quot;AINative,&quot; &quot;we,&quot; &quot;us&quot;). Builder
            lets you describe a product idea and have Cody, our AI co-founder, generate and run a
            real, working application on your behalf, composed from AINative&apos;s own
            infrastructure primitives.
          </p>
          <p style={{ marginTop: 12 }}>
            By creating an account, accessing builder.ainative.studio, or texting a phone number
            provisioned through the Service, you agree to be bound by these Terms. If you do not
            agree, do not use the Service.
          </p>
        </Section>

        <Section eyebrow="02" title="What Builder does">
          <p>
            Builder is a client of AINative&apos;s core platform. When you describe an idea, Cody
            generates application code and wires it to real, already-running AINative primitives
            (for example ZeroPipeline/CRM, ZeroCommerce, ZeroInvoice, ZeroVoice, ServiceOS,
            ZeroMemory) rather than hand-building business logic from scratch. You own the
            resulting application and the company it represents.
          </p>
        </Section>

        <Section eyebrow="03" title="SMS / text messaging terms — Cody">
          <p>
            If you provision a phone number through Builder (via ZeroVoice), Cody can send and
            receive SMS text messages with you as part of the Service — for example, replying to a
            question about your company&apos;s status, or confirming a task Cody has queued.
          </p>
          <ul style={{ marginTop: 12, paddingLeft: 20, listStyle: 'disc' }}>
            <li style={{ marginBottom: 8 }}>
              <strong>Who sends these messages.</strong> Messages come from a phone number
              associated with your own AINative Builder company, sent by Cody on your behalf, not
              third-party marketing.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>What the messages are for.</strong> Cody sends conversational replies to
              founders who text their company&apos;s number for status updates, questions about
              their build, and to trigger backlog or build tasks. Builder does not use this
              channel to send marketing or promotional messages.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Message frequency.</strong> Message frequency varies based on your
              conversation with Cody.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Message and data rates.</strong> Message and data rates may apply, depending
              on your mobile carrier and plan.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Opting out.</strong> Reply <span className="m-mono">STOP</span>,{' '}
              <span className="m-mono">CANCEL</span>, <span className="m-mono">QUIT</span>,{' '}
              <span className="m-mono">OPTOUT</span>, <span className="m-mono">UNSUBSCRIBE</span>,{' '}
              <span className="m-mono">STOPALL</span>, or <span className="m-mono">REVOKE</span> at
              any time to stop receiving texts from that number. You will receive one final message
              confirming you have been unsubscribed, and will not receive further messages unless
              you opt back in.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Getting help.</strong> Reply <span className="m-mono">HELP</span> or{' '}
              <span className="m-mono">INFO</span> at any time for help. You can also reach us at{' '}
              <a href="mailto:support@ainative.studio" style={{ color: 'var(--color-accent)' }}>
                support@ainative.studio
              </a>
              .
            </li>
          </ul>
        </Section>

        <Section eyebrow="04" title="Accounts">
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activity under your account. You agree to provide accurate information when
            creating your account and to keep it up to date.
          </p>
        </Section>

        <Section eyebrow="05" title="Acceptable use">
          <p>You agree not to use Builder or the phone numbers it provisions to:</p>
          <ul style={{ marginTop: 12, paddingLeft: 20, listStyle: 'disc' }}>
            <li style={{ marginBottom: 6 }}>Send unsolicited marketing, spam, or bulk messages to third parties</li>
            <li style={{ marginBottom: 6 }}>Violate any applicable law, including telecom and messaging regulations (e.g. TCPA)</li>
            <li style={{ marginBottom: 6 }}>Impersonate any person or entity, or misrepresent your affiliation</li>
            <li style={{ marginBottom: 6 }}>Attempt to reverse engineer, disrupt, or gain unauthorized access to the Service</li>
          </ul>
        </Section>

        <Section eyebrow="06" title="Ownership">
          <p>
            The application Cody generates for you, and the data it stores through your own
            provisioned company resources, belong to you. AINative retains ownership of the
            underlying Builder platform, Cody, and the shared primitives the application is
            composed from.
          </p>
        </Section>

        <Section eyebrow="07" title="Disclaimer &amp; limitation of liability">
          <p>
            The Service is provided &quot;as is&quot; without warranties of any kind. To the
            maximum extent permitted by law, AINative is not liable for indirect, incidental, or
            consequential damages arising from your use of the Service, including any delay,
            non-delivery, or carrier filtering of SMS messages, which depends in part on factors
            outside our control (such as your mobile carrier).
          </p>
        </Section>

        <Section eyebrow="08" title="Changes to these terms">
          <p>
            We may update these Terms from time to time. Material changes will be reflected by
            updating the &quot;Last updated&quot; date above. Continued use of the Service after a
            change constitutes acceptance of the updated Terms.
          </p>
        </Section>

        <Section eyebrow="09" title="Contact">
          <p>
            Questions about these Terms? Contact us at{' '}
            <a href="mailto:legal@ainative.studio" style={{ color: 'var(--color-accent)' }}>
              legal@ainative.studio
            </a>{' '}
            or{' '}
            <a href="mailto:support@ainative.studio" style={{ color: 'var(--color-accent)' }}>
              support@ainative.studio
            </a>
            .
          </p>
          <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 14 }}>
            AINative Lab, Inc. — 1101 Pacific Avenue, Santa Cruz, CA 95060, United States.
          </p>
        </Section>
      </main>

      <PublicFooter />
    </div>
  )
}
