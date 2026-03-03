import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()

    if (!code) {
      return NextResponse.json({ error: 'No code provided' }, { status: 400 })
    }

    // Extract the React component code from the markdown
    const codeMatch = code.match(/```(?:typescript|tsx|jsx|javascript|js)?\n([\s\S]*?)```/);
    const componentCode = codeMatch ? codeMatch[1] : code;

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
      ${componentCode.replace(/export\s+default\s+/g, 'const Component = ')}

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
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-eval' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com; style-src 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self';",
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'X-XSS-Protection': '1; mode=block',
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