import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { detectRootComponent } from '@/lib/component-detector'

function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64')
}

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()
    const nonce = generateNonce()

    if (!code) {
      return NextResponse.json({ error: 'No code provided' }, { status: 400 })
    }

    // Extract the React component code from the markdown
    const codeMatch = code.match(/```(?:typescript|tsx|jsx|javascript|js)?\n([\s\S]*?)```/);
    let componentCode = codeMatch ? codeMatch[1] : code;

    // Detect the root component BEFORE stripping exports (same approach as
    // app/api/preview/[id]/route.ts, via lib/component-detector.ts). The old
    // `.replace(/export\s+default\s+/g, 'const Component = ')` only handled an
    // `export default` immediately followed by the component itself — a root
    // exported only via a bare `export { Name }` list, or `export default Name`
    // referencing a component declared earlier in the file, left `Component`
    // undefined and crashed the preview (the same bug class as #1523/#1596).
    const detection = detectRootComponent(componentCode)
    if (detection.rewrite && componentCode.includes(detection.rewrite.find)) {
      componentCode = componentCode.replace(detection.rewrite.find, detection.rewrite.replace)
    }
    const detectedComponentName = detection.name || 'App'
    // Strip export statements (not just `export default`) so e.g. a trailing
    // `export { Name }` list doesn't survive into the non-module <script> below,
    // where any top-level `export` keyword is a hard SyntaxError.
    componentCode = componentCode
      .replace(/export\s+default\s+/g, '')
      .replace(/export\s+/g, '')

    // Create a simple HTML page that renders the React component
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Component Preview</title>
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
          'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
          sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      #root {
        width: 100%;
        height: 100vh;
      }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="text/babel">
      ${componentCode}

      const Component = ${detectedComponentName};

      const App = () => {
        return <Component />
      }

      ReactDOM.render(<App />, document.getElementById('root'));
    </script>
</body>
</html>
    `.trim();

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Security-Policy': `default-src 'self'; script-src 'unsafe-eval' 'nonce-${nonce}' https://cdn.tailwindcss.com https://unpkg.com; style-src 'nonce-${nonce}' https://cdn.tailwindcss.com; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://cdn.tailwindcss.com;`,
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      },
    });
  } catch (error) {
    console.error('Preview generation error:', error);
    return NextResponse.json({ error: 'Failed to generate preview' }, { status: 500 });
  }
}

export async function GET() {
  // Return a simple message for GET requests
  return NextResponse.json({ message: 'Use POST to generate preview' });
}