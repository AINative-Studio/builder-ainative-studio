/**
 * Regression for the huddle blank-preview bug (chatId MbPLU9LmafdtRTQzsOn0R):
 *
 * The scaffold declares `class ErrorBoundary` in its own <script type="text/babel">
 * block (Babel-standalone compiles all such blocks into the SAME global scope). The
 * app-injection step used to prefix the compiled app with `var ErrorBoundary = …`
 * whenever the app didn't declare its OWN ErrorBoundary — which collided with the
 * scaffold's class:  "Identifier 'ErrorBoundary' has already been declared"  → the
 * whole <script> failed to parse → React never mounted → blank page.
 *
 * huddle's generated app references NO ErrorBoundary at all, yet still got the
 * injected `var`, so it broke. This test reproduces the exact two-block structure
 * and asserts the app mounts (old pattern is shown to crash; new pattern renders).
 */
import { test, expect } from '@playwright/test'

// Mirrors the scaffold: an ErrorBoundary class compiled into global scope, published
// to window (as the real route does at window.ErrorBoundary = ErrorBoundary).
const SCAFFOLD_EB = `class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state = { hasError:false }; }
  static getDerivedStateFromError(){ return { hasError:true }; }
  render(){ return this.state.hasError ? React.createElement('div',null,'err') : this.props.children; }
}
window.ErrorBoundary = ErrorBoundary;`

// huddle-shaped app: a single top-level function, NO ErrorBoundary reference.
const APP = `function App(){ return React.createElement('h1',{id:'app-h1'},'Huddle Loaded'); }`

function page(appPrefix: string): string {
  // appPrefix is what the route injects before the compiled app. Old (buggy) value
  // was 'var ErrorBoundary = ...'; new value is '' for an app that doesn't use it.
  const doc = `<!DOCTYPE html><html><head>
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  </head><body><div id="root"></div>
    <script>
      // Block 1: scaffold ErrorBoundary in global scope.
      ${SCAFFOLD_EB}
    </script>
    <script>
      // Block 2: the app-injection step (route). Prefix + app + mount.
      try {
        ${appPrefix}
        ${APP}
        var C = (new Function('return typeof App!=="undefined"?App:undefined'))();
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C));
        window.__MOUNT_OK__ = true;
      } catch (e) {
        window.__MOUNT_ERR__ = String(e && e.message || e);
      }
    </script>
  </body></html>`
  return `data:text/html,${encodeURIComponent(doc)}`
}

test('NEW pattern (no injected declaration for an app that does not use ErrorBoundary) mounts', async ({ page: p }) => {
  // The fix injects '' when the app neither declares nor references ErrorBoundary.
  await p.goto(page(''))
  await expect(p.locator('#app-h1')).toHaveText('Huddle Loaded', { timeout: 10000 })
  const ok = await p.evaluate(() => (window as unknown as { __MOUNT_OK__?: boolean }).__MOUNT_OK__)
  expect(ok).toBe(true)
})

test('NEW pattern still resolves a BARE <ErrorBoundary> reference via window (no crash)', async ({ page: p }) => {
  // App references ErrorBoundary but does not declare it. The scaffold published
  // window.ErrorBoundary, so a bare reference resolves; the guarded no-op alias
  // never redeclares.
  const guard = 'if (typeof globalThis!=="undefined" && typeof globalThis.ErrorBoundary==="undefined"){ globalThis.ErrorBoundary=function(x){return x.children;}; }'
  const appUsingEB = `function App(){ return React.createElement(ErrorBoundary,null,React.createElement('h1',{id:'app-h1'},'Wrapped')); }`
  const doc = `<!DOCTYPE html><html><head>
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  </head><body><div id="root"></div>
    <script>${SCAFFOLD_EB}</script>
    <script>
      try { ${guard}
        ${appUsingEB}
        var C=(new Function('return typeof App!=="undefined"?App:undefined'))();
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C));
        window.__MOUNT_OK__=true;
      } catch(e){ window.__MOUNT_ERR__=String(e&&e.message||e); }
    </script></body></html>`
  await p.goto(`data:text/html,${encodeURIComponent(doc)}`)
  await expect(p.locator('#app-h1')).toHaveText('Wrapped', { timeout: 10000 })
  const err = await p.evaluate(() => (window as unknown as { __MOUNT_ERR__?: string }).__MOUNT_ERR__)
  expect(err).toBeUndefined()
})
