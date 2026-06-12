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
      headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com; style-src 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://cdn.tailwindcss.com;",
          'X-Frame-Options': 'SAMEORIGIN',
        },
    })
  }

  // Try loading from ZeroDB (seed entries stored with chat_id = "showcase-{slug}")
  try {
    const { loadGeneration } = await import('@/lib/zerodb-store')
    const gen = await loadGeneration(`showcase-${slug}`)
    if (gen?.generatedCode) {
      const html = renderReactPreview(gen.generatedCode, entry.title)
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com; style-src 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://cdn.tailwindcss.com;",
          'X-Frame-Options': 'SAMEORIGIN',
        },
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

function renderReactPreview(rawCode: string, title: string): string {
  // Extract code from markdown if wrapped
  const codeMatch = rawCode.match(/```(?:typescript|tsx|jsx|javascript|js)?\n([\s\S]*?)```/)
  let code = codeMatch ? codeMatch[1] : rawCode

  // Handle export default — convert to named assignment
  code = code.replace(/export\s+default\s+function\s+(\w+)/g, 'function $1')
  code = code.replace(/export\s+default\s+/g, 'const __DefaultComponent__ = ')

  // Find the main component name
  const componentMatch = code.match(/(?:function|const)\s+([A-Z]\w+)/)
  const componentName = componentMatch ? componentMatch[1] : '__DefaultComponent__'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #root { width: 100%; min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useMemo, useCallback, useRef } = React;
    ${code}
    try {
      const App = ${componentName} || window.${componentName};
      if (App) ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    } catch(e) {
      document.getElementById('root').innerHTML = '<div style="padding:2rem;color:#666">Preview loading error: ' + e.message + '</div>';
    }
  <\/script>
</body>
</html>`
}
