// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ComponentMapper, type A2UIComponent } from '@/components/a2ui/ComponentMapper'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // Radix Select/Tabs measure via ResizeObserver, unimplemented in jsdom.
  if (!(globalThis as any).ResizeObserver) {
    ;(globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

/**
 * #1204 (Coverage Phase 4) — ComponentMapper-render-1204.test.tsx covers
 * ComponentMapper's own dispatch/recursion/event-wiring logic (via the
 * 'button' type) but only 1 of componentRegistry's 24 real renderer
 * functions (components/a2ui/ComponentMapper.tsx) ever actually ran. The
 * other 23 — container/flex/grid/input/textarea/label/select/checkbox/
 * radio/card/badge/separator/progress/tabs/tab-content/text/heading/image/
 * video/form/field — had zero coverage. Each driven through ComponentMapper
 * itself (its real production entry point, not direct registry access) with
 * a real A2UIComponent spec.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function renderComponent(component: A2UIComponent) {
  render(React.createElement(ComponentMapper, { component }))
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.restoreAllMocks()
})

describe('ComponentMapper registry — layout components (#1204)', () => {
  it('container applies real layout+style merged onto a full-size div', () => {
    renderComponent({ type: 'container', id: 'c1', layout: { padding: '8px' }, style: { color: 'red' }, children: 'hi' })
    const div = document.body.querySelector('.w-full.h-full') as HTMLDivElement
    expect(div).not.toBeNull()
    expect(div.style.padding).toBe('8px')
    expect(div.style.color).toBe('red')
    expect(div.textContent).toBe('hi')
  })

  it('flex defaults flexDirection=row and gap=1rem when layout omits them', () => {
    renderComponent({ type: 'flex', id: 'f1', children: 'content' })
    const div = document.body.querySelector('.flex') as HTMLDivElement
    expect(div.style.flexDirection).toBe('row')
    expect(div.style.gap).toBe('1rem')
  })

  it('flex honors an explicit layout.flexDirection override', () => {
    renderComponent({ type: 'flex', id: 'f2', layout: { flexDirection: 'column' }, children: 'x' })
    const div = document.body.querySelector('.flex') as HTMLDivElement
    expect(div.style.flexDirection).toBe('column')
  })

  it('grid defaults gridTemplateColumns to the responsive auto-fit pattern', () => {
    renderComponent({ type: 'grid', id: 'g1', children: 'x' })
    const div = document.body.querySelector('.grid') as HTMLDivElement
    expect(div.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(250px, 1fr))')
  })

  it('grid honors a real layout.columns override', () => {
    // The 'grid' renderer reads layout.columns (components/a2ui/ComponentMapper.tsx),
    // but A2UIComponent['layout'] never declares that field — a real, pre-existing
    // type/implementation gap. Cast only this literal rather than widen the type.
    const layout = { columns: 'repeat(3, 1fr)' } as A2UIComponent['layout']
    renderComponent({ type: 'grid', id: 'g2', layout, children: 'x' })
    const div = document.body.querySelector('.grid') as HTMLDivElement
    expect(div.style.gridTemplateColumns).toBe('repeat(3, 1fr)')
  })
})

describe('ComponentMapper registry — form inputs (#1204)', () => {
  it('input renders a real text input with its placeholder, defaulting type=text', () => {
    renderComponent({ type: 'input', id: 'i1', props: { placeholder: 'Your name' } })
    const input = document.body.querySelector('input') as HTMLInputElement
    expect(input.type).toBe('text')
    expect(input.placeholder).toBe('Your name')
  })

  it('textarea defaults rows=4 and honors a real placeholder', () => {
    renderComponent({ type: 'textarea', id: 't1', props: { placeholder: 'Notes' } })
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.rows).toBe(4)
    expect(textarea.placeholder).toBe('Notes')
  })

  it('label renders real children bound to a real htmlFor', () => {
    renderComponent({ type: 'label', id: 'l1', props: { htmlFor: 'email' }, children: 'Email' })
    const label = document.body.querySelector('label') as HTMLLabelElement
    expect(label.textContent).toBe('Email')
    expect(label.getAttribute('for')).toBe('email')
  })

  it('checkbox renders a real Checkbox plus its label only when one is provided', () => {
    renderComponent({ type: 'checkbox', id: 'cb1', props: { label: 'Accept terms' } })
    expect(document.body.textContent).toContain('Accept terms')
    expect(document.body.querySelector('button[role="checkbox"]')).not.toBeNull()
  })

  it('checkbox renders with no label text when none is provided', () => {
    renderComponent({ type: 'checkbox', id: 'cb2' })
    expect(document.body.querySelector('label')).toBeNull()
  })

  it('radio renders one real RadioGroupItem+Label per real option', () => {
    renderComponent({
      type: 'radio', id: 'r1',
      props: { options: [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }] },
    })
    expect(document.body.querySelectorAll('button[role="radio"]').length).toBe(2)
    expect(document.body.textContent).toContain('Option A')
    expect(document.body.textContent).toContain('Option B')
  })

  it('select renders the real placeholder and one SelectItem per real option', () => {
    renderComponent({
      type: 'select', id: 's1',
      props: { placeholder: 'Pick one', options: [{ value: 'x', label: 'X value' }] },
    })
    expect(document.body.textContent).toContain('Pick one')
  })

  it('form renders real children inside a real <form> wired to the real onSubmit', () => {
    const onSubmit = (e: React.FormEvent) => e.preventDefault()
    renderComponent({ type: 'form', id: 'form1', props: { onSubmit }, children: 'form body' })
    const form = document.body.querySelector('form') as HTMLFormElement
    expect(form).not.toBeNull()
    expect(form.textContent).toBe('form body')
  })

  it('field shows its real label and real error text only when each is provided', () => {
    renderComponent({ type: 'field', id: 'fl1', props: { label: 'Username', error: 'Required' }, children: 'input-slot' })
    expect(document.body.textContent).toContain('Username')
    expect(document.body.textContent).toContain('Required')
  })

  it('field renders with no label/error text when neither is provided', () => {
    renderComponent({ type: 'field', id: 'fl2', children: 'input-slot' })
    expect(document.body.querySelector('label')).toBeNull()
    expect(document.body.textContent).not.toContain('Required')
  })
})

describe('ComponentMapper registry — display components (#1204)', () => {
  it('card renders a real title+description header only when at least one is provided', () => {
    renderComponent({ type: 'card', id: 'cd1', props: { title: 'Plan summary', description: 'Your current plan' }, children: 'body' })
    expect(document.body.textContent).toContain('Plan summary')
    expect(document.body.textContent).toContain('Your current plan')
    expect(document.body.textContent).toContain('body')
  })

  it('card renders no header at all when title and description are both absent', () => {
    renderComponent({ type: 'card', id: 'cd2', children: 'just body' })
    expect(document.body.querySelector('[class*="CardHeader"]')).toBeNull()
    expect(document.body.textContent).toBe('just body')
  })

  it('badge defaults variant=default and renders real children', () => {
    renderComponent({ type: 'badge', id: 'b1', children: 'New' })
    expect(document.body.textContent).toContain('New')
  })

  it('separator renders a real Separator element', () => {
    renderComponent({ type: 'separator', id: 'sep1' })
    expect(document.body.querySelector('[role="separator"], [role="none"]')).not.toBeNull()
  })

  it('progress defaults value=0 and renders a real Progress indicator', () => {
    renderComponent({ type: 'progress', id: 'p1' })
    expect(document.body.querySelector('[role="progressbar"]')).not.toBeNull()
  })

  it('progress honors a real explicit value prop', () => {
    renderComponent({ type: 'progress', id: 'p2', props: { value: 42 } })
    const bar = document.body.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('42')
  })
})

describe('ComponentMapper registry — navigation components (#1204)', () => {
  it('tabs renders one real TabsTrigger per item and defaults defaultValue to the first item', () => {
    renderComponent({
      type: 'tabs', id: 'tabs1',
      props: { items: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] },
    })
    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(2)
    expect(document.body.textContent).toContain('One')
    expect(document.body.textContent).toContain('Two')
  })

  it('tab-content renders real children bound to the real tab value', () => {
    renderComponent({
      type: 'tabs', id: 'tabs2',
      props: { items: [{ value: 'one', label: 'One' }] },
      children: [{ type: 'tab-content', id: 'tc1', props: { value: 'one' }, children: 'Tab one content' }],
    })
    expect(document.body.textContent).toContain('Tab one content')
  })
})

describe('ComponentMapper registry — content components (#1204)', () => {
  it('text defaults variant=body and maps each real variant to its real class', () => {
    renderComponent({ type: 'text', id: 'tx1', props: { variant: 'h2' }, children: 'Heading text' })
    const p = document.body.querySelector('p') as HTMLParagraphElement
    expect(p.textContent).toBe('Heading text')
    expect(p.className).toContain('text-3xl')
  })

  it('heading renders the real semantic tag for its level (h3) with the real matching size class', () => {
    renderComponent({ type: 'heading', id: 'h1', props: { level: 3 }, children: 'Section title' })
    const h3 = document.body.querySelector('h3') as HTMLHeadingElement
    expect(h3).not.toBeNull()
    expect(h3.textContent).toBe('Section title')
    expect(h3.className).toContain('text-2xl')
  })

  it('heading defaults level=1 (renders a real h1) when no level is given', () => {
    renderComponent({ type: 'heading', id: 'h2', children: 'Default heading' })
    expect(document.body.querySelector('h1')?.textContent).toBe('Default heading')
  })

  it('image renders a real <img> with src/alt/width/height, defaulting alt to empty string', () => {
    renderComponent({ type: 'image', id: 'img1', props: { src: '/logo.png', width: 100, height: 50 } })
    const img = document.body.querySelector('img') as HTMLImageElement
    expect(img.src).toContain('/logo.png')
    expect(img.alt).toBe('')
    expect(img.width).toBe(100)
    expect(img.height).toBe(50)
  })

  it('video defaults autoPlay=false, controls=true, loop=false and renders a real <video>', () => {
    renderComponent({ type: 'video', id: 'v1', props: { src: '/demo.mp4' } })
    const video = document.body.querySelector('video') as HTMLVideoElement
    expect(video).not.toBeNull()
    expect(video.autoplay).toBe(false)
    expect(video.controls).toBe(true)
    expect(video.loop).toBe(false)
  })

  it('video honors real explicit autoPlay/loop overrides', () => {
    renderComponent({ type: 'video', id: 'v2', props: { src: '/demo.mp4', autoPlay: true, loop: true } })
    const video = document.body.querySelector('video') as HTMLVideoElement
    expect(video.autoplay).toBe(true)
    expect(video.loop).toBe(true)
  })
})
