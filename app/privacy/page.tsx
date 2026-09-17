/**
 * /privacy — Privacy Policy for AINative Builder
 *
 * Refs #794: builder.ainative.studio had no public Privacy Policy of its own
 * — see app/terms/page.tsx's docstring for the full Twilio A2P 10DLC context
 * (campaign QE2c6890da8086d771620e9b13fadeba0b rejected for an unverifiable
 * PRIVACY_POLICY_URL, error 30908). This page states explicitly, per Twilio's
 * carrier-review requirements, that mobile opt-in/phone number data collected
 * for the SMS feature is never shared with third parties for marketing.
 *
 * SSR, Modernist chrome (matches /about, /help, /terms) — must stay on the
 * middleware's public allowlist so it renders for anonymous visitors and for
 * automated carrier/compliance review, not just logged-in founders.
 */

import type { Metadata } from 'next'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'

const PAGE_URL = 'https://builder.ainative.studio/privacy'
const ORG_NAME = 'AINative Studio'
const LAST_UPDATED = '2026-09-17'

export const metadata: Metadata = {
  title: 'Privacy Policy | AINative Builder',
  description:
    'Privacy Policy for AINative Builder: what data we collect, including phone numbers and SMS message content for Cody, and how it is used, stored, and never sold or shared for marketing.',
  alternates: {
    canonical: PAGE_URL,
  },
  openGraph: {
    title: 'Privacy Policy | AINative Builder',
    description:
      'What AINative Builder collects, how it is used, and your rights — including SMS/phone data collected for Cody.',
    type: 'website',
  },
}

const webPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Privacy Policy | AINative Builder',
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

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p className="m-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Last updated {new Date(LAST_UPDATED).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </header>

        <Section eyebrow="01" title="Overview">
          <p>
            This Privacy Policy describes how AINative Builder (&quot;Builder,&quot; &quot;we,&quot;
            &quot;us&quot;), a product of AINative Studio / AINative Lab, Inc., collects, uses, and
            protects information when you use builder.ainative.studio, including when you interact
            with Cody, our AI co-founder, by chat or by text message (SMS).
          </p>
        </Section>

        <Section eyebrow="02" title="Information we collect">
          <ul style={{ paddingLeft: 20, listStyle: 'disc' }}>
            <li style={{ marginBottom: 8 }}>
              <strong>Account information</strong> — name, email address, and authentication data
              when you create an account.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Company &amp; application data</strong> — the ideas, prompts, and content you
              provide to Cody, and the application and business data generated for your company.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Phone number and SMS content</strong> — if you provision a phone number
              through Builder or text a number provisioned through the Service, we collect your
              phone number and the content of messages exchanged with Cody, in order to route and
              respond to your conversation.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Usage data</strong> — device information, log data, and analytics used to
              operate and improve the Service.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Payment information</strong> — processed by our payment provider (Stripe); we
              do not store full payment card numbers.
            </li>
          </ul>
        </Section>

        <Section eyebrow="03" title="SMS / mobile information">
          <p>
            <strong>
              No mobile information is shared with third parties or affiliates for marketing or
              promotional purposes.
            </strong>{' '}
            Phone numbers and SMS content collected through Cody&apos;s text-messaging feature are
            used solely to operate that feature — receiving your message, generating Cody&apos;s
            reply, and delivering it back to you. This information is not sold, rented, or shared
            with third parties for their own marketing.
          </p>
          <p style={{ marginTop: 12 }}>
            Sharing of information collected via SMS opt-in for the purposes of a text-to-land line
            or text-to-VoIP conversion is prohibited, and information collected will not be shared
            with any third party for such purposes, in accordance with applicable messaging
            industry guidelines.
          </p>
          <p style={{ marginTop: 12 }}>
            This messaging feature is provided using Twilio, our SMS infrastructure provider, which
            processes message content solely to deliver it. See{' '}
            <a
              href="https://www.twilio.com/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-accent)' }}
            >
              Twilio&apos;s Privacy Policy
            </a>{' '}
            for how Twilio itself handles data as our processor.
          </p>
        </Section>

        <Section eyebrow="04" title="How we use information">
          <p>We use the information we collect to:</p>
          <ul style={{ marginTop: 12, paddingLeft: 20, listStyle: 'disc' }}>
            <li style={{ marginBottom: 6 }}>Provide, operate, and maintain the Service, including Cody&apos;s chat and SMS features</li>
            <li style={{ marginBottom: 6 }}>Respond to your messages and requests</li>
            <li style={{ marginBottom: 6 }}>Improve and secure the Service</li>
            <li style={{ marginBottom: 6 }}>Comply with legal obligations</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            We do not use your prompts, code, or messages — including SMS content — to train AI
            models, consistent with AINative&apos;s platform-wide no-training policy.
          </p>
        </Section>

        <Section eyebrow="05" title="Information sharing">
          <p>We may share information with:</p>
          <ul style={{ marginTop: 12, paddingLeft: 20, listStyle: 'disc' }}>
            <li style={{ marginBottom: 6 }}>
              Service providers who perform services on our behalf (e.g. Twilio for SMS/voice,
              Stripe for payments), bound by confidentiality obligations
            </li>
            <li style={{ marginBottom: 6 }}>Law enforcement or government authorities when required by law</li>
            <li style={{ marginBottom: 6 }}>Other parties in connection with a business transaction (e.g. a merger)</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            We do not sell your personal information, and we do not share phone numbers or SMS
            content for marketing purposes, as described above.
          </p>
        </Section>

        <Section eyebrow="06" title="Data retention &amp; security">
          <p>
            We retain information for as long as needed to provide the Service and comply with our
            legal obligations. We use encryption in transit and at rest, access controls, and
            other reasonable safeguards to protect your information. No method of transmission or
            storage is 100% secure.
          </p>
        </Section>

        <Section eyebrow="07" title="Your rights &amp; choices">
          <ul style={{ paddingLeft: 20, listStyle: 'disc' }}>
            <li style={{ marginBottom: 8 }}>
              <strong>Opt out of SMS.</strong> Reply <span className="m-mono">STOP</span> to any
              text from a Builder-provisioned number to stop receiving messages at any time. Reply{' '}
              <span className="m-mono">HELP</span> for assistance.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Access, correction, deletion.</strong> Contact us to request a copy of your
              data, correct it, or request deletion.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>Account closure.</strong> You may close your account at any time from account
              settings or by contacting support.
            </li>
          </ul>
          <p style={{ marginTop: 12 }}>
            To exercise any of these rights, contact us at{' '}
            <a href="mailto:privacy@ainative.studio" style={{ color: 'var(--color-accent)' }}>
              privacy@ainative.studio
            </a>
            . We aim to respond within 30 days.
          </p>
        </Section>

        <Section eyebrow="08" title="Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be reflected
            by updating the &quot;Last updated&quot; date above.
          </p>
        </Section>

        <Section eyebrow="09" title="Contact">
          <p>
            Questions about this Privacy Policy? Contact us at{' '}
            <a href="mailto:privacy@ainative.studio" style={{ color: 'var(--color-accent)' }}>
              privacy@ainative.studio
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
