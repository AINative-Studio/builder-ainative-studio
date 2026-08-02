/**
 * Browser-safe stub for `@ainative/ai-kit-core` (issue #6).
 *
 * `@ainative/ai-kit@0.2.0` statically imports `AIStream` from
 * `@ainative/ai-kit-core` at the top of its bundle. That core package is a
 * Node-only module (it pulls in `stream/promises`, `zlib`, `fs`, `path`, etc.
 * for server-side streaming/compression) and therefore cannot be bundled into
 * a browser/client chunk — attempting to do so breaks `next build`.
 *
 * The builder only consumes the *presentational* ai-kit components
 * (StreamingMessage, CodeBlock, StreamingIndicator, MarkdownRenderer). It never
 * calls `useAIStream()`, which is the sole consumer of `AIStream`. We therefore
 * alias `@ainative/ai-kit-core` to this stub in the Next config so the static
 * import resolves without dragging Node built-ins into the client bundle.
 *
 * If `useAIStream()` is ever used, constructing `AIStream` will throw a clear
 * error pointing back here.
 */

export class AIStream {
  constructor(..._args: unknown[]) {
    throw new Error(
      '[@ainative/ai-kit] AIStream / useAIStream is not available in the ' +
        'browser build. The builder uses its own streaming transport ' +
        '(/api/chat-ws). See lib/aikit/ai-kit-core-browser-stub.ts.',
    )
  }
}

export default { AIStream }
