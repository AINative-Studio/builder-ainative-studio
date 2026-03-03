export const saasDashboardTemplate = {
  name: 'SaaS Dashboard',
  category: 'dashboard',
  description: 'A comprehensive SaaS dashboard with metric cards, charts, data tables, and sidebar navigation. Perfect for analytics and monitoring applications.',
  code: `'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  ShoppingCart,
  Activity,
  Menu,
  Bell,
  Search,
  Settings,
  ChevronRight,
} from 'lucide-react'

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Mock data for charts
  const revenueData = [
    { month: 'Jan', revenue: 4000, users: 240 },
    { month: 'Feb', revenue: 3000, users: 198 },
    { month: 'Mar', revenue: 5000, users: 380 },
    { month: 'Apr', revenue: 4500, users: 340 },
    { month: 'May', revenue: 6000, users: 420 },
    { month: 'Jun', revenue: 5500, users: 390 },
  ]

  const performanceData = [
    { name: 'Week 1', value: 85 },
    { name: 'Week 2', value: 72 },
    { name: 'Week 3', value: 90 },
    { name: 'Week 4', value: 78 },
  ]

  // Mock recent activity
  const recentActivity = [
    { id: 1, user: 'John Doe', action: 'Created new project', time: '2 min ago' },
    { id: 2, user: 'Jane Smith', action: 'Updated settings', time: '15 min ago' },
    { id: 3, user: 'Bob Johnson', action: 'Deployed to production', time: '1 hour ago' },
    { id: 4, user: 'Alice Brown', action: 'Added team member', time: '2 hours ago' },
  ]

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={\`\${sidebarOpen ? 'w-64' : 'w-20'} transition-all duration-300 border-r bg-card\`}
        aria-label="Sidebar navigation"
      >
        <div className="flex items-center justify-between p-4">
          <h1 className={\`font-bold text-xl \${!sidebarOpen && 'hidden'}\`}>
            {{app_name}}
          </h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
        <Separator />
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="space-y-2">
            {[
              { icon: Activity, label: 'Dashboard', active: true },
              { icon: Users, label: 'Users', active: false },
              { icon: ShoppingCart, label: 'Orders', active: false },
              { icon: DollarSign, label: 'Revenue', active: false },
              { icon: Settings, label: 'Settings', active: false },
            ].map((item) => (
              <Button
                key={item.label}
                variant={item.active ? 'secondary' : 'ghost'}
                className={\`w-full justify-\${sidebarOpen ? 'start' : 'center'}\`}
              >
                <item.icon className="h-5 w-5" />
                {sidebarOpen && <span className="ml-3">{item.label}</span>}
              </Button>
            ))}
          </nav>
        </ScrollArea>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b bg-card">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center flex-1">
              <div className="relative w-96">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Search..."
                  className="w-full pl-10 pr-4 py-2 border rounded-md bg-background"
                  aria-label="Search"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" aria-label="Notifications">
                <Bell className="h-5 w-5" />
              </Button>
              <Avatar>
                <AvatarFallback>JD</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h2 className="text-3xl font-bold tracking-tight">{{dashboard_title}}</h2>
              <p className="text-muted-foreground">
                Welcome back! Here's what's happening with your business today.
              </p>
            </div>

            {/* Metric Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{{metric1_title}}</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">$45,231.89</div>
                  <div className="flex items-center text-xs text-green-600">
                    <TrendingUp className="h-4 w-4 mr-1" />
                    <span>+20.1% from last month</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{{metric2_title}}</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">+2,350</div>
                  <div className="flex items-center text-xs text-green-600">
                    <TrendingUp className="h-4 w-4 mr-1" />
                    <span>+180.1% from last month</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{{metric3_title}}</CardTitle>
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">+12,234</div>
                  <div className="flex items-center text-xs text-green-600">
                    <TrendingUp className="h-4 w-4 mr-1" />
                    <span>+19% from last month</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{{metric4_title}}</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">+573</div>
                  <div className="flex items-center text-xs text-red-600">
                    <TrendingDown className="h-4 w-4 mr-1" />
                    <span>-4.5% from last month</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts Section */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
              <Card className="col-span-4">
                <CardHeader>
                  <CardTitle>Revenue Overview</CardTitle>
                  <CardDescription>Monthly revenue and user growth</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="users"
                        stroke="hsl(var(--secondary))"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="col-span-3">
                <CardHeader>
                  <CardTitle>Recent Activity</CardTitle>
                  <CardDescription>Latest updates from your team</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-4">
                      {recentActivity.map((activity) => (
                        <div key={activity.id} className="flex items-start gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {activity.user
                                .split(' ')
                                .map((n) => n[0])
                                .join('')}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 space-y-1">
                            <p className="text-sm font-medium">{activity.user}</p>
                            <p className="text-sm text-muted-foreground">{activity.action}</p>
                            <p className="text-xs text-muted-foreground">{activity.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Performance Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
                <CardDescription>Weekly performance breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Data Table */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Transactions</CardTitle>
                <CardDescription>A list of your recent transactions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium">Customer</th>
                        <th className="text-left py-3 px-4 font-medium">Status</th>
                        <th className="text-left py-3 px-4 font-medium">Amount</th>
                        <th className="text-left py-3 px-4 font-medium">Date</th>
                        <th className="text-right py-3 px-4 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { id: 1, customer: 'Olivia Martin', status: 'Completed', amount: '$1,999.00', date: '2024-01-15' },
                        { id: 2, customer: 'Jackson Lee', status: 'Processing', amount: '$399.00', date: '2024-01-14' },
                        { id: 3, customer: 'Isabella Nguyen', status: 'Completed', amount: '$299.00', date: '2024-01-13' },
                        { id: 4, customer: 'William Kim', status: 'Failed', amount: '$99.00', date: '2024-01-12' },
                        { id: 5, customer: 'Sofia Davis', status: 'Completed', amount: '$549.00', date: '2024-01-11' },
                      ].map((transaction) => (
                        <tr key={transaction.id} className="border-b hover:bg-muted/50">
                          <td className="py-3 px-4">{transaction.customer}</td>
                          <td className="py-3 px-4">
                            <Badge
                              variant={
                                transaction.status === 'Completed'
                                  ? 'default'
                                  : transaction.status === 'Processing'
                                  ? 'secondary'
                                  : 'destructive'
                              }
                            >
                              {transaction.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 font-medium">{transaction.amount}</td>
                          <td className="py-3 px-4 text-muted-foreground">{transaction.date}</td>
                          <td className="py-3 px-4 text-right">
                            <Button variant="ghost" size="sm">
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  )
}`,
  tags: ['dashboard', 'analytics', 'charts', 'saas', 'metrics', 'admin'],
  metadata: {
    placeholders: ['app_name', 'dashboard_title', 'metric1_title', 'metric2_title', 'metric3_title', 'metric4_title'],
    components_used: [
      'Card',
      'Button',
      'Badge',
      'Avatar',
      'Tabs',
      'ScrollArea',
      'Separator',
      'Recharts',
    ],
    complexity: 'advanced' as const,
  },
  preview_image_url: null,
}
