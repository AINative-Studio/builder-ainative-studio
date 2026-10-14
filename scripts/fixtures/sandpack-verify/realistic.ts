/**
 * Realistic fixture for the sandpack-bundler E2E verification harness
 * (scripts/verify-sandpack-bundler-e2e.ts).
 *
 * This mirrors the actual shape of Builder's real generated apps, not a
 * synthetic-light Sidebar+App.tsx toy. Component/icon vocabulary is pulled
 * directly from this repo's real auto-inject lists so the fixture exercises
 * the exact re-export surfaces that exposed issue #1089:
 *   - lib/multi-file-parser.ts's AIKIT_COMPONENTS / SHADCN_COMPONENT_FILE
 *   - components/chat/sandpack-preview.tsx's shadcnMap / allLucideIcons
 *
 * Deliberately imports MANY lucide-react icons and MANY shadcn/ui components
 * across multiple files — issue #1089's root cause (no tree-shaking in
 * sandpack-bundler's dependency walker) means importing even ONE icon from
 * lucide-react's ~1436-line re-export barrel eagerly transforms the entire
 * barrel; importing several compounds that cost further, which is exactly
 * what this fixture is designed to surface.
 */
import { getBuiltinFiles } from '../../../lib/sandpack/setup'
import type { SandpackFixture } from './types'

/**
 * Real shadcn/ui + AIKit component source + template (/src/index.tsx,
 * /public/index.html), straight from this repo's own Sandpack builtin
 * bundle assembler (lib/sandpack/setup.ts's getBuiltinFiles) — the exact
 * same files every real Builder preview ships, assembled the exact same
 * way components/chat/sandpack-preview.tsx does. Imported directly (not
 * copy-pasted) so this fixture never drifts from what Builder actually
 * sends to the bundler; if those bundles grow or change, this fixture
 * picks it up automatically.
 */
const builtinFiles: Record<string, string> = getBuiltinFiles()

export const realisticFixture: SandpackFixture = {
  name: 'realistic',
  description:
    'Multi-file app with multiple lucide-react icons + multiple shadcn/ui components — the exact shape that exposed #1089',
  dependencies: {
    react: '18.2.0',
    'react-dom': '18.2.0',
    'prop-types': '15.8.1',
    'lucide-react': '0.344.0',
    clsx: '2.1.0',
    'tailwind-merge': '2.2.0',
  },
  files: {
    ...builtinFiles,
    '/src/App.tsx': `import React, { useState } from 'react'
import { Search, Bell, Settings, User, TrendingUp, DollarSign, Users, Activity } from 'lucide-react'
import { Button } from './components/ui/button'
import { Card, CardHeader, CardContent, CardTitle, CardDescription, CardFooter } from './components/ui/card'
import { Input } from './components/ui/input'
import { Badge } from './components/ui/badge'
import { Avatar, AvatarImage, AvatarFallback } from './components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs'
import Dashboard from './components/Dashboard'

export default function App() {
  const [query, setQuery] = useState('')

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={24} />
          Realistic Fixture
        </h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Search size={18} />
          <Bell size={18} />
          <Settings size={18} />
          <Avatar>
            <AvatarImage src="https://example.com/avatar.png" />
            <AvatarFallback>AN</AvatarFallback>
          </Avatar>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search customers</CardTitle>
          <CardDescription>Realistic shadcn + lucide compile-time fixture</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Badge>Active</Badge>
            <Badge>Verified</Badge>
          </div>
        </CardContent>
        <CardFooter>
          <Button>
            <User size={16} style={{ marginRight: 6 }} />
            View profile
          </Button>
        </CardFooter>
      </Card>

      <Tabs defaultValue="overview" style={{ marginTop: 24 }}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <DollarSign size={16} /> Revenue, <Users size={16} /> customers, <Activity size={16} /> activity.
          </p>
        </TabsContent>
        <TabsContent value="dashboard">
          <Dashboard />
        </TabsContent>
      </Tabs>

      <p data-testid="verify-marker">sandpack-e2e-realistic-render-marker</p>
    </div>
  )
}
`,
    '/src/components/Dashboard.tsx': `import React from 'react'
import {
  BarChart3, PieChart, LineChart, Package, CreditCard, ShoppingCart,
  Calendar, Clock, Mail, MessageSquare, Star, Heart, Share2, Download,
} from 'lucide-react'
import { Card, CardHeader, CardContent, CardTitle } from './ui/card'
import { Progress } from './ui/progress'
import { Separator } from './ui/separator'
import MetricsRow from './MetricsRow'

export default function Dashboard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <MetricsRow />
      <Card>
        <CardHeader>
          <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={18} />
            Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: 'flex', gap: 16 }}>
            <PieChart size={32} />
            <LineChart size={32} />
            <Package size={32} />
            <CreditCard size={32} />
            <ShoppingCart size={32} />
          </div>
          <Progress value={64} style={{ marginTop: 12 }} />
          <Separator style={{ margin: '12px 0' }} />
          <div style={{ display: 'flex', gap: 12 }}>
            <Calendar size={16} />
            <Clock size={16} />
            <Mail size={16} />
            <MessageSquare size={16} />
            <Star size={16} />
            <Heart size={16} />
            <Share2 size={16} />
            <Download size={16} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
`,
    '/src/components/MetricsRow.tsx': `import React from 'react'
import { ArrowUp, ArrowDown, Zap, Target, Award, Flame } from 'lucide-react'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'

const metrics = [
  { label: 'MRR', value: '$12,400', delta: '+4.2%', up: true, Icon: Zap },
  { label: 'Churn', value: '2.1%', delta: '-0.3%', up: false, Icon: Target },
  { label: 'NPS', value: '58', delta: '+6', up: true, Icon: Award },
  { label: 'Active', value: '1,204', delta: '+112', up: true, Icon: Flame },
]

export default function MetricsRow() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {metrics.map((m) => (
        <Card key={m.label}>
          <CardContent style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{m.label}</span>
              <m.Icon size={16} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{m.value}</div>
            <Badge style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {m.up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {m.delta}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
`,
  },
  expectedText: 'sandpack-e2e-realistic-render-marker',
}
