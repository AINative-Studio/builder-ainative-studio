"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-slate-900 transition-all dark:bg-slate-50"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

// Circular Progress Component
interface CircularProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  size?: number
  strokeWidth?: number
  showValue?: boolean
}

const CircularProgress = React.forwardRef<HTMLDivElement, CircularProgressProps>(
  ({ className, value = 0, size = 60, strokeWidth = 4, showValue = false, ...props }, ref) => {
    const radius = (size - strokeWidth) / 2
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (value / 100) * circumference

    return (
      <div
        ref={ref}
        className={cn("relative inline-flex items-center justify-center", className)}
        style={{ width: size, height: size }}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        {...props}
      >
        <svg
          width={size}
          height={size}
          className="transform -rotate-90"
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            className="text-slate-200 dark:text-slate-800"
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="text-slate-900 dark:text-slate-50 transition-all duration-300"
          />
        </svg>
        {showValue && (
          <span className="absolute text-sm font-medium text-slate-900 dark:text-slate-50">
            {Math.round(value)}%
          </span>
        )}
      </div>
    )
  }
)
CircularProgress.displayName = "CircularProgress"

// Indeterminate Progress (loading spinner)
interface IndeterminateProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number
}

const IndeterminateProgress = React.forwardRef<HTMLDivElement, IndeterminateProgressProps>(
  ({ className, size = 40, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("relative inline-flex items-center justify-center", className)}
        style={{ width: size, height: size }}
        role="progressbar"
        aria-valuetext="Loading"
        {...props}
      >
        <svg
          className="animate-spin text-slate-900 dark:text-slate-50"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    )
  }
)
IndeterminateProgress.displayName = "IndeterminateProgress"

export { Progress, CircularProgress, IndeterminateProgress }
