/**
 * Front-door value-prop helpers (#65).
 *
 * Pure functions — no React, no browser APIs — so they can be unit-tested
 * without a DOM and imported by both the Fork screen and the homepage hero.
 */

/** The single plaintext value line shown in the hero before any auth. */
export const FRONT_DOOR_VALUE_LINE =
  'Tell Cody your idea. Get a real app you own — built and run for you. No code.'

/** The one-line Live-view status shown in the masthead once logged in. */
export function liveStatusLine(companyName: string, onWatch: boolean): string {
  if (onWatch) {
    return `${companyName} is live — Cody is running it right now.`
  }
  return `${companyName} is live. Upgrade to have Cody run it 24/7 for you.`
}

/** The three steps shown in the "what this does" strip on the front door. */
export const FRONT_DOOR_STEPS: readonly { step: number; label: string; detail: string }[] = [
  {
    step: 1,
    label: 'Tell Cody your idea',
    detail: 'One sentence is enough — Cody figures out the rest.',
  },
  {
    step: 2,
    label: 'Get a real app you own',
    detail: 'Working code, database, and a live URL — 100% yours, no lock-in.',
  },
  {
    step: 3,
    label: 'It runs itself',
    detail: 'Cody handles the nightly tasks, growth, and ops while you sleep.',
  },
] as const
