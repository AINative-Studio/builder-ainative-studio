/**
 * Find PascalCase JSX tags in `componentCode` that aren't in `knownComponents`,
 * so the legacy single-file preview route (app/api/preview/[id]/route.ts) can
 * inject a plain-div fallback for each one and avoid a Babel "X is not
 * defined" crash.
 *
 * Same comment/generic-type-arg-blindness bug class already fixed in
 * lib/build/completeness-gate.ts's findUndeclaredJsxComponents (#1998) and
 * lib/code-validator.ts's findUnresolvedComponents: the naive
 * `/<([A-Z][a-zA-Z0-9]+)[\s/>]/` regex matches a TypeScript generic type
 * argument immediately following an identifier (e.g.
 * `React.ButtonHTMLAttributes<HTMLButtonElement>`, the standard shadcn
 * `ui/button.tsx`/`ui/input.tsx` prop typing shipped in nearly every
 * generated app) just as happily as a real JSX opening tag, since the `>`
 * closing the generic satisfies `[\s/>]`. Here that false "unknown tag"
 * match used to get a fallback stub injected as
 * `window.HTMLButtonElement = function HTMLButtonElement(props) {...}` —
 * clobbering the real global DOM constructor with a fake React component,
 * for a tag that was never real JSX usage in the first place.
 */
export function detectUnknownJsxTags(componentCode: string, knownComponents: Set<string>): string[] {
  const jsxTagRe = /<([A-Z][a-zA-Z0-9]+)[\s/>]/g
  const tags = new Set<string>()
  for (const m of componentCode.matchAll(jsxTagRe)) {
    const name = m[1]
    const idx = m.index ?? 0
    const before = componentCode.slice(Math.max(0, idx - 24), idx)
    // Generic type-arg position = preceded by an identifier/`)`/`]`/`,` — BUT not
    // when that "identifier" is a JS keyword that introduces JSX (return/yield/etc.),
    // which would otherwise mask a real unresolved component like `return <Foo/>`.
    const isGeneric = /[A-Za-z0-9_)\],]\s*$/.test(before) &&
      !/\b(return|yield|default|typeof|in|of|do|else|case)\s*$/.test(before)
    // Also skip DOM/native TS types that are never components.
    const isDomType = /^HTML[A-Z]|Element$|EventTarget$/.test(name)
    if (isGeneric || isDomType) continue
    tags.add(name)
  }
  return [...tags].filter((tag) => !knownComponents.has(tag))
}
