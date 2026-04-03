/**
 * Stream watchdog for detecting hung/stalled SSE streams.
 * Ported from cody-cli patterns (src/services/api/claude.ts:1869-1930)
 */

interface StreamWatchdogOptions {
  idleTimeoutMs?: number
  stallWarningMs?: number
  onTimeout?: () => void
  onStall?: () => void
}

const DEFAULT_IDLE_TIMEOUT = 60_000 // 60s
const DEFAULT_STALL_WARNING = 30_000 // 30s

/**
 * Wraps a ReadableStream with idle/stall detection.
 * If no chunks arrive within the timeout, the stream is aborted.
 */
export function withStreamWatchdog<T>(
  stream: ReadableStream<T>,
  options?: StreamWatchdogOptions,
): ReadableStream<T> {
  const idleTimeout = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT
  const stallWarning = options?.stallWarningMs ?? DEFAULT_STALL_WARNING

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let controller: ReadableStreamDefaultController<T> | null = null

  function clearTimers() {
    if (idleTimer) clearTimeout(idleTimer)
    if (stallTimer) clearTimeout(stallTimer)
    idleTimer = null
    stallTimer = null
  }

  function resetTimers() {
    clearTimers()

    stallTimer = setTimeout(() => {
      console.warn('[stream-watchdog] Stream stalled - no data for', stallWarning, 'ms')
      options?.onStall?.()
    }, stallWarning)

    idleTimer = setTimeout(() => {
      console.error('[stream-watchdog] Stream idle timeout after', idleTimeout, 'ms')
      options?.onTimeout?.()
      controller?.error(new Error('Stream timed out. Please try again.'))
    }, idleTimeout)
  }

  const reader = stream.getReader()

  return new ReadableStream<T>({
    start(ctrl) {
      controller = ctrl
      resetTimers()
    },

    async pull(ctrl) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          clearTimers()
          ctrl.close()
          return
        }
        resetTimers()
        ctrl.enqueue(value)
      } catch (err) {
        clearTimers()
        ctrl.error(err)
      }
    },

    cancel() {
      clearTimers()
      reader.cancel()
    },
  })
}
