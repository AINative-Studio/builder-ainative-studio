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

  return (
    <div className="relative">
      {/* Left fade overlay with arrow indicator */}
      {canScrollLeft && (
        <>
          <div className="absolute -left-px -top-px z-10 h-[calc(100%+1px)] w-16 bg-gradient-to-r from-gray-50 dark:from-black to-transparent pointer-events-none" />
          <div className="absolute left-2 top-1/2 -translate-y-1/2 z-20 pointer-events-none">
            <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shadow-md">
              <span className="text-gray-600 dark:text-gray-300 text-xs">←</span>
            </div>
          </div>
        </>
      )}

      {/* Right fade overlay with arrow indicator */}
      {canScrollRight && (
        <>
          <div className="absolute -right-px -top-px z-10 h-[calc(100%+1px)] w-16 bg-gradient-to-l from-gray-50 dark:from-black to-transparent pointer-events-none" />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 pointer-events-none">
            <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shadow-md">
              <span className="text-gray-600 dark:text-gray-300 text-xs">→</span>
            </div>
          </div>
        </>
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
