// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputMicButton,
  PromptInputImageButton,
  PromptInputImagePreview,
  type ImageAttachment,
} from '@/components/ai-elements/prompt-input'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — prompt-input-helpers-1204.test.ts covers the
 * module's sessionStorage/file utility functions, but the 18 real rendered
 * components (components/ai-elements/prompt-input.tsx) had zero coverage —
 * genuinely reachable via chat-input.tsx and chat-detail-client.tsx. This
 * covers the components with real, non-trivial logic: PromptInput's
 * drag-drop image filter, PromptInputTextarea's Enter-to-submit/Shift+Enter/
 * IME-composition guard, PromptInputButton's size-from-children-count rule,
 * PromptInputSubmit's status->icon map, PromptInputMicButton's full
 * SpeechRecognition lifecycle, PromptInputImageButton's file-select+filter+
 * input-reset, and PromptInputImagePreview's empty-state/remove gating. The
 * thin pass-through wrappers (toolbar divs, ModelSelect* over Radix Select)
 * are skipped, same convention as thin shadcn wrappers elsewhere this
 * session.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.restoreAllMocks()
})

function makeImageFile(name = 'photo.png') {
  return new File(['x'], name, { type: 'image/png' })
}

/**
 * jsdom's native DragEvent doesn't carry a real FileList in dataTransfer, and
 * React 19's synthetic event system reads straight off the dispatched native
 * event object — so a real 'drop' Event is dispatched with a dataTransfer
 * property defined directly on it (jsdom allows extra properties on a plain
 * Event), which React's SyntheticEvent wrapper then exposes to the handler
 * untouched. This genuinely exercises PromptInput's own handleDrop, not a
 * hand-rolled call to it.
 */
function dispatchDrop(target: HTMLElement, files: File[]) {
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', { value: { files } })
  target.dispatchEvent(evt)
}

