/**
 * AIKit component bundle for Sandpack
 * Simplified standalone versions of AIKit components that work in Sandpack.
 */

export const aikitFiles: Record<string, string> = {
  '/src/components/aikit/index.ts': `
export { MetricCard } from './MetricCard'
export { AIKitPriceCard } from './AIKitPriceCard'
export { AIKitRating } from './AIKitRating'
export { AgentCard } from './AgentCard'
export { SwarmView } from './SwarmView'
export { SafetyBadge } from './SafetyBadge'
export { GuardrailPanel } from './GuardrailPanel'
export { ChatBubble } from './ChatBubble'
export { StreamingIndicator } from './StreamingIndicator'
export { CodeDisplay } from './CodeDisplay'
export { TokenUsageBar } from './TokenUsageBar'
export { ConnectionStatus } from './ConnectionStatus'
export { AIKitHeader } from './AIKitHeader'
export { AIKitSidebar } from './AIKitSidebar'
export { AIKitTable } from './AIKitTable'
export { AIKitTimeline } from './AIKitTimeline'
export { AIKitBanner } from './AIKitBanner'
export { AIKitAvatar } from './AIKitAvatar'
export { Skeleton, SkeletonCard } from './Skeleton'
export { EmptyState } from './EmptyState'
export { AIKitProductCard } from './AIKitProductCard'
export { AIKitPagination } from './AIKitPagination'
export { AIKitBreadcrumb } from './AIKitBreadcrumb'
export { AIKitStepper } from './AIKitStepper'
export { VideoPlayer } from './VideoPlayer'
export { StreamingText } from './StreamingText'
export { MediaGallery } from './MediaGallery'
export { AgentTimeline } from './AgentTimeline'
`,

  '/src/components/aikit/MetricCard.tsx': `
import React from 'react'
interface MetricCardProps { title: string; value: string | number; change?: string; changeType?: 'positive' | 'negative' | 'neutral'; icon?: React.ReactNode; sparklineData?: number[]; className?: string }
// Render an icon prop safely: apps often pass a component itself (icon={BarChart3})
// instead of an element (icon={<BarChart3/>}). A bare component (function or a
// forwardRef object { $$typeof, render }) is NOT a valid React child — rendering
// it throws "Objects are not valid as a React child". Mount components as
// elements; pass through valid elements/strings.
function renderIcon(icon: any) {
  if (!icon) return null
  if (typeof icon === 'function') return React.createElement(icon)
  if (typeof icon === 'object' && icon.\$\$typeof && icon.type === undefined) return React.createElement(icon)
  return icon
}
export function MetricCard({ title, value, change, changeType = 'neutral', icon, sparklineData, className = '' }: MetricCardProps) {
  const changeColor = changeType === 'positive' ? 'text-green-600' : changeType === 'negative' ? 'text-red-600' : 'text-gray-500'
  return (
    <div className={\`bg-white rounded-xl border border-gray-200 p-6 \${className}\`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">{title}</span>
        {icon && <span className="text-gray-400">{renderIcon(icon)}</span>}
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {change && <span className={\`text-sm \${changeColor}\`}>{change}</span>}
      {sparklineData && sparklineData.length > 0 && (
        <svg viewBox="0 0 100 30" className="w-full h-8 mt-2">
          <polyline fill="none" stroke={changeType === 'positive' ? '#16a34a' : changeType === 'negative' ? '#dc2626' : '#6b7280'} strokeWidth="2"
            points={sparklineData.map((v, i) => \`\${(i / (sparklineData.length - 1)) * 100},\${30 - (v / Math.max(...sparklineData)) * 28}\`).join(' ')} />
        </svg>
      )}
    </div>
  )
}
`,

  '/src/components/aikit/AIKitPriceCard.tsx': `
import React from 'react'
interface PriceCardProps { name: string; price: string; period?: string; features: string[]; cta?: string; highlighted?: boolean; className?: string }
export function AIKitPriceCard({ name, price, period = '/month', features, cta = 'Get Started', highlighted = false, className = '' }: PriceCardProps) {
  return (
    <div className={\`rounded-xl border p-6 \${highlighted ? 'border-blue-500 shadow-lg ring-2 ring-blue-500' : 'border-gray-200'} \${className}\`}>
      <h3 className="text-lg font-semibold">{name}</h3>
      <div className="mt-4"><span className="text-4xl font-bold">{price}</span><span className="text-gray-500">{period}</span></div>
      <button className={\`mt-6 w-full py-2 px-4 rounded-lg font-medium \${highlighted ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}\`}>{cta}</button>
      <ul className="mt-6 space-y-3">{features.map((f, i) => <li key={i} className="flex items-center gap-2 text-sm"><svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>{f}</li>)}</ul>
    </div>
  )
}
`,

  '/src/components/aikit/AIKitRating.tsx': `
import React from 'react'
interface RatingProps { value: number; max?: number; size?: 'sm' | 'md' | 'lg'; className?: string }
export function AIKitRating({ value, max = 5, size = 'md', className = '' }: RatingProps) {
  const sz = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'
  return (
    <div className={\`flex gap-0.5 \${className}\`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} className={\`\${sz} \${i < value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}\`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      ))}
    </div>
  )
}
`,

  '/src/components/aikit/AgentCard.tsx': `
import React from 'react'
interface AgentCardProps { name: string; role: string; status: 'active' | 'idle' | 'busy' | 'error'; tasks?: number; uptime?: string; model?: string; tokenUsage?: string; className?: string }
export function AgentCard({ name, role, status, tasks = 0, uptime, model, tokenUsage, className = '' }: AgentCardProps) {
  const statusColor = { active: 'bg-green-500', idle: 'bg-gray-400', busy: 'bg-yellow-500', error: 'bg-red-500' }[status]
  return (
    <div className={\`bg-white rounded-xl border border-gray-200 p-4 \${className}\`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={\`w-2 h-2 rounded-full \${statusColor}\`} />
        <div><div className="font-medium text-sm">{name}</div><div className="text-xs text-gray-500">{role}</div></div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-gray-500">Tasks</span><div className="font-medium">{tasks}</div></div>
        {uptime && <div><span className="text-gray-500">Uptime</span><div className="font-medium">{uptime}</div></div>}
        {model && <div><span className="text-gray-500">Model</span><div className="font-medium">{model}</div></div>}
        {tokenUsage && <div><span className="text-gray-500">Tokens</span><div className="font-medium">{tokenUsage}</div></div>}
      </div>
    </div>
  )
}
`,

  '/src/components/aikit/SwarmView.tsx': `
import React from 'react'
import { AgentCard } from './AgentCard'
interface SwarmViewProps { agents: Array<{ name: string; role: string; status: 'active' | 'idle' | 'busy' | 'error'; tasks?: number }>; title?: string; className?: string }
export function SwarmView({ agents, title = 'Agent Swarm', className = '' }: SwarmViewProps) {
  return (
    <div className={\`\${className}\`}>
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((a, i) => <AgentCard key={i} {...a} />)}
      </div>
    </div>
  )
}
`,

  '/src/components/aikit/SafetyBadge.tsx': `
import React from 'react'
interface SafetyBadgeProps { level: 'safe' | 'caution' | 'warning' | 'danger'; label?: string; className?: string }
export function SafetyBadge({ level, label, className = '' }: SafetyBadgeProps) {
  const styles = { safe: 'bg-green-100 text-green-800', caution: 'bg-yellow-100 text-yellow-800', warning: 'bg-orange-100 text-orange-800', danger: 'bg-red-100 text-red-800' }[level]
  return <span className={\`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${styles} \${className}\`}>{label || level}</span>
}
`,

  '/src/components/aikit/GuardrailPanel.tsx': `
import React from 'react'
interface Rule { name: string; status: 'passed' | 'failed' | 'warning'; description?: string }
interface GuardrailPanelProps { rules: Rule[]; className?: string }
export function GuardrailPanel({ rules, className = '' }: GuardrailPanelProps) {
  return (
    <div className={\`bg-white rounded-xl border border-gray-200 p-4 \${className}\`}>
      <h3 className="font-semibold mb-3">Safety Guardrails</h3>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className={\`w-2 h-2 rounded-full \${r.status === 'passed' ? 'bg-green-500' : r.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'}\`} />
            <span className="font-medium">{r.name}</span>
            {r.description && <span className="text-gray-500">— {r.description}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
`,

  '/src/components/aikit/ChatBubble.tsx': `
import React from 'react'
interface ChatBubbleProps { role: 'user' | 'assistant'; children: React.ReactNode; name?: string; timestamp?: string; className?: string }
export function ChatBubble({ role, children, name, timestamp, className = '' }: ChatBubbleProps) {
  const isUser = role === 'user'
  return (
    <div className={\`flex \${isUser ? 'justify-end' : 'justify-start'} \${className}\`}>
      <div className={\`max-w-[80%] rounded-2xl px-4 py-3 \${isUser ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}\`}>
        {name && <div className={\`text-xs font-medium mb-1 \${isUser ? 'text-blue-200' : 'text-gray-500'}\`}>{name}</div>}
        <div className="text-sm">{children}</div>
        {timestamp && <div className={\`text-xs mt-1 \${isUser ? 'text-blue-200' : 'text-gray-400'}\`}>{timestamp}</div>}
      </div>
    </div>
  )
}
`,

  '/src/components/aikit/StreamingIndicator.tsx': `
import React from 'react'
interface StreamingIndicatorProps { variant?: 'dots' | 'bar'; color?: string; className?: string }
export function StreamingIndicator({ variant = 'dots', color = '#3b82f6', className = '' }: StreamingIndicatorProps) {
  if (variant === 'bar') return <div className={\`h-1 bg-gray-200 rounded-full overflow-hidden \${className}\`}><div className="h-full rounded-full animate-pulse" style={{ width: '60%', backgroundColor: color }} /></div>
  return (
    <div className={\`flex gap-1 \${className}\`}>
      {[0, 1, 2].map(i => <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: \`\${i * 0.15}s\` }} />)}
    </div>
  )
}
`,

  '/src/components/aikit/CodeDisplay.tsx': `
import React from 'react'
interface CodeDisplayProps { code: string; language?: string; showLineNumbers?: boolean; className?: string }
export function CodeDisplay({ code, language = 'javascript', showLineNumbers = true, className = '' }: CodeDisplayProps) {
  const lines = code.split('\\n')
  return (
    <div className={\`bg-gray-900 rounded-xl overflow-hidden \${className}\`}>
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 text-xs text-gray-400">
        <span>{language}</span>
        <button onClick={() => navigator.clipboard.writeText(code)} className="hover:text-white">Copy</button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm text-gray-100">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            {showLineNumbers && <span className="select-none text-gray-600 mr-4 text-right" style={{ minWidth: '2em' }}>{i + 1}</span>}
            <code>{line}</code>
          </div>
        ))}
      </pre>
    </div>
  )
}
`,

  '/src/components/aikit/TokenUsageBar.tsx': `
import React from 'react'
interface TokenUsageBarProps { used: number; limit: number; label?: string; className?: string }
export function TokenUsageBar({ used, limit, label = 'Token Usage', className = '' }: TokenUsageBarProps) {
  const pct = Math.min((used / limit) * 100, 100)
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500'
  return (
    <div className={\`\${className}\`}>
      <div className="flex justify-between text-sm mb-1"><span className="text-gray-600">{label}</span><span className="font-medium">{used.toLocaleString()} / {limit.toLocaleString()}</span></div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className={\`h-full rounded-full transition-all \${color}\`} style={{ width: \`\${pct}%\` }} /></div>
    </div>
  )
}
`,

  '/src/components/aikit/ConnectionStatus.tsx': `
import React from 'react'
interface ConnectionStatusProps { status: 'connected' | 'connecting' | 'disconnected' | 'error'; agentName?: string; latency?: number; className?: string }
export function ConnectionStatus({ status, agentName, latency, className = '' }: ConnectionStatusProps) {
  const dot = { connected: 'bg-green-500', connecting: 'bg-yellow-500 animate-pulse', disconnected: 'bg-gray-400', error: 'bg-red-500' }[status]
  return (
    <div className={\`flex items-center gap-2 text-sm \${className}\`}>
      <div className={\`w-2 h-2 rounded-full \${dot}\`} />
      <span className="capitalize">{status}</span>
      {agentName && <span className="text-gray-500">({agentName})</span>}
      {latency !== undefined && <span className="text-gray-400">{latency}ms</span>}
    </div>
  )
}
`,

  '/src/components/aikit/AIKitHeader.tsx': `
import React from 'react'
interface AIKitHeaderProps { title: string; logo?: React.ReactNode; nav?: Array<{ label: string; href?: string }>; actions?: React.ReactNode; className?: string }
export function AIKitHeader({ title, logo, nav = [], actions, className = '' }: AIKitHeaderProps) {
  return (
    <header className={\`flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white \${className}\`}>
      <div className="flex items-center gap-3">{logo}<span className="text-lg font-semibold">{title}</span></div>
      {nav.length > 0 && <nav className="hidden md:flex items-center gap-6">{nav.map((n, i) => <a key={i} href={n.href || '#'} className="text-sm text-gray-600 hover:text-gray-900">{n.label}</a>)}</nav>}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
`,

  '/src/components/aikit/AIKitSidebar.tsx': `
import React from 'react'
interface SidebarItem { label: string; icon?: React.ReactNode; active?: boolean; href?: string }
interface AIKitSidebarProps { items: SidebarItem[]; title?: string; className?: string }
function renderIcon(icon: any) {
  if (!icon) return null
  if (typeof icon === 'function') return React.createElement(icon)
  if (typeof icon === 'object' && icon.\$\$typeof && icon.type === undefined) return React.createElement(icon)
  return icon
}
export function AIKitSidebar({ items, title, className = '' }: AIKitSidebarProps) {
  return (
    <aside className={\`w-64 border-r border-gray-200 bg-white p-4 \${className}\`}>
      {title && <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">{title}</h2>}
      <nav className="space-y-1">
        {items.map((item, i) => (
          <a key={i} href={item.href || '#'} className={\`flex items-center gap-3 px-3 py-2 rounded-lg text-sm \${item.active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}\`}>
            {renderIcon(item.icon)}{item.label}
          </a>
        ))}
      </nav>
    </aside>
  )
}
`,

  '/src/components/aikit/AIKitTable.tsx': `
import React from 'react'
interface AIKitTableProps { columns: Array<{ key: string; label: string }>; data: Array<Record<string, any>>; className?: string }
export function AIKitTable({ columns, data, className = '' }: AIKitTableProps) {
  return (
    <div className={\`overflow-x-auto rounded-xl border border-gray-200 \${className}\`}>
      <table className="w-full text-sm">
        <thead><tr className="bg-gray-50 border-b border-gray-200">{columns.map(c => <th key={c.key} className="text-left px-4 py-3 font-medium text-gray-600">{c.label}</th>)}</tr></thead>
        <tbody>{data.map((row, i) => <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">{columns.map(c => <td key={c.key} className="px-4 py-3">{row[c.key]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
`,

  '/src/components/aikit/AIKitTimeline.tsx': `
import React from 'react'
interface TimelineEvent { type?: string; agent?: string; message: string; duration?: string; tokens?: number }
interface AIKitTimelineProps { events: TimelineEvent[]; className?: string }
export function AIKitTimeline({ events, className = '' }: AIKitTimelineProps) {
  return (
    <div className={\`space-y-4 \${className}\`}>
      {events.map((e, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center"><div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />{i < events.length - 1 && <div className="w-px flex-1 bg-gray-200" />}</div>
          <div className="pb-4"><div className="text-sm font-medium">{e.message}</div><div className="text-xs text-gray-500 mt-1">{[e.agent, e.duration, e.tokens ? \`\${e.tokens} tokens\` : null].filter(Boolean).join(' · ')}</div></div>
        </div>
      ))}
    </div>
  )
}
`,

  '/src/components/aikit/AIKitBanner.tsx': `
import React from 'react'
interface AIKitBannerProps { variant?: 'info' | 'success' | 'warning' | 'error'; children: React.ReactNode; dismissible?: boolean; className?: string }
export function AIKitBanner({ variant = 'info', children, dismissible, className = '' }: AIKitBannerProps) {
  const [dismissed, setDismissed] = React.useState(false)
  if (dismissed) return null
  const styles = { info: 'bg-blue-50 text-blue-800 border-blue-200', success: 'bg-green-50 text-green-800 border-green-200', warning: 'bg-yellow-50 text-yellow-800 border-yellow-200', error: 'bg-red-50 text-red-800 border-red-200' }[variant]
  return (
    <div className={\`flex items-center justify-between px-4 py-3 rounded-lg border \${styles} \${className}\`}>
      <span className="text-sm">{children}</span>
      {dismissible && <button onClick={() => setDismissed(true)} className="text-current opacity-50 hover:opacity-100">x</button>}
    </div>
  )
}
`,

  '/src/components/aikit/AIKitAvatar.tsx': `
import React from 'react'
interface AIKitAvatarProps { src?: string; name?: string; status?: 'online' | 'offline' | 'busy'; size?: 'sm' | 'md' | 'lg'; className?: string }
export function AIKitAvatar({ src, name, status, size = 'md', className = '' }: AIKitAvatarProps) {
  const sz = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' }[size]
  const initials = name ? name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?'
  const statusDot = status ? { online: 'bg-green-500', offline: 'bg-gray-400', busy: 'bg-red-500' }[status] : null
  return (
    <div className={\`relative inline-flex \${className}\`}>
      {src ? <img src={src} alt={name || ''} className={\`\${sz} rounded-full object-cover\`} /> : <div className={\`\${sz} rounded-full bg-gray-200 flex items-center justify-center font-medium text-gray-600\`}>{initials}</div>}
      {statusDot && <div className={\`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white \${statusDot}\`} />}
    </div>
  )
}
`,

  '/src/components/aikit/Skeleton.tsx': `
import React from 'react'
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={\`animate-pulse bg-gray-200 rounded \${className}\`} />
}
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={\`bg-white rounded-xl border border-gray-200 p-6 space-y-4 \${className}\`}>
      <Skeleton className="h-4 w-1/3" /><Skeleton className="h-8 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
    </div>
  )
}
`,

  '/src/components/aikit/EmptyState.tsx': `
import React from 'react'
interface EmptyStateProps { title?: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode; className?: string }
function renderIcon(icon: any) {
  if (!icon) return null
  if (typeof icon === 'function') return React.createElement(icon)
  if (typeof icon === 'object' && icon.\$\$typeof && icon.type === undefined) return React.createElement(icon)
  return icon
}
export function EmptyState({ title = 'No data', description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div className={\`flex flex-col items-center justify-center py-12 text-center \${className}\`}>
      {icon && <div className="mb-4 text-gray-400">{renderIcon(icon)}</div>}
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
`,

  '/src/components/aikit/AIKitProductCard.tsx': `
import React from 'react'
import { AIKitRating } from './AIKitRating'
interface ProductCardProps { name: string; price: string; image?: string; rating?: number; reviews?: number; badge?: string; className?: string }
export function AIKitProductCard({ name, price, image, rating, reviews, badge, className = '' }: ProductCardProps) {
  return (
    <div className={\`bg-white rounded-xl border border-gray-200 overflow-hidden group \${className}\`}>
      <div className="aspect-square bg-gray-100 relative overflow-hidden">
        {image ? <img src={image} alt={name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" /> : <div className="w-full h-full flex items-center justify-center text-gray-400">No image</div>}
        {badge && <span className="absolute top-2 left-2 bg-black text-white text-xs px-2 py-1 rounded">{badge}</span>}
      </div>
      <div className="p-4">
        <h3 className="font-medium text-sm">{name}</h3>
        <div className="flex items-center justify-between mt-2">
          <span className="font-bold">{price}</span>
          {rating !== undefined && <div className="flex items-center gap-1"><AIKitRating value={rating} size="sm" />{reviews !== undefined && <span className="text-xs text-gray-500">({reviews})</span>}</div>}
        </div>
      </div>
    </div>
  )
}
`,

  '/src/components/aikit/AIKitPagination.tsx': `
import React from 'react'
interface AIKitPaginationProps { currentPage: number; totalPages: number; onPageChange?: (page: number) => void; className?: string }
export function AIKitPagination({ currentPage, totalPages, onPageChange, className = '' }: AIKitPaginationProps) {
  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1)
  return (
    <nav className={\`flex items-center gap-1 \${className}\`}>
      <button disabled={currentPage <= 1} onClick={() => onPageChange?.(currentPage - 1)} className="px-3 py-1 rounded text-sm border border-gray-200 disabled:opacity-50">Prev</button>
      {pages.map(p => <button key={p} onClick={() => onPageChange?.(p)} className={\`px-3 py-1 rounded text-sm \${p === currentPage ? 'bg-blue-600 text-white' : 'border border-gray-200 hover:bg-gray-50'}\`}>{p}</button>)}
      <button disabled={currentPage >= totalPages} onClick={() => onPageChange?.(currentPage + 1)} className="px-3 py-1 rounded text-sm border border-gray-200 disabled:opacity-50">Next</button>
    </nav>
  )
}
`,

  '/src/components/aikit/AIKitBreadcrumb.tsx': `
import React from 'react'
interface Crumb { label: string; href?: string }
interface AIKitBreadcrumbProps { items: Crumb[]; className?: string }
export function AIKitBreadcrumb({ items, className = '' }: AIKitBreadcrumbProps) {
  return (
    <nav className={\`flex items-center gap-2 text-sm \${className}\`}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-gray-400">/</span>}
          {i === items.length - 1 ? <span className="text-gray-900 font-medium">{item.label}</span> : <a href={item.href || '#'} className="text-gray-500 hover:text-gray-700">{item.label}</a>}
        </React.Fragment>
      ))}
    </nav>
  )
}
`,

  '/src/components/aikit/AIKitStepper.tsx': `
import React from 'react'
interface Step { label: string; description?: string }
interface AIKitStepperProps { steps: Step[]; currentStep: number; className?: string }
export function AIKitStepper({ steps, currentStep, className = '' }: AIKitStepperProps) {
  return (
    <div className={\`flex items-center \${className}\`}>
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div className="flex items-center gap-2">
            <div className={\`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium \${i < currentStep ? 'bg-green-500 text-white' : i === currentStep ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}\`}>{i < currentStep ? '\\u2713' : i + 1}</div>
            <div><div className="text-sm font-medium">{step.label}</div>{step.description && <div className="text-xs text-gray-500">{step.description}</div>}</div>
          </div>
          {i < steps.length - 1 && <div className={\`flex-1 h-px mx-4 \${i < currentStep ? 'bg-green-500' : 'bg-gray-200'}\`} />}
        </React.Fragment>
      ))}
    </div>
  )
}
`,

  '/src/components/aikit/VideoPlayer.tsx': `
import React from 'react'
interface VideoPlayerProps { src: string; poster?: string; title?: string; className?: string }
export function VideoPlayer({ src, poster, title, className = '' }: VideoPlayerProps) {
  return (
    <div className={\`rounded-xl overflow-hidden bg-black \${className}\`}>
      {title && <div className="px-4 py-2 bg-gray-900 text-white text-sm">{title}</div>}
      <video src={src} poster={poster} controls className="w-full" />
    </div>
  )
}
`,

  '/src/components/aikit/StreamingText.tsx': `
import React from 'react'
interface StreamingTextProps { text: string; speed?: number; className?: string }
export function StreamingText({ text, speed = 30, className = '' }: StreamingTextProps) {
  const [displayed, setDisplayed] = React.useState('')
  React.useEffect(() => {
    let i = 0
    setDisplayed('')
    const timer = setInterval(() => {
      if (i < text.length) { setDisplayed(prev => prev + text[i]); i++ } else clearInterval(timer)
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed])
  return <span className={className}>{displayed}<span className="animate-pulse">|</span></span>
}
`,

  '/src/components/aikit/MediaGallery.tsx': `
import React from 'react'
interface MediaItem { src: string; alt?: string; type?: 'image' | 'video' }
interface MediaGalleryProps { items: MediaItem[]; columns?: number; className?: string }
export function MediaGallery({ items, columns = 3, className = '' }: MediaGalleryProps) {
  return (
    <div className={\`grid gap-4 \${className}\`} style={{ gridTemplateColumns: \`repeat(\${columns}, 1fr)\` }}>
      {items.map((item, i) => (
        <div key={i} className="rounded-xl overflow-hidden bg-gray-100 aspect-square">
          {item.type === 'video' ? <video src={item.src} controls className="w-full h-full object-cover" /> : <img src={item.src} alt={item.alt || ''} className="w-full h-full object-cover" />}
        </div>
      ))}
    </div>
  )
}
`,

  '/src/components/aikit/AgentTimeline.tsx': `
import React from 'react'
interface TimelineEvent { type: 'thinking' | 'tool_call' | 'response' | 'error' | 'handoff' | 'checkpoint'; agent?: string; message: string; duration?: string; tokens?: number }
interface AgentTimelineProps { events: TimelineEvent[]; className?: string }
export function AgentTimeline({ events, className = '' }: AgentTimelineProps) {
  const typeColors: Record<string, string> = { thinking: 'bg-blue-500', tool_call: 'bg-purple-500', response: 'bg-green-500', error: 'bg-red-500', handoff: 'bg-yellow-500', checkpoint: 'bg-gray-500' }
  return (
    <div className={\`space-y-3 \${className}\`}>
      {events.map((e, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={\`w-3 h-3 rounded-full mt-1.5 \${typeColors[e.type] || 'bg-gray-400'}\`} />
            {i < events.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1" />}
          </div>
          <div className="pb-4 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">{e.type}</span>
              {e.agent && <span className="text-xs text-gray-500">{e.agent}</span>}
            </div>
            <div className="text-sm mt-1">{e.message}</div>
            <div className="text-xs text-gray-400 mt-0.5">{[e.duration, e.tokens ? \`\${e.tokens} tokens\` : null].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
`,
}
