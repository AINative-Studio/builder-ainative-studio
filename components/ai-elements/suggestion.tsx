'use client'

import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'

export type SuggestionsProps = ComponentProps<typeof ScrollArea>

export const Suggestions = ({
  className,
  children,
  ...props
}: SuggestionsProps) => {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScrollability = () => {
    const scrollArea = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement
    if (!scrollArea) return

    const { scrollLeft, scrollWidth, clientWidth } = scrollArea
    setCanScrollLeft(scrollLeft > 0)
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1) // -1 for rounding
  }

  useEffect(() => {
    const scrollArea = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement
    if (!scrollArea) return

    // Check initial state
    checkScrollability()

    // Add scroll listener
    scrollArea.addEventListener('scroll', checkScrollability)

    // Add resize observer to handle container size changes
    const resizeObserver = new ResizeObserver(checkScrollability)
    resizeObserver.observe(scrollArea)

    return () => {
      scrollArea.removeEventListener('scroll', checkScrollability)
      resizeObserver.disconnect()
    }
  }, [children])

  const scrollBy = (delta: number) => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement
    if (viewport) viewport.scrollBy({ left: delta, behavior: 'smooth' })
  }

  return (
    // Flex row: the scroller takes the available width, the scroll button lives
    // in its own column OUTSIDE the scroll area so it never overlaps the chips.
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        {/* Left edge: soft fade only (no floating button — keeps chips readable) */}
        {canScrollLeft && (
          <div className="absolute left-0 top-0 z-10 h-full w-8 bg-gradient-to-r from-gray-50 dark:from-black to-transparent pointer-events-none" />
        )}
        {/* Right edge: soft fade to hint there's more, no button on top of chips */}
        {canScrollRight && (
          <div className="absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-gray-50 dark:from-black to-transparent pointer-events-none" />
        )}

        <ScrollArea
          ref={scrollAreaRef}
          className="w-full overflow-x-auto whitespace-nowrap"
          {...props}
        >
          <div
            className={cn('flex w-max flex-nowrap items-center gap-2', className)}
          >
            {children}
          </div>
          <ScrollBar className="hidden" orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* Scroll-right control — outside the chip row, on the far right, no overlap */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollBy(220)}
          aria-label="Scroll right for more suggestions"
          className="shrink-0 cursor-pointer"
        >
          <div className="w-8 h-8 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <span className="text-gray-600 dark:text-gray-300 text-sm leading-none">→</span>
          </div>
        </button>
      )}
    </div>
  )
}

export type SuggestionProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  suggestion: string
  onClick?: (suggestion: string) => void
}

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = 'outline',
  size = 'sm',
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = () => {
    onClick?.(suggestion)
  }

  return (
    <Button
      className={cn('cursor-pointer rounded-full px-4', className)}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  )
}
