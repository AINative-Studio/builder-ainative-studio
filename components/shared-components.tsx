import React from 'react'

// Simplified shared components for LLAMA-only mode
// All v0 SDK components removed

export const sharedComponents = {
  // Simple fallback components
  div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  pre: ({ children, ...props }: any) => <pre {...props}>{children}</pre>,
  code: ({ children, ...props }: any) => (
    <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm" {...props}>
      {children}
    </code>
  ),
}