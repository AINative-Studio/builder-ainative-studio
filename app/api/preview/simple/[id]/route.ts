import { NextRequest, NextResponse } from 'next/server'
import { getPreview } from '@/lib/preview-store'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const content = getPreview(id)

  if (!content) {
    return NextResponse.json({ error: 'Preview not found' }, { status: 404 })
  }

  // Extract the FIRST React component code block
  const codeMatch = content.match(/```(?:typescript|tsx|jsx|javascript|js)?\n([\s\S]*?)```/)
  const rawCode = codeMatch ? codeMatch[1] : ''

  // Simple cleanup - just remove imports and TypeScript types
  const componentCode = rawCode
    .replace(/import\s+.*?from\s+['"].*?['"]\s*;?\s*/g, '')
    .replace(/export\s+default\s+/g, '')
    .replace(/:\s*\w+/g, '') // Remove ALL type annotations
    .replace(/interface\s+\w+\s*{[^}]*}/g, '')
    .replace(/type\s+\w+\s*=\s*{[^}]*}/g, '')

  // Create a super simple HTML page
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Component Preview</title>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
    <div id="root"></div>
    <script type="text/babel">
      const { useState, useEffect, useCallback, useMemo, useRef } = React;

      // Define sample data
      const products = [
        { id: 1, name: 'Product 1', price: 29.99 },
        { id: 2, name: 'Product 2', price: 39.99 }
      ];

      try {
        ${componentCode}

        // Try to find and render a component
        let ComponentToRender = null;

        // Check if Counter exists (most common for tests)
        if (typeof Counter !== 'undefined') {
          ComponentToRender = Counter;
        } else if (typeof App !== 'undefined') {
          ComponentToRender = App;
        } else if (typeof Component !== 'undefined') {
          ComponentToRender = Component;
        } else {
          // If no component found, show message
          ComponentToRender = () => React.createElement('div', {
            style: { padding: '20px', textAlign: 'center' }
          }, 'No component found. Try generating a simpler component.');
        }

        // Render the component
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(ComponentToRender));

      } catch (error) {
        document.getElementById('root').innerHTML =
          '<div style="padding: 20px; color: red;">Error: ' + error.message + '</div>';
        console.error('Component error:', error);
      }
    </script>
</body>
</html>
  `.trim()

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache',
    },
  })
}