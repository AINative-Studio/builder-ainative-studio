/**
 * PublicFooter — Modernist footer for public marketing pages, matching
 * components/build/screens/Landing.tsx's `.m-land-foot` exactly (same link
 * set, plus a `homeLabel`-configurable "current page" convention isn't
 * needed here — every page links out uniformly, mirroring Landing's own
 * footer verbatim).
 */
export function PublicFooter() {
  return (
    <div className="m-land-foot">
      <a href="/showcase">Showcase</a>
      <a href="/capabilities">What can I build?</a>
      <a href="/about">About</a>
      <a href="https://ainative.studio/terms">Terms</a>
      <a href="https://ainative.studio/acceptable-use">Acceptable use</a>
      <a href="https://ainative.studio/privacy">Privacy</a>
      <span>Support: <a href="mailto:support@ainative.studio">support@ainative.studio</a></span>
    </div>
  )
}
