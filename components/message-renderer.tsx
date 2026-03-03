import React from 'react'

interface MessageRendererProps {
  content: any
  messageId?: string
  role: 'user' | 'assistant'
  className?: string
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="my-4">
      <div className="bg-gray-900 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <span className="text-xs text-gray-400 font-mono">{language || 'code'}</span>
        </div>
        <pre className="p-4 overflow-x-auto">
          <code className="text-sm text-gray-100 font-mono">{code}</code>
        </pre>
      </div>
    </div>
  )
}

function parseMarkdownWithCode(text: string) {
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  // Match code blocks with ```language or just ``` (more flexible with optional newline)
  // Matches: ```jsx\ncode``` or ```\ncode``` or even ```code```
  // Also matches incomplete blocks during streaming: ```jsx\ncode (without closing)
  const codeBlockRegex = /```(\w+)?[\r\n]?([\s\S]*?)(?:```|$)/g
  let match

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index)
      if (beforeText.trim()) {
        parts.push(
          <p key={`text-${lastIndex}`} className="mb-4 text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
            {beforeText}
          </p>
        )
      }
    }

    // Add code block
    const language = match[1] || 'code'
    const code = match[2]?.trim() || '' // Trim to remove leading/trailing whitespace
    parts.push(
      <CodeBlock key={`code-${match.index}`} code={code} language={language} />
    )

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex)
    if (remainingText.trim()) {
      parts.push(
        <p key={`text-${lastIndex}`} className="mb-4 text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
          {remainingText}
        </p>
      )
    }
  }

  return parts.length > 0 ? parts : [
    <p key="default" className="mb-4 text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
      {text}
    </p>
  ]
}

export function MessageRenderer({
  content,
  messageId,
  role,
  className,
}: MessageRendererProps) {
  // Convert content to string if it's not already
  const textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2)

  // User messages are simple text (styling handled by MessageContent wrapper)
  if (role === 'user') {
    return (
      <div className={className}>
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {textContent}
        </div>
      </div>
    )
  }

  // Assistant messages may contain code blocks
  return (
    <div className={className}>
      {parseMarkdownWithCode(textContent)}
    </div>
  )
}