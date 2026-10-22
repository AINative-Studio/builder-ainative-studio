import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withStreamWatchdog } from '@/lib/utils/streamWatchdog'

function makeSourceStream(chunks: string[], opts?: { delayMs?: number }) {
  let i = 0
  return new ReadableStream<string>({
    async pull(controller) {
      if (opts?.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs))
      }
      if (i < chunks.length) {
        controller.enqueue(chunks[i])
        i++
      } else {
        controller.close()
      }
    },
  })
}

async function readAll(stream: ReadableStream<string>): Promise<string[]> {
  const reader = stream.getReader()
  const out: string[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

describe('lib/utils/streamWatchdog', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('passes chunks through unchanged when data arrives promptly', async () => {
    const source = makeSourceStream(['a', 'b', 'c'])
    const watched = withStreamWatchdog(source)

    const resultPromise = readAll(watched)
    await vi.runAllTimersAsync()

    await expect(resultPromise).resolves.toEqual(['a', 'b', 'c'])
  })

  it('closes cleanly when the source stream completes', async () => {
    const source = makeSourceStream([])
    const watched = withStreamWatchdog(source)

    const reader = watched.getReader()
    const { done } = await reader.read()
    expect(done).toBe(true)
  })

  it('calls onStall after the stall-warning window without new data, then still errors at the idle timeout', async () => {
    const onStall = vi.fn()
    const onTimeout = vi.fn()
    // Source stalls forever after emitting nothing.
    const source = new ReadableStream<string>({
      pull() {
        // never resolves/enqueues/closes
        return new Promise(() => {})
      },
    })
    const watched = withStreamWatchdog(source, {
      idleTimeoutMs: 1000,
      stallWarningMs: 300,
      onStall,
      onTimeout,
    })

    const reader = watched.getReader()
    const readPromise = reader.read()
    // Attach a rejection handler immediately so advancing fake timers below
    // can't produce an unhandled-rejection warning before the awaited
    // assertion below gets a chance to attach its own handler.
    const settled = readPromise.catch((e) => e)

    await vi.advanceTimersByTimeAsync(300)
    expect(onStall).toHaveBeenCalledTimes(1)
    expect(onTimeout).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(700) // total 1000ms -> idle timeout fires
    expect(onTimeout).toHaveBeenCalledTimes(1)

    const settledError = await settled
    expect(settledError).toBeInstanceOf(Error)
    expect(settledError.message).toBe('Stream timed out. Please try again.')
  })

  it('resets the idle timer on each new chunk, so a slow-but-steady stream never times out', async () => {
    const onTimeout = vi.fn()
    // Each pull takes 500ms, well under the 1000ms idle timeout, repeated 3 times.
    const source = makeSourceStream(['x', 'y', 'z'], { delayMs: 500 })
    const watched = withStreamWatchdog(source, { idleTimeoutMs: 1000, stallWarningMs: 2000, onTimeout })

    const resultPromise = readAll(watched)
    await vi.runAllTimersAsync()

    await expect(resultPromise).resolves.toEqual(['x', 'y', 'z'])
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('uses default idle timeout (60s) and stall warning (30s) when not provided', async () => {
    const onStall = vi.fn()
    const source = new ReadableStream<string>({
      pull() {
        return new Promise(() => {})
      },
    })
    const watched = withStreamWatchdog(source, { onStall })

    const reader = watched.getReader()
    reader.read().catch(() => {})

    await vi.advanceTimersByTimeAsync(30_000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('propagates a read error from the source stream through the watchdog as an error', async () => {
    const boom = new Error('source exploded')
    const source = new ReadableStream<string>({
      pull() {
        throw boom
      },
    })
    const watched = withStreamWatchdog(source, { idleTimeoutMs: 5000, stallWarningMs: 1000 })

    const reader = watched.getReader()
    await expect(reader.read()).rejects.toThrow('source exploded')
  })

  it('cancel() clears pending timers and forwards cancellation to the underlying reader', async () => {
    const cancelSpy = vi.fn()
    const source = new ReadableStream<string>({
      pull() {
        return new Promise(() => {})
      },
      cancel: cancelSpy,
    })
    const watched = withStreamWatchdog(source, { idleTimeoutMs: 5000, stallWarningMs: 1000 })

    const reader = watched.getReader()
    reader.read().catch(() => {})
    await reader.cancel('client aborted')

    expect(cancelSpy).toHaveBeenCalled()

    // After cancel, advancing time should not trigger onTimeout (timers cleared).
    const onTimeout = vi.fn()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
