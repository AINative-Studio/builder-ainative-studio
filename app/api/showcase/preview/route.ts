import { NextRequest } from 'next/server'
import { SEED_SHOWCASE } from '@/lib/showcase-data'
import { getDynamicShowcase } from '@/lib/showcase-store'

/**
 * GET /api/showcase/preview?slug=xxx
 * Returns the generated code for a showcase entry (for iframe rendering)
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) {
    return new Response('Missing slug', { status: 400 })
  }

  // Find entry in seed or dynamic
  const entry = SEED_SHOWCASE.find(e => e.slug === slug) ||
    getDynamicShowcase().find(e => e.slug === slug)

  if (!entry) {
    return new Response('Not found', { status: 404 })
  }

  // If the entry has a chatId, redirect to the existing preview API
  if (entry.chatId) {
    return Response.redirect(new URL(`/api/preview/${entry.chatId}`, request.url))
  }

  // If the entry has stored generated code in memory, render it
  if (entry.generatedCode) {
    const html = renderReactPreview(entry.generatedCode, entry.title)
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Try loading from ZeroDB (seed entries stored with chat_id = "showcase-{slug}")
  try {
    const { loadGeneration } = await import('@/lib/zerodb-store')
    const gen = await loadGeneration(`showcase-${slug}`)
    if (gen?.generatedCode) {
      const html = renderReactPreview(gen.generatedCode, entry.title)
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
  } catch (_) {}

  // No preview available
  return new Response(`
    <html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#666">
      <div style="text-align:center">
        <p>Preview not available yet</p>
        <a href="/?prompt=${encodeURIComponent(entry.prompt)}" style="color:#3b82f6">Generate this app</a>
      </div>
    </body></html>
  `, { headers: { 'Content-Type': 'text/html' } })
}

function renderReactPreview(code: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — AINative Builder Preview</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    ${code}
    const App = window.App || window.default || Object.values(window).find(v => typeof v === 'function' && v.toString().includes('createElement'));
    if (App) ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  <\/script>
</body>
</html>`
}
