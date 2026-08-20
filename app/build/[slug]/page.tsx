import type { Metadata } from 'next'
import { resolveApp } from '@/lib/build/app-registry'

/**
 * /build/{slug} (#207 · FIX-2) — the REAL, shareable URL for a generated company
 * or app. Resolves the brand slug to its generated app's chatId and renders the
 * actual running app (served from /api/preview/{chatId}) in a branded frame.
 * Replaces the dead {slug}.ainative.studio subdomain — no DNS, works immediately.
 */

export const runtime = 'nodejs'

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const entry = await resolveApp(slug).catch(() => null)
  const name = entry?.name || slug
  return {
    title: entry ? `${name} — built on AINative` : `${slug} — AINative Builder`,
    description: entry?.tagline || `${name}, built and run on AINative.`,
    alternates: { canonical: `https://builder.ainative.studio/build/${slug}` },
  }
}

export default async function AppSubdirPage({ params }: Props) {
  const { slug } = await params
  const entry = await resolveApp(slug).catch(() => null)
  const color = entry?.color && /^#[0-9a-fA-F]{6}$/.test(entry.color) ? entry.color : '#2f6d86'

  if (!entry?.chatId) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', background: '#f3f2f2' }}>
        <div style={{ textAlign: 'center', maxWidth: 460, padding: 24 }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#7d7979' }}>AINATIVE BUILDER</div>
          <h1 style={{ fontSize: 28, margin: '10px 0' }}>This preview is still being built.</h1>
          <p style={{ color: '#444' }}>
            Cody is composing <strong>{slug}</strong>. Start your own at{' '}
            <a href="/build" style={{ color }}>builder.ainative.studio/build</a>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '2px solid #d7d3d3', background: '#151312', color: '#fff' }}>
        <span style={{ width: 22, height: 22, background: color, display: 'inline-block' }} />
        <strong style={{ fontFamily: 'Georgia, serif' }}>{entry.name || slug}</strong>
        {entry.tagline && <span style={{ color: '#cfc9c4', fontSize: 13 }}>· {entry.tagline}</span>}
        <a href="/build" style={{ marginLeft: 'auto', color: '#ec3013', fontFamily: 'ui-monospace, monospace', fontSize: 12, textDecoration: 'none' }}>
          built on AINative ↗
        </a>
      </header>
      <iframe
        src={`/api/preview/${entry.chatId}`}
        title={entry.name || slug}
        style={{ flex: 1, border: 0, width: '100%' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
      />
    </div>
  )
}
