/**
 * StreamingMessage — now backed by the official @ainative/ai-kit library.
 *
 * The vendored implementation that previously lived here has been replaced by
 * the maintained component from `@ainative/ai-kit` (issue #6). This module is
 * kept as a thin re-export so existing import paths
 * (`@/components/aikit/StreamingMessage`) continue to work unchanged while
 * benefiting from the library's improved typewriter animations, professional
 * code highlighting, and GFM markdown rendering.
 */
export {
  StreamingMessage,
  StreamingMessage as default,
  type StreamingMessageProps,
} from '@ainative/ai-kit'
