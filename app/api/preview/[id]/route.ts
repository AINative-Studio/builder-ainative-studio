import { NextRequest, NextResponse } from 'next/server'
import { getPreview, isPreviewStreaming } from '@/lib/preview-store'
import { validateJavaScriptCode } from '@/lib/code-validator'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const content = getPreview(id)

  if (!content) {
    // Return a helpful error page for expired previews
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-50 dark:bg-gray-900">
        <div class="min-h-screen flex items-center justify-center p-4">
          <div class="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
            <div class="mb-4">
              <svg class="w-16 h-16 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <h2 class="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Preview Expired</h2>
            <p class="text-gray-600 dark:text-gray-300 mb-4">
              This preview has been cleared from memory. Previews are stored temporarily and expire after 1 hour or when the server restarts.
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Chat ID: <code class="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">${id}</code>
            </p>
            <div class="space-y-2">
              <button
                onclick="window.parent.location.href = '/'"
                class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Start New Chat
              </button>
              <button
                onclick="window.parent.location.reload()"
                class="w-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
    return new NextResponse(errorHtml, {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // Extract all code blocks - handle both complete and streaming (incomplete) blocks
  // This regex is more flexible to handle streaming content
  const allCodeMatches = content.match(/```(?:typescript|tsx|jsx|javascript|js)?[\r\n]?([\s\S]*?)(?:```|$)/g)

  let codeMatch = null
  if (allCodeMatches && allCodeMatches.length > 0) {
    // Look for a code block that doesn't have imports (self-contained)
    const selfContainedBlock = allCodeMatches.find(block => {
      const blockContent = block.match(/```(?:typescript|tsx|jsx|javascript|js)?[\r\n]?([\s\S]*?)(?:```|$)/)
      return blockContent && !blockContent[1].includes('import {') && !blockContent[1].includes('from "@')
    })

    if (selfContainedBlock) {
      codeMatch = selfContainedBlock.match(/```(?:typescript|tsx|jsx|javascript|js)?[\r\n]?([\s\S]*?)(?:```|$)/)
    } else {
      // Fall back to the first block if no self-contained one found
      codeMatch = allCodeMatches[0].match(/```(?:typescript|tsx|jsx|javascript|js)?[\r\n]?([\s\S]*?)(?:```|$)/)
    }
  }

  let componentCode = ''

  if (!codeMatch || !codeMatch[1]) {
    // No markdown code blocks found - try using raw content
    // This happens when Tool Use API returns unwrapped code
    console.log('No code blocks found, using raw content for ID:', id)

    // Clean up malformed markdown wrappers like ""`jsx or ```jsx without proper closing
    let cleanedContent = content
      .replace(/^["'`]{1,3}`?(?:jsx|javascript|tsx|ts|js)\s*/i, '') // Remove opening wrapper including ""`jsx
      .replace(/["'`]{2,3}$/i, '') // Remove closing wrapper
      .trim()

    // Check if content looks like React/JSX code (contains function or const with JSX)
    if (cleanedContent.includes('function ') || (cleanedContent.includes('const ') && cleanedContent.includes('return'))) {
      componentCode = cleanedContent
    } else {
      // Still no valid code - return error
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2>No code found in content</h2>
          <p>The generated content doesn't contain any code blocks.</p>
          <details>
            <summary>Raw content</summary>
            <pre>${content.substring(0, 500)}</pre>
          </details>
        </body>
        </html>
      `
      return new NextResponse(errorHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  } else {
    componentCode = codeMatch[1]
  }

  // CRITICAL: Clean up malformed markdown wrappers that might be in the extracted code
  // This aggressively removes any combination of quotes/backticks at start and end
  componentCode = componentCode
    .replace(/^[\s\n\r]*["'`]{1,5}(?:jsx|javascript|tsx|ts|js)?[\s\n\r]*/gi, '') // Remove any wrapper at start
    .replace(/[\s\n\r]*["'`]{1,5}[\s\n\r]*$/gi, '') // Remove any wrapper at end
    .trim()

  // Double-check: if it still starts with weird chars, strip them
  componentCode = componentCode.replace(/^[^a-zA-Z/\s]*/, '')

  // Clean up the code
  componentCode = componentCode
    // Remove all imports
    .replace(/import\s+.*?from\s+['"].*?['"]\s*;?\s*/g, '')
    // Remove export statements
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+/g, '')
    // Remove TypeScript types (basic)
    .replace(/:\s*React\.FC<.*?>/g, '')
    .replace(/:\s*React\.FC/g, '')
    .replace(/:\s*any/g, '')
    .replace(/:\s*string/g, '')
    .replace(/:\s*number/g, '')
    .replace(/:\s*boolean/g, '')
    .replace(/interface\s+\w+\s*{[^}]*}/g, '')

  // Remove duplicate shadcn component declarations (they're already loaded from /shadcn-components.js)
  // This prevents "Identifier has already been declared" errors
  const shadcnComponents = ['Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter', 'Input', 'Label', 'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback', 'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell', 'Separator'];

  // Remove "Available Shadcn components" comment and everything after it
  componentCode = componentCode.replace(/\/\/\s*Available\s+Shadcn\s+components[\s\S]*/gi, '')

  // Remove individual component declarations
  shadcnComponents.forEach(comp => {
    // Remove const declarations like: const Button = ({ children }) => ...
    const constPattern = new RegExp(`const\\s+${comp}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*[\\s\\S]*?(?=\\n(?:const|function|class|let|var|$))`, 'g');
    componentCode = componentCode.replace(constPattern, '');

    // Remove function declarations like: function Button() { ... }
    const funcPattern = new RegExp(`function\\s+${comp}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'g');
    componentCode = componentCode.replace(funcPattern, '');
  });

  componentCode = componentCode.trim()

  // CRITICAL FIX: Convert template literals with interpolations to string concatenation
  // This prevents Babel from choking on ${} expressions in template literals
  // Example: className={`w-10 h-10 ${color} rounded`} -> className={`w-10 h-10 ` + color + ` rounded`}
  const templateLiteralRegex = /(className|style)=\{`([^`]*)`\}/g
  componentCode = componentCode.replace(templateLiteralRegex, (_match, attr, content) => {
    // Check if the content contains interpolations ${...}
    if (content.includes('${')) {
      // Split by ${...} expressions and convert to string concatenation
      const parts = content.split(/(\$\{[^}]+\})/)
      const convertedParts = parts.map((part: string) => {
        if (part.startsWith('${') && part.endsWith('}')) {
          // This is an interpolation like ${variable}
          return part.slice(2, -1).trim()
        } else if (part) {
          // This is a string literal part
          // Collapse multiple spaces but preserve leading/trailing spaces
          const cleaned = part.replace(/\s+/g, ' ')
          return cleaned ? `"${cleaned}"` : ''
        }
        return ''
      }).filter((p: string) => p !== '')

      // Join with + operator
      return `${attr}={${convertedParts.join(' + ')}}`
    } else {
      // No interpolation, just clean up whitespace
      const singleLine = content.replace(/\s+/g, ' ').trim()
      return `${attr}={\`${singleLine}\`}`
    }
  })

  // DISABLED: This quote-escaping logic was causing Babel syntax errors
  // by incorrectly escaping JSX attribute values like className="..."
  // The v0 API should already generate valid JSX, so this "fix" actually breaks correct code
  //
  // Previous issue: Regex matched JSX attributes and turned className="grid" into className=\"grid\"
  // which caused: Uncaught SyntaxError: Expecting Unicode escape sequence \uXXXX
  //
  // If AI-generated code has actual string literal issues, they should be fixed at the source
  // or with a proper JSX-aware parser, not naive regex replacements

  // // CRITICAL FIX: Escape unescaped quotes inside string literals
  // // This fixes AI-generated code with syntax errors like: name: 'MacBook Pro 16""'
  // // Strategy: Find string literals and escape conflicting quotes inside them

  // // Fix single-quoted strings containing unescaped double quotes or smart quotes
  // // Match: 'anything including " or " or "'
  // componentCode = componentCode.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, (match) => {
  //   // Inside single-quoted strings, escape any unescaped double quotes and smart quotes
  //   const inner = match.slice(1, -1) // Remove surrounding quotes
  //   const escaped = inner
  //     .replace(/(?<!\\)"/g, '\\"')     // Escape regular double quotes
  //     .replace(/"/g, '\\"')             // Escape left smart quote
  //     .replace(/"/g, '\\"')             // Escape right smart quote
  //   return `'${escaped}'`
  // })

  // // Fix double-quoted strings containing unescaped single quotes or smart quotes
  // // Match: "anything including ' or ' or '"
  // componentCode = componentCode.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
  //   // Inside double-quoted strings, escape any unescaped single quotes and smart quotes
  //   const inner = match.slice(1, -1) // Remove surrounding quotes
  //   const escaped = inner
  //     .replace(/(?<!\\)'/g, "\\'")     // Escape regular single quotes
  //     .replace(/'/g, "\\'")             // Escape left smart quote
  //     .replace(/'/g, "\\'")             // Escape right smart quote
  //   return `"${escaped}"`
  // })

  // Skip validation if still streaming (incomplete code)
  const streaming = isPreviewStreaming(id)
  if (!streaming) {
    // Only validate when streaming is complete
    const validation = validateJavaScriptCode(componentCode)
    if (!validation.valid) {
      console.error('Preview validation failed for ID:', id, 'Error:', validation.error)
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2>Code Validation Error</h2>
          <p>The generated code has syntax errors and cannot be rendered safely.</p>
          <pre style="background: #fee; padding: 15px; border-radius: 4px; color: #c00;">${validation.error}</pre>
          <details>
            <summary style="cursor: pointer; margin-top: 20px;">View problematic code</summary>
            <pre style="background: #f5f5f5; padding: 15px; margin-top: 10px; overflow: auto;">${componentCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
          </details>
          <p style="margin-top: 20px;"><a href="/">← Go back and try regenerating</a></p>
        </body>
        </html>
      `
      return new NextResponse(errorHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  } else {
    console.log(`Preview still streaming for ID: ${id}, skipping validation`)
  }

  // Create simple HTML with the component
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview</title>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/shadcn-components.js"></script>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="text/babel">
      console.log('[Preview] Starting preview initialization...');

      // Make React hooks available
      const { useState, useEffect, useCallback, useMemo, useRef } = React;
      console.log('[Preview] React hooks loaded:', { useState, useEffect, useCallback, useMemo, useRef });

      // Make shadcn components available
      const { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
              Input, Label, Badge, Avatar, AvatarImage, AvatarFallback, Table, TableHeader,
              TableBody, TableRow, TableHead, TableCell, Separator,
              Dialog, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
              Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
              Tabs, TabsList, TabsTrigger, TabsContent,
              Progress, CircularProgress, Checkbox, RadioGroup, RadioGroupItem,
              Accordion, AccordionItem, AccordionTrigger, AccordionContent,
              Toast, ToastTitle, ToastDescription,
              Alert, AlertTitle, AlertDescription,
              Popover, PopoverTrigger, PopoverContent,
              cn } = window.ShadcnComponents || {};

      // Check all shadcn components
      const allComponents = {
        Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
        Input, Label, Badge, Avatar, AvatarImage, AvatarFallback, Table, TableHeader,
        TableBody, TableRow, TableHead, TableCell, Separator,
        Dialog, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
        Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
        Tabs, TabsList, TabsTrigger, TabsContent,
        Progress, CircularProgress, Checkbox, RadioGroup, RadioGroupItem,
        Accordion, AccordionItem, AccordionTrigger, AccordionContent,
        Toast, ToastTitle, ToastDescription,
        Alert, AlertTitle, AlertDescription,
        Popover, PopoverTrigger, PopoverContent,
        cn
      };

      const missingComponents = Object.entries(allComponents)
        .filter(([name, comp]) => !comp)
        .map(([name]) => name);

      console.log('[Preview] Shadcn components loaded:', {
        Button: !!Button,
        Card: !!Card,
        Input: !!Input,
        Tabs: !!Tabs,
        TabsList: !!TabsList,
        TabsTrigger: !!TabsTrigger,
        TabsContent: !!TabsContent,
        Separator: !!Separator,
        cn: !!cn
      });

      if (missingComponents.length > 0) {
        console.error('[Preview] ✗ Missing shadcn components:', missingComponents);
      }

      // Sample data for components
      const products = [
        { id: 1, name: 'Product 1', price: 29.99, image: 'https://via.placeholder.com/200' },
        { id: 2, name: 'Product 2', price: 39.99, image: 'https://via.placeholder.com/200' }
      ];

      // Create an error boundary to catch React rendering errors
      class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { hasError: false, error: null, errorInfo: null };
        }

        static getDerivedStateFromError(error) {
          return { hasError: true };
        }

        componentDidCatch(error, errorInfo) {
          console.error('[Preview] React Error Boundary caught error:', error);
          console.error('[Preview] Error info:', errorInfo);
          this.setState({ error, errorInfo });
        }

        render() {
          if (this.state.hasError) {
            return React.createElement('div', {
              style: { padding: '20px', color: 'red', fontFamily: 'monospace' }
            }, [
              React.createElement('h3', { key: 'title' }, 'React Rendering Error'),
              React.createElement('pre', { key: 'error', style: { background: '#fee', padding: '10px', borderRadius: '4px' } },
                this.state.error?.toString() || 'Unknown error'
              ),
              React.createElement('details', { key: 'details' }, [
                React.createElement('summary', { key: 'summary' }, 'Component Stack'),
                React.createElement('pre', { key: 'stack', style: { fontSize: '11px', overflow: 'auto' } },
                  this.state.errorInfo?.componentStack || 'No stack trace'
                )
              ])
            ]);
          }
          return this.props.children;
        }
      }

      try {
        console.log('[Preview] Executing component code...');
        console.log('[Preview] Code length: ${componentCode.length} characters');

        // Insert the component code
        ${componentCode}

        console.log('[Preview] Component code executed successfully');

        // Auto-export any defined component functions to window for easier detection
        // This helps when components are defined as 'function Name()' without explicit window assignment
        const possibleComponentNames = ['LandingPage', 'Dashboard', 'ProjectDashboard', 'App', 'Component', 'Main', 'ProductCard', 'AdminPanel', 'EcommercePage', 'BlogPage', 'Counter', 'TodoList', 'ProductList', 'ShoppingCart'];
        possibleComponentNames.forEach(name => {
          try {
            // Use eval to check if the variable exists in current scope
            if (typeof eval(name) === 'function' && !window[name]) {
              window[name] = eval(name);
              console.log('[Preview] Auto-exported ' + name + ' to window');
            }
          } catch (e) {
            // Variable doesn't exist, skip
          }
        });

        // Find the component to render
        let Component = null;

        // Shadcn component names to exclude from search
        const shadcnComponentNames = [
          'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
          'Input', 'Label', 'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback',
          'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell',
          'Separator', 'Dialog', 'DialogOverlay', 'DialogContent', 'DialogHeader',
          'DialogTitle', 'DialogDescription', 'DialogFooter', 'Select', 'SelectTrigger',
          'SelectValue', 'SelectContent', 'SelectItem', 'Tabs', 'TabsList', 'TabsTrigger',
          'TabsContent', 'Progress', 'CircularProgress', 'Checkbox', 'RadioGroup',
          'RadioGroupItem', 'Accordion', 'AccordionItem', 'AccordionTrigger',
          'AccordionContent', 'Toast', 'ToastTitle', 'ToastDescription',
          'Alert', 'AlertTitle', 'AlertDescription', 'Popover', 'PopoverTrigger',
          'PopoverContent', 'ErrorBoundary'
        ];

        // First, try to find ANY component exposed to window (dynamic search)
        console.log('[Preview] Searching for component in window object...');
        for (const key in window) {
          // Look for any function with a capital first letter (React component convention)
          if (typeof window[key] === 'function' && /^[A-Z]/.test(key)) {
            // Skip React's built-in functions and shadcn components
            if (key !== 'React' && key !== 'ReactDOM' && key !== 'Babel' &&
                !shadcnComponentNames.includes(key)) {
              Component = window[key];
              console.log('[Preview] ✓ Found component via window.' + key);
              break;
            }
          }
        }

        // If that didn't work, try common component names as fallback
        if (!Component) {
          const possibleNames = ['Dashboard', 'ProjectDashboard', 'App', 'Component', 'Main', 'ProductCard', 'AdminPanel', 'LandingPage', 'EcommercePage', 'BlogPage'];
          for (const name of possibleNames) {
            console.log('[Preview] Checking window.' + name + ':', typeof window[name]);
            if (typeof window[name] === 'function') {
              Component = window[name];
              console.log('[Preview] ✓ Found component via window.' + name);
              break;
            }
          }
        }

        // If that didn't work, try common component names in local scope
        if (!Component) {
          console.log('[Preview] Component not found in window, checking local scope...');
          if (typeof ProjectDashboard !== 'undefined') { Component = ProjectDashboard; console.log('[Preview] ✓ Found ProjectDashboard'); }
          else if (typeof SalesDashboard !== 'undefined') { Component = SalesDashboard; console.log('[Preview] ✓ Found SalesDashboard'); }
          else if (typeof AdminDashboard !== 'undefined') { Component = AdminDashboard; console.log('[Preview] ✓ Found AdminDashboard'); }
          else if (typeof Dashboard !== 'undefined') { Component = Dashboard; console.log('[Preview] ✓ Found Dashboard'); }
          else if (typeof ProductListingPage !== 'undefined') { Component = ProductListingPage; console.log('[Preview] ✓ Found ProductListingPage'); }
          else if (typeof AnalyticsDashboard !== 'undefined') { Component = AnalyticsDashboard; console.log('[Preview] ✓ Found AnalyticsDashboard'); }
          else if (typeof Counter !== 'undefined') { Component = Counter; console.log('[Preview] ✓ Found Counter'); }
          else if (typeof CounterButton !== 'undefined') { Component = CounterButton; console.log('[Preview] ✓ Found CounterButton'); }
          else if (typeof App !== 'undefined') { Component = App; console.log('[Preview] ✓ Found App'); }
          else if (typeof TodoList !== 'undefined') { Component = TodoList; console.log('[Preview] ✓ Found TodoList'); }
          else if (typeof TodoApp !== 'undefined') { Component = TodoApp; console.log('[Preview] ✓ Found TodoApp'); }
          else if (typeof LandingPage !== 'undefined') { Component = LandingPage; console.log('[Preview] ✓ Found LandingPage'); }
          else if (typeof EcommerceApp !== 'undefined') { Component = EcommerceApp; console.log('[Preview] ✓ Found EcommerceApp'); }
          else if (typeof ProductList !== 'undefined') { Component = ProductList; console.log('[Preview] ✓ Found ProductList'); }
          else if (typeof ShoppingCart !== 'undefined') { Component = ShoppingCart; console.log('[Preview] ✓ Found ShoppingCart'); }
          else { console.log('[Preview] ✗ No component found in local scope'); }
        }

        if (Component) {
          console.log('[Preview] Component found, attempting to render...', Component.name || 'Anonymous');
          const rootElement = document.getElementById('root');
          console.log('[Preview] Root element:', rootElement);

          const root = ReactDOM.createRoot(rootElement);
          console.log('[Preview] React root created:', root);

          // Wrap component in ErrorBoundary to catch rendering errors
          const wrappedElement = React.createElement(ErrorBoundary, null,
            React.createElement(Component)
          );
          console.log('[Preview] React element created (wrapped in ErrorBoundary)');

          root.render(wrappedElement);
          console.log('[Preview] ✓ Render called successfully!');

          // Add a small delay to check if render actually worked
          setTimeout(() => {
            const content = document.getElementById('root').innerHTML;
            console.log('[Preview] Root innerHTML after render (first 200 chars):', content.substring(0, 200));
            if (!content || content.trim() === '') {
              console.error('[Preview] ✗ Root is empty after render! Component may have returned null or errored silently.');
              console.error('[Preview] Check if component is using undefined shadcn components or has syntax errors.');
            }
          }, 100);
        } else {
          console.error('[Preview] ✗ Component not found!');
          document.getElementById('root').innerHTML =
            '<div style="padding: 40px; max-width: 600px; margin: 0 auto; font-family: system-ui, sans-serif; text-align: center;">' +
            '<svg style="width: 64px; height: 64px; margin: 0 auto 20px; color: #9ca3af;" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
            '</svg>' +
            '<h2 style="font-size: 24px; font-weight: 600; color: #111827; margin-bottom: 12px;">Component Not Found</h2>' +
            '<p style="color: #6b7280; margin-bottom: 20px;">The generated code executed successfully, but no component function could be identified.</p>' +
            '<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 20px; text-align: left;">' +
            '<p style="font-size: 14px; color: #374151; margin-bottom: 8px; font-weight: 500;">Expected component names:</p>' +
            '<code style="display: block; font-size: 13px; color: #6b7280; line-height: 1.6;">Dashboard, ProjectDashboard, App, Counter, TodoList, ProductList, LandingPage, etc.</code>' +
            '</div>' +
            '<button onclick="window.parent.location.reload()" style="background: rgb(59, 130, 246); color: white; border: none; padding: 10px 24px; border-radius: 6px; font-weight: 500; cursor: pointer;">Try Regenerating</button>' +
            '</div>';
        }
      } catch (error) {
        console.error('[Preview] ✗ Error during execution:', error);
        console.error('[Preview] Error stack:', error.stack);
        document.getElementById('root').innerHTML =
          '<div style="padding: 20px; color: red;">' +
          '<h3>Error rendering component</h3>' +
          '<pre>' + error.message + '</pre>' +
          '<pre style="font-size: 12px; margin-top: 10px;">' + (error.stack || '') + '</pre>' +
          '</div>';
      }
    </script>
</body>
</html>
  `.trim()

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // Allow iframe embedding and external resources
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src 'unsafe-eval' 'unsafe-inline' 'self' https://cdn.tailwindcss.com https://unpkg.com; style-src 'unsafe-inline' 'self' https://cdn.tailwindcss.com; img-src 'self' data: https: http:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'self';",
      // Allow SAMEORIGIN so iframe can load within our app
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
      'X-XSS-Protection': '1; mode=block',
    },
  })
}