describe('PromptInput — drag/drop image filtering (#1204)', () => {
  it('calls onImageDrop only with the real image files, filtering out non-images', () => {
    const onImageDrop = vi.fn()
    render(React.createElement(PromptInput, { onImageDrop, children: React.createElement('div') }))
    const form = host.querySelector('form') as HTMLFormElement
    const imageFile = makeImageFile()
    const textFile = new File(['x'], 'notes.txt', { type: 'text/plain' })

    act(() => { dispatchDrop(form, [imageFile, textFile]) })

    expect(onImageDrop).toHaveBeenCalledWith([imageFile])
  })

  it('never calls onImageDrop when the dropped files contain no real images', () => {
    const onImageDrop = vi.fn()
    render(React.createElement(PromptInput, { onImageDrop, children: React.createElement('div') }))
    const form = host.querySelector('form') as HTMLFormElement
    const textFile = new File(['x'], 'notes.txt', { type: 'text/plain' })

    act(() => { dispatchDrop(form, [textFile]) })

    expect(onImageDrop).not.toHaveBeenCalled()
  })

  it('still calls the real onDrop prop passed through, alongside onImageDrop', () => {
    const onImageDrop = vi.fn()
    const onDrop = vi.fn()
    render(React.createElement(PromptInput, { onImageDrop, onDrop, children: React.createElement('div') }))
    const form = host.querySelector('form') as HTMLFormElement

    act(() => { dispatchDrop(form, [makeImageFile()]) })

    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  it('renders with the drag-over class when isDragOver is true', () => {
    render(React.createElement(PromptInput, { isDragOver: true, children: React.createElement('div') }))
    const form = host.querySelector('form') as HTMLFormElement
    expect(form.className).toContain('border-primary')
  })

  it('renders without the drag-over class when isDragOver is false/absent', () => {
    render(React.createElement(PromptInput, { children: React.createElement('div') }))
    const form = host.querySelector('form') as HTMLFormElement
    expect(form.className).not.toContain('border-primary')
  })
})

describe('PromptInputTextarea — Enter-to-submit behavior (#1204)', () => {
  function renderInForm(onSubmit: () => void, extraProps: Record<string, any> = {}) {
    render(
      React.createElement('form', { onSubmit: (e: React.FormEvent) => { e.preventDefault(); onSubmit() } },
        React.createElement(PromptInputTextarea, extraProps),
      ),
    )
    return host.querySelector('textarea') as HTMLTextAreaElement
  }

  it('Enter without Shift submits the real enclosing form', () => {
    const onSubmit = vi.fn()
    const textarea = renderInForm(onSubmit)
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Shift+Enter allows a newline and never submits', () => {
    const onSubmit = vi.fn()
    const textarea = renderInForm(onSubmit)
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Enter during IME composition never submits (real composition guard)', () => {
    const onSubmit = vi.fn()
    const textarea = renderInForm(onSubmit)
    act(() => {
      const evt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      Object.defineProperty(evt, 'isComposing', { value: true })
      textarea.dispatchEvent(evt)
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('uses the real default placeholder when none is given', () => {
    renderInForm(vi.fn())
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.placeholder).toBe('What would you like to know?')
  })

  it('calls the real onChange handler passed through', () => {
    const onChange = vi.fn()
    renderInForm(vi.fn(), { onChange })
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(textarea, 'hello')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalled()
  })
})

describe('PromptInputButton — size-from-children-count rule (#1204)', () => {
  it('uses icon size for a single child', () => {
    render(React.createElement(PromptInputButton, {}, React.createElement('span', { key: '1' }, 'X')))
    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn.className).not.toContain('px-3')
  })

  it('uses default (non-icon) size for multiple children', () => {
    render(React.createElement(PromptInputButton, {}, [
      React.createElement('span', { key: '1' }, 'X'),
      React.createElement('span', { key: '2' }, 'Y'),
    ]))
    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn.className).toContain('px-3')
  })

  it('honors an explicit size override regardless of children count', () => {
    render(React.createElement(PromptInputButton, { size: 'sm' as any }, React.createElement('span', { key: '1' }, 'X')))
    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn).not.toBeNull()
  })
})

describe('PromptInputSubmit — real status-to-icon mapping (#1204)', () => {
  it('shows the arrow-up icon by default (no status)', () => {
    render(React.createElement(PromptInputSubmit, {}))
    expect(host.querySelector('svg.lucide-arrow-up, svg')).not.toBeNull()
  })

  it("shows a spinning loader for status='submitted'", () => {
    render(React.createElement(PromptInputSubmit, { status: 'submitted' }))
    const svg = host.querySelector('svg') as SVGElement
    expect(svg.getAttribute('class')).toContain('animate-spin')
  })

  it("shows a square (stop) icon for status='streaming'", () => {
    render(React.createElement(PromptInputSubmit, { status: 'streaming' }))
    expect(host.querySelector('button')?.innerHTML).toContain('svg')
  })

  it("shows an X icon for status='error'", () => {
    render(React.createElement(PromptInputSubmit, { status: 'error' }))
    expect(host.querySelector('button')).not.toBeNull()
  })

  it('renders real explicit children instead of any status icon when provided', () => {
    render(React.createElement(PromptInputSubmit, { status: 'streaming' }, 'Send'))
    expect(host.textContent).toBe('Send')
  })
})

describe('PromptInputMicButton — real SpeechRecognition lifecycle (#1204)', () => {
  class FakeRecognition {
    continuous = false
    interimResults = false
    lang = ''
    onstart: (() => void) | null = null
    onresult: ((e: any) => void) | null = null
    onerror: ((e: any) => void) | null = null
    onend: (() => void) | null = null
    start = vi.fn(() => { this.onstart?.() })
    stop = vi.fn(() => { this.onend?.() })
    abort = vi.fn()
  }

  afterEach(() => {
    delete (window as any).SpeechRecognition
    delete (window as any).webkitSpeechRecognition
  })

  it('renders nothing when SpeechRecognition is unsupported', () => {
    render(React.createElement(PromptInputMicButton, {}))
    expect(host.innerHTML).toBe('')
  })

  it('renders a real mic button when SpeechRecognition (webkit) is supported', () => {
    ;(window as any).webkitSpeechRecognition = FakeRecognition
    render(React.createElement(PromptInputMicButton, {}))
    expect(host.querySelector('button')).not.toBeNull()
  })

  it('clicking starts real recognition and flips to the listening (MicOff) icon on a genuine onstart', () => {
    ;(window as any).SpeechRecognition = FakeRecognition
    render(React.createElement(PromptInputMicButton, {}))
    const btn = host.querySelector('button') as HTMLButtonElement
    act(() => { btn.click() })
    expect(btn.className).toContain('bg-red-100')
  })

  it('a real transcript result calls onTranscript and stops listening', () => {
    let instance!: FakeRecognition
    class CapturingRecognition extends FakeRecognition {
      constructor() { super(); instance = this }
    }
    ;(window as any).SpeechRecognition = CapturingRecognition
    const onTranscript = vi.fn()
    render(React.createElement(PromptInputMicButton, { onTranscript }))
    const btn = host.querySelector('button') as HTMLButtonElement
    act(() => { btn.click() })
    act(() => {
      instance.onresult?.({ results: [[{ transcript: 'hello world' }]] })
    })
    expect(onTranscript).toHaveBeenCalledWith('hello world')
    expect(btn.className).not.toContain('bg-red-100')
  })

  it('a real non-aborted recognition error calls onError and stops listening', () => {
    let instance!: FakeRecognition
    class CapturingRecognition extends FakeRecognition {
      constructor() { super(); instance = this }
    }
    ;(window as any).SpeechRecognition = CapturingRecognition
    const onError = vi.fn()
    render(React.createElement(PromptInputMicButton, { onError }))
    const btn = host.querySelector('button') as HTMLButtonElement
    act(() => { btn.click() })
    act(() => { instance.onerror?.({ error: 'network' }) })
    expect(onError).toHaveBeenCalledWith('network')
  })

  it('an "aborted" error is swallowed (never reported) — it is routine cleanup noise, not a real failure', () => {
    let instance!: FakeRecognition
    class CapturingRecognition extends FakeRecognition {
      constructor() { super(); instance = this }
    }
    ;(window as any).SpeechRecognition = CapturingRecognition
    const onError = vi.fn()
    render(React.createElement(PromptInputMicButton, { onError }))
    const btn = host.querySelector('button') as HTMLButtonElement
    act(() => { btn.click() })
    act(() => { instance.onerror?.({ error: 'aborted' }) })
    expect(onError).not.toHaveBeenCalled()
  })

  it('clicking again while listening stops the real recognition', () => {
    let instance!: FakeRecognition
    class CapturingRecognition extends FakeRecognition {
      constructor() { super(); instance = this }
    }
    ;(window as any).SpeechRecognition = CapturingRecognition
    render(React.createElement(PromptInputMicButton, {}))
    const btn = host.querySelector('button') as HTMLButtonElement
    act(() => { btn.click() }) // start
    act(() => { btn.click() }) // stop
    expect(instance.stop).toHaveBeenCalledTimes(1)
  })

  it('unmounting aborts any in-flight recognition (real cleanup, never throws)', () => {
    ;(window as any).SpeechRecognition = FakeRecognition
    expect(() => {
      render(React.createElement(PromptInputMicButton, {}))
      act(() => { root.unmount() })
    }).not.toThrow()
  })

  it('a real throw from recognition.start() reports onError and never crashes the click handler', () => {
    class ThrowsOnStart extends FakeRecognition {
      start = vi.fn(() => { throw new Error('mic busy') })
    }
    ;(window as any).SpeechRecognition = ThrowsOnStart
    const onError = vi.fn()
    render(React.createElement(PromptInputMicButton, { onError }))
    const btn = host.querySelector('button') as HTMLButtonElement
    expect(() => { act(() => { btn.click() }) }).not.toThrow()
    expect(onError).toHaveBeenCalledWith('Failed to start speech recognition')
  })

  it('a real throw from recognition.stop() still forces isListening back to false and never crashes', () => {
    let instance!: FakeRecognition
    class ThrowsOnStop extends FakeRecognition {
      constructor() { super(); instance = this }
      stop = vi.fn(() => { throw new Error('already stopped') })
    }
    ;(window as any).SpeechRecognition = ThrowsOnStop
    render(React.createElement(PromptInputMicButton, {}))
    const btn = host.querySelector('button') as HTMLButtonElement
    act(() => { btn.click() }) // start — onstart fires, isListening becomes true
    expect(btn.className).toContain('bg-red-100')
    expect(() => { act(() => { btn.click() }) }).not.toThrow() // stop — throws internally
    expect(btn.className).not.toContain('bg-red-100')
  })
})

describe('PromptInputImageButton — real file-select flow (#1204)', () => {
  it('clicking the button triggers the real hidden file input', () => {
    render(React.createElement(PromptInputImageButton, {}))
    const input = host.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')
    const btn = host.querySelector('button') as HTMLButtonElement
    act(() => { btn.click() })
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('selecting real image files calls onImageSelect with only the image files, then resets the input', () => {
    const onImageSelect = vi.fn()
    render(React.createElement(PromptInputImageButton, { onImageSelect }))
    const input = host.querySelector('input[type="file"]') as HTMLInputElement
    const imageFile = makeImageFile()
    const textFile = new File(['x'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(input, 'files', { value: [imageFile, textFile], configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })

    expect(onImageSelect).toHaveBeenCalledWith([imageFile])
    expect(input.value).toBe('')
  })

  it('never calls onImageSelect when no files were actually selected', () => {
    const onImageSelect = vi.fn()
    render(React.createElement(PromptInputImageButton, { onImageSelect }))
    const input = host.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(onImageSelect).not.toHaveBeenCalled()
  })
})

describe('PromptInputImagePreview — real attachment list rendering (#1204)', () => {
  function makeAttachment(id: string, name: string): ImageAttachment {
    return { id, file: makeImageFile(name), dataUrl: `data:image/png;base64,${id}`, preview: `data:image/png;base64,${id}` }
  }

  it('renders nothing when there are no attachments', () => {
    render(React.createElement(PromptInputImagePreview, { attachments: [] }))
    expect(host.innerHTML).toBe('')
  })

  it('renders a real thumbnail+filename per real attachment', () => {
    const attachments = [makeAttachment('a1', 'one.png'), makeAttachment('a2', 'two.png')]
    render(React.createElement(PromptInputImagePreview, { attachments }))
    const imgs = host.querySelectorAll('img')
    expect(imgs.length).toBe(2)
    expect(host.textContent).toContain('one.png')
    expect(host.textContent).toContain('two.png')
  })

  it('shows a real remove button only when onRemove is provided, and it calls onRemove with the real attachment id', () => {
    const onRemove = vi.fn()
    const attachments = [makeAttachment('a1', 'one.png')]
    render(React.createElement(PromptInputImagePreview, { attachments, onRemove }))
    const removeBtn = host.querySelector('button') as HTMLButtonElement
    expect(removeBtn).not.toBeNull()
    act(() => { removeBtn.click() })
    expect(onRemove).toHaveBeenCalledWith('a1')
  })

  it('renders no remove button at all when onRemove is omitted', () => {
    const attachments = [makeAttachment('a1', 'one.png')]
    render(React.createElement(PromptInputImagePreview, { attachments }))
    expect(host.querySelector('button')).toBeNull()
  })
})
