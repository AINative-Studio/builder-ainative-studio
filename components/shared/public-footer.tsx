/**
 * PublicFooter — Modernist footer for public marketing pages, matching
 * components/build/screens/Landing.tsx's `.m-land-foot` exactly (same link
 * set, plus a `homeLabel`-configurable "current page" convention isn't
 * needed here — every page links out uniformly, mirroring Landing's own
 * footer verbatim).
 *
 * Terms/Privacy now point at Builder's OWN pages (#794), not ainative.studio's
 * — Twilio's A2P 10DLC carrier review needs a public legal page for the actual
 * product sending Cody's SMS messages, and builder.ainative.studio had none of
 * its own until app/terms + app/privacy were added.
 */
export function PublicFooter() {
  return (
    <div className="m-land-foot">
      <a href="/showcase">Showcase</a>
      <a href="/capabilities">What can I build?</a>
      <a href="/about">About</a>
      <a href="/terms">Terms</a>
      <a href="https://ainative.studio/acceptable-use">Acceptable use</a>
      <a href="/privacy">Privacy</a>
      <span>Support: <a href="mailto:support@ainative.studio">support@ainative.studio</a></span>
    </div>
  )
}
