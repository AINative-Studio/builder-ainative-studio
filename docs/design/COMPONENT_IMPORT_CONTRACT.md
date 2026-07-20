# Closed Component / Import Contract (Artifacts-style)

**Goal:** make generated output clean *by construction* — the way Claude Artifacts does — by narrowing what the model may import to a closed, verified vocabulary that always resolves in our renderer. This kills the bug classes we chased all session (#115 recharts scope, #117 icon-as-child, #118 wrong ui/* subpath) at generation time instead of repairing them at render time.

This is the **single-file preview tier** contract (presets + most generations). The persistent/multi-file tier (real Sandpack + real npm) is a separate track — see issue #91.

The whitelist below is generated from what the renderer ACTUALLY provides
(`lib/sandpack/shadcn-bundle.ts`, `lib/sandpack/aikit-bundle.ts`). If a component
isn't here, the renderer can't resolve it → the model must not use it.

---

## The contract (drop-in replacement for the AVAILABLE/AIKIT/IMPORT blocks in the concise prompt)

```
COMPONENT CONTRACT — you may ONLY import from these exact sources. Anything else
will not resolve. Copy the import lines verbatim; import each name from the file
listed for it. Do NOT invent components, and do NOT import a component from a
file other than the one shown.

npm packages (only these three):
- import React, { useState, useEffect, useMemo, useRef } from 'react'
- import { <IconName>, ... } from 'lucide-react'   // any Lucide icon name
- import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, RadarChart, Radar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

shadcn UI — import each from its OWN file (this exact mapping):
- './components/ui/button'    → Button
- './components/ui/card'      → Card, CardHeader, CardContent, CardTitle, CardDescription, CardFooter
- './components/ui/badge'     → Badge
- './components/ui/input'     → Input
- './components/ui/label'     → Label
- './components/ui/avatar'    → Avatar, AvatarImage, AvatarFallback
- './components/ui/tabs'      → Tabs, TabsList, TabsTrigger, TabsContent
- './components/ui/table'     → Table, TableHeader, TableBody, TableRow, TableHead, TableCell
- './components/ui/separator' → Separator
- './components/ui/dialog'    → Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
- './components/ui/select'    → Select, SelectTrigger, SelectValue, SelectContent, SelectItem
- './components/ui/progress'  → Progress, CircularProgress
- './components/ui/checkbox'  → Checkbox, RadioGroup, RadioGroupItem
- './components/ui/accordion' → Accordion, AccordionItem, AccordionTrigger, AccordionContent
- './components/ui/alert'     → Alert, AlertTitle, AlertDescription
- './components/ui/popover'   → Popover, PopoverTrigger, PopoverContent
- './components/ui/switch'    → Switch
- './components/ui/textarea'  → Textarea
- './components/ui/tooltip'   → TooltipProvider, Tooltip, TooltipTrigger, TooltipContent

AINative AIKit — all from './components/aikit':
- import { MetricCard, AgentCard, SwarmView, SafetyBadge, GuardrailPanel, ChatBubble,
    StreamingIndicator, CodeDisplay, TokenUsageBar, ConnectionStatus, AIKitHeader,
    AIKitSidebar, AIKitTable, AIKitTimeline, AIKitBanner, AIKitAvatar, AIKitRating,
    AIKitPriceCard, AIKitProductCard, AIKitPagination, AIKitBreadcrumb, AIKitStepper,
    AgentTimeline, EmptyState, Skeleton, SkeletonCard } from './components/aikit'
  Key props: MetricCard(title,value,change,changeType,icon,sparklineData) ·
  SwarmView(agents[],title) · AgentCard(name,role,status,tasks) ·
  GuardrailPanel(rules[]) · TokenUsageBar(used,limit,label) ·
  AIKitSidebar(items[{label,icon,active,href}],title) · AIKitTable(columns[],data[])

HARD RULES (these are the crash causes — obey exactly):
1. ICONS ARE ELEMENTS, NEVER VALUES. Render an icon as <Home className="w-5 h-5" />.
   NEVER put a bare icon component in JSX children ({Home}) and NEVER store a
   component in data (icon: Home). If a card takes an icon prop, pass an element:
   icon={<BarChart3 className="w-5 h-5" />}, not icon={BarChart3}.
2. CHARTS ARE ELEMENTS. Use recharts components as JSX (<LineChart>…</LineChart>),
   never as bare references. Import chart names from 'recharts' (above), not lucide.
3. IMPORT EACH NAME FROM ITS FILE (see mapping). Never import Card/Badge/Progress
   from './components/ui/button' — button.tsx only exports Button.
4. NEVER import from @ainative/*, @/components/*, npm 'aikit', framer-motion,
   @radix-ui, or any package not listed above.
5. export default function App() — always a single default-exported App component.
6. For persisted data use /api/db (see DATA/PERSISTENCE), never localStorage.
```

---

## Why each rule maps to a real bug we fixed

| Rule | Bug it prevents at source | Prior fix (downstream patch) |
|---|---|---|
| Rule 1 (icons are elements) | icon-object rendered as React child → "Objects are not valid as a React child" | #108 / #117 (guard + renderIcon stubs) |
| Rule 2 (charts are elements, from recharts) | `<RePieChart>`/`<LineChart>` resolving to undefined or a lucide icon | #115 (recharts-on-window) |
| Rule 3 (import each name from its file) | `Card` from `ui/button` → undefined component | #118 (fixWrongShadcnSubpaths) |
| Closed whitelist | hallucinated components (#76) | code-validator findUnresolvedComponents |

The downstream fixes stay as a safety net. The contract stops the model from
producing the defect in the first place — the Artifacts approach.

---

## Rollout

1. Replace lines ~597-631 of `app/api/chat-ws/route.ts` (the AVAILABLE COMPONENTS
   / AIKIT COMPONENTS / IMPORT RULES blocks) with the contract above. Keep the
   DATA/PERSISTENCE block as-is.
2. A/B the defect rate: run `e2e/authoritative-sweep.spec.ts` before/after and
   compare the ERROR/FALLBACK count (expect the icon/chart/subpath crashes to
   drop toward zero at generation time).
3. Regenerate this contract from the stubs whenever aikit-bundle/shadcn-bundle
   change, so the whitelist never drifts from what the renderer provides. A tiny
   script that greps `export function` from both bundles keeps it honest.

## Non-goals

This contract governs the **single-file preview tier**. It intentionally does NOT
try to support multi-file projects or arbitrary npm deps — that's the real-bundler
track (issue #91), where the answer is real Sandpack/WebContainer with real
packages, not a whitelist.
