/**
 * SEO Template Catalog — single source of truth for the individually indexable
 * template landing pages at /templates/[slug].
 *
 * These are static, build-time data (NOT fetched from the DB at request time) so
 * that each page can be statically generated, crawled, and indexed by search
 * engines. Each entry targets an "AI <category> template" search intent.
 *
 * Keep this list in sync with:
 *   - app/templates/[slug]/page.tsx (generateStaticParams reads TEMPLATE_SLUGS)
 *   - app/sitemap.ts (emits one URL per slug)
 */

export interface SeoTemplateFeature {
  title: string
  description: string
}

export interface SeoTemplate {
  /** URL slug — must be unique and URL-safe. */
  slug: string
  /** Human-friendly template name. */
  name: string
  /** Primary category, used in the "AI <category> template" title. */
  category: string
  /** Short one-line summary (used in cards + meta description). */
  tagline: string
  /** Rich, multi-sentence description shown on the page + in JSON-LD. */
  description: string
  /** Complexity signal shown as a badge. */
  complexity: 'simple' | 'medium' | 'advanced'
  /** SEO keywords for <meta keywords> + JSON-LD. */
  keywords: string[]
  /** Short tags shown as pills. */
  tags: string[]
  /** Key selling-point feature bullets. */
  features: SeoTemplateFeature[]
  /** "Perfect for…" use cases. */
  useCases: string[]
  /** shadcn/ui + lucide components the template renders. */
  componentsUsed: string[]
  /** A short, representative code snippet shown as a preview. */
  codePreview: string
  /** The prompt seeded into the generator when the visitor clicks "Use". */
  prompt: string
}

export const SEO_TEMPLATES: SeoTemplate[] = [
  {
    slug: 'analytics-dashboard',
    name: 'Analytics Dashboard',
    category: 'dashboard',
    tagline: 'Metrics, charts, and KPI cards for a data-driven admin.',
    description:
      'A production-ready analytics dashboard template with responsive metric cards, trend indicators, and data-visualization scaffolding. Generate a complete SaaS-style dashboard in seconds — perfect for internal tools, admin panels, and product analytics. Built with shadcn/ui components and fully editable React code.',
    complexity: 'simple',
    keywords: [
      'AI dashboard template',
      'analytics dashboard template',
      'SaaS dashboard generator',
      'KPI dashboard React',
      'admin analytics template',
    ],
    tags: ['Analytics', 'Dashboard', 'Charts', 'Metrics', 'Cards'],
    features: [
      { title: 'Responsive metric grid', description: 'Auto-flowing KPI cards that adapt from 1 to 4 columns across breakpoints.' },
      { title: 'Trend indicators', description: 'Percentage-change badges with directional color coding out of the box.' },
      { title: 'Chart-ready layout', description: 'Slots wired for line, bar, and area charts you can drop in.' },
    ],
    useCases: ['SaaS product analytics', 'Internal admin dashboards', 'Executive KPI overviews'],
    componentsUsed: ['Card', 'CardContent', 'CardHeader', 'CardTitle'],
    codePreview: `const metrics = [
  { title: 'Revenue', value: '$48.2K', icon: DollarSign, change: '+15.3%' },
  { title: 'Active Users', value: '2,340', icon: Users, change: '+8.2%' },
]

<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
  {metrics.map((m) => (
    <Card key={m.title}>
      <CardHeader><CardTitle>{m.title}</CardTitle></CardHeader>
      <CardContent><div className="text-2xl font-bold">{m.value}</div></CardContent>
    </Card>
  ))}
</div>`,
    prompt: 'Create an analytics dashboard with metric cards, trend indicators, and charts',
  },
  {
    slug: 'product-card-grid',
    name: 'Product Card Grid',
    category: 'ecommerce',
    tagline: 'Responsive product grid with images, prices, and add-to-cart.',
    description:
      'A responsive e-commerce product grid template featuring image cards, pricing, and add-to-cart actions. Ideal for online stores, marketplaces, and catalogs. Generate a clean, mobile-first storefront layout with shadcn/ui cards and buttons — every line of React is yours to customize.',
    complexity: 'simple',
    keywords: [
      'AI ecommerce template',
      'product grid template',
      'online store template React',
      'shop layout generator',
      'ecommerce catalog template',
    ],
    tags: ['E-commerce', 'Products', 'Cards', 'Grid', 'Shopping'],
    features: [
      { title: 'Mobile-first grid', description: '1/2/3-column responsive layout that looks right on any device.' },
      { title: 'Add-to-cart buttons', description: 'Cart CTA with icon on every product card, ready to wire to state.' },
      { title: 'Image + price cards', description: 'Consistent aspect-ratio product imagery with prominent pricing.' },
    ],
    useCases: ['Online storefronts', 'Product catalogs', 'Marketplace listings'],
    componentsUsed: ['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle', 'Button'],
    codePreview: `<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {products.map((p) => (
    <Card key={p.id}>
      <CardHeader><img src={p.image} alt={p.name} /></CardHeader>
      <CardContent>
        <CardTitle>{p.name}</CardTitle>
        <CardDescription className="text-2xl font-bold">{p.price}</CardDescription>
        <Button className="w-full mt-4"><ShoppingCart /> Add to Cart</Button>
      </CardContent>
    </Card>
  ))}
</div>`,
    prompt: 'Create an e-commerce product grid with cards, prices, and add-to-cart buttons',
  },
  {
    slug: 'hero-landing-section',
    name: 'Hero Landing Section',
    category: 'landing',
    tagline: 'Modern hero with headline, description, CTAs, and image.',
    description:
      'A conversion-focused landing page hero template with a bold headline, supporting copy, dual call-to-action buttons, and a hero image. Perfect for product launches, marketing sites, and waitlists. Generate a polished, gradient-backed hero section with responsive two-column layout in seconds.',
    complexity: 'simple',
    keywords: [
      'AI landing page template',
      'hero section template',
      'marketing landing page generator',
      'product launch template React',
      'SaaS hero template',
    ],
    tags: ['Landing', 'Hero', 'Marketing', 'CTA', 'Responsive'],
    features: [
      { title: 'Dual CTA layout', description: 'Primary + secondary buttons to capture both hot and warm leads.' },
      { title: 'Gradient backdrop', description: 'Tasteful light/dark gradient background that adapts to theme.' },
      { title: 'Two-column responsive', description: 'Copy and imagery stack gracefully on mobile.' },
    ],
    useCases: ['Product launches', 'Marketing landing pages', 'Waitlist sign-ups'],
    componentsUsed: ['Button'],
    codePreview: `<div className="flex flex-col lg:flex-row items-center gap-12">
  <div className="flex-1 space-y-6">
    <h1 className="text-5xl lg:text-6xl font-bold">{headline}</h1>
    <p className="text-xl text-muted-foreground">{description}</p>
    <div className="flex gap-4">
      <Button size="lg">{ctaText} <ArrowRight /></Button>
      <Button size="lg" variant="outline">Learn More</Button>
    </div>
  </div>
  <div className="flex-1"><img src="/hero.png" className="rounded-lg shadow-2xl" /></div>
</div>`,
    prompt: 'Create a landing page hero section with a headline, description, and call-to-action buttons',
  },
  {
    slug: 'data-table-with-pagination',
    name: 'Data Table with Pagination',
    category: 'admin',
    tagline: 'Sortable, searchable data table for admin panels.',
    description:
      'A feature-rich admin data table template with search, sortable columns, row actions, and pagination scaffolding. Built for CRUD-heavy admin panels and back-office tools. Generate a clean, accessible table layout using shadcn/ui Table and Input components with editable React code.',
    complexity: 'medium',
    keywords: [
      'AI admin template',
      'data table template React',
      'CRUD table generator',
      'admin panel template',
      'sortable table template',
    ],
    tags: ['Admin', 'Table', 'CRUD', 'Pagination', 'Data'],
    features: [
      { title: 'Inline search', description: 'Search input wired above the table to filter rows.' },
      { title: 'Row actions', description: 'Per-row edit/action buttons ready to connect to handlers.' },
      { title: 'Pagination-ready', description: 'Layout structured for page controls and offset queries.' },
    ],
    useCases: ['Admin CRUD panels', 'Back-office tooling', 'User management screens'],
    componentsUsed: ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow', 'Button', 'Input'],
    codePreview: `<Table>
  <TableHeader>
    <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Actions</TableHead></TableRow>
  </TableHeader>
  <TableBody>
    {rows.map((r) => (
      <TableRow key={r.id}>
        <TableCell>{r.name}</TableCell>
        <TableCell>{r.email}</TableCell>
        <TableCell><Button variant="outline" size="sm">Edit</Button></TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>`,
    prompt: 'Create an admin data table with search, sortable columns, row actions, and pagination',
  },
  {
    slug: 'blog-post-card-list',
    name: 'Blog Post Card List',
    category: 'blog',
    tagline: 'Blog feed with images, titles, excerpts, and read-more.',
    description:
      'A clean blog listing template with horizontal post cards featuring cover images, titles, author/date metadata, excerpts, and read-more actions. Perfect for content sites, publications, and company blogs. Generate a responsive, readable blog feed layout in seconds.',
    complexity: 'simple',
    keywords: [
      'AI blog template',
      'blog layout template React',
      'blog feed generator',
      'content site template',
      'article list template',
    ],
    tags: ['Blog', 'Content', 'Cards', 'Posts', 'Responsive'],
    features: [
      { title: 'Author + date meta', description: 'Byline and publish-date row with icons on each post.' },
      { title: 'Cover image cards', description: 'Horizontal cards with cover imagery that stack on mobile.' },
      { title: 'Excerpt + read-more', description: 'Truncated preview text with a clear read-more CTA.' },
    ],
    useCases: ['Company blogs', 'Publications', 'Content marketing sites'],
    componentsUsed: ['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle', 'Button'],
    codePreview: `{posts.map((post) => (
  <Card key={post.id} className="overflow-hidden md:flex">
    <img src={post.image} alt={post.title} className="md:w-1/3 object-cover" />
    <div className="md:w-2/3">
      <CardHeader><CardTitle>{post.title}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{post.excerpt}</p>
        <Button>Read More</Button>
      </CardContent>
    </div>
  </Card>
))}`,
    prompt: 'Create a blog post list with cover images, titles, excerpts, and read-more links',
  },
  {
    slug: 'login-form',
    name: 'Login Form',
    category: 'auth',
    tagline: 'Clean login card with email, password, and remember me.',
    description:
      'A polished authentication login form template with email and password fields, a remember-me checkbox, and a full-width submit button, centered in a card. Ideal for app sign-in screens and gated dashboards. Generate an accessible, theme-aware login UI in seconds.',
    complexity: 'simple',
    keywords: [
      'AI auth template',
      'AI login form template',
      'authentication form template React',
      'sign in page generator',
      'login UI template',
      'auth form template',
    ],
    tags: ['Forms', 'Authentication', 'Login', 'Admin'],
    features: [
      { title: 'Accessible fields', description: 'Labeled email/password inputs with proper htmlFor associations.' },
      { title: 'Remember me', description: 'Checkbox + label pattern ready to bind to auth state.' },
      { title: 'Centered card', description: 'Full-viewport centered card that looks great light or dark.' },
    ],
    useCases: ['App sign-in screens', 'Gated dashboards', 'Member portals'],
    componentsUsed: ['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle', 'Input', 'Button', 'Label', 'Checkbox'],
    codePreview: `<Card className="w-full max-w-md">
  <CardHeader><CardTitle>Welcome back</CardTitle></CardHeader>
  <CardContent className="space-y-4">
    <div className="space-y-2"><Label>Email</Label><Input type="email" /></div>
    <div className="space-y-2"><Label>Password</Label><Input type="password" /></div>
    <div className="flex items-center space-x-2"><Checkbox id="remember" /><Label htmlFor="remember">Remember me</Label></div>
    <Button className="w-full">Sign In</Button>
  </CardContent>
</Card>`,
    prompt: 'Create a login form with email, password, remember me checkbox, and a sign-in button',
  },
  {
    slug: 'pricing-page',
    name: 'Pricing Page',
    category: 'landing',
    tagline: 'Three-tier pricing table with a highlighted plan.',
    description:
      'A conversion-optimized pricing page template with three plan tiers, per-feature checklists, a highlighted "most popular" plan, and per-plan CTAs. Perfect for SaaS products and subscription services. Generate a clean, responsive pricing section that drives upgrades.',
    complexity: 'medium',
    keywords: [
      'AI pricing landing page template',
      'pricing table template React',
      'SaaS pricing generator',
      'subscription plans template',
      'pricing tiers template',
    ],
    tags: ['Pricing', 'Landing', 'SaaS', 'Marketing', 'Cards'],
    features: [
      { title: 'Highlighted plan', description: 'A "most popular" tier visually emphasized to steer conversions.' },
      { title: 'Feature checklists', description: 'Per-plan feature rows with check icons.' },
      { title: 'Per-plan CTAs', description: 'Dedicated call-to-action button on every tier.' },
    ],
    useCases: ['SaaS pricing pages', 'Subscription upsells', 'Plan comparison sections'],
    componentsUsed: ['Card', 'CardContent', 'CardHeader', 'CardTitle', 'Button', 'Badge'],
    codePreview: `{plans.map((plan) => (
  <Card key={plan.name} className={plan.popular ? 'border-primary shadow-lg' : ''}>
    {plan.popular && <Badge>Most Popular</Badge>}
    <CardHeader><CardTitle>{plan.name}</CardTitle><div className="text-4xl font-bold">{plan.price}</div></CardHeader>
    <CardContent>
      <ul>{plan.features.map((f) => <li key={f}><Check /> {f}</li>)}</ul>
      <Button className="w-full">Get started</Button>
    </CardContent>
  </Card>
))}`,
    prompt: 'Create a pricing page with three plan tiers, feature lists, and a highlighted popular plan',
  },
  {
    slug: 'kanban-board',
    name: 'Kanban Board',
    category: 'kanban',
    tagline: 'Column-based task board with draggable-style cards.',
    description:
      'A project-management Kanban board template with columns for workflow stages and task cards showing title, assignee, and labels. Perfect for issue trackers, sprint boards, and task managers. Generate a responsive multi-column board layout ready to wire to drag-and-drop.',
    complexity: 'advanced',
    keywords: [
      'AI kanban template',
      'kanban board template React',
      'task board generator',
      'project management template',
      'trello clone template',
    ],
    tags: ['Kanban', 'Tasks', 'Board', 'Productivity', 'Cards'],
    features: [
      { title: 'Workflow columns', description: 'Todo / In Progress / Done columns with counts.' },
      { title: 'Task cards', description: 'Cards with title, labels, and assignee avatar.' },
      { title: 'Drag-ready structure', description: 'Column/card markup structured for a DnD library.' },
    ],
    useCases: ['Issue trackers', 'Sprint boards', 'Personal task managers'],
    componentsUsed: ['Card', 'CardContent', 'CardHeader', 'CardTitle', 'Badge', 'Avatar'],
    codePreview: `<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
  {columns.map((col) => (
    <div key={col.id}>
      <h3 className="font-semibold mb-3">{col.title} <Badge>{col.tasks.length}</Badge></h3>
      {col.tasks.map((t) => (
        <Card key={t.id} className="mb-3">
          <CardHeader><CardTitle className="text-sm">{t.title}</CardTitle></CardHeader>
          <CardContent><Badge>{t.label}</Badge></CardContent>
        </Card>
      ))}
    </div>
  ))}
</div>`,
    prompt: 'Create a Kanban board with Todo, In Progress, and Done columns and task cards',
  },
  {
    slug: 'chat-interface',
    name: 'Chat Interface',
    category: 'app',
    tagline: 'Messaging UI with bubbles, input, and send button.',
    description:
      'A modern chat interface template with alternating message bubbles, a scrollable conversation area, and a sticky composer with a send button. Perfect for AI assistants, support chat, and messaging apps. Generate a responsive chat UI you can wire to any backend or LLM.',
    complexity: 'medium',
    keywords: [
      'AI chat app template',
      'chat interface template React',
      'messaging UI generator',
      'chatbot UI template',
      'AI assistant template',
    ],
    tags: ['Chat', 'Messaging', 'AI', 'App', 'Forms'],
    features: [
      { title: 'Message bubbles', description: 'Left/right aligned bubbles for user and assistant turns.' },
      { title: 'Sticky composer', description: 'Bottom input with a send button that stays in view.' },
      { title: 'Scrollable thread', description: 'Auto-scrolling message list area.' },
    ],
    useCases: ['AI assistants', 'Customer support chat', 'Messaging apps'],
    componentsUsed: ['Card', 'Input', 'Button', 'ScrollArea', 'Avatar'],
    codePreview: `<div className="flex flex-col h-full">
  <div className="flex-1 overflow-y-auto space-y-4 p-4">
    {messages.map((m) => (
      <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
        <span className="inline-block rounded-lg px-4 py-2 bg-muted">{m.text}</span>
      </div>
    ))}
  </div>
  <div className="flex gap-2 p-4 border-t">
    <Input placeholder="Type a message..." />
    <Button><Send /></Button>
  </div>
</div>`,
    prompt: 'Create a chat interface with message bubbles, a scrollable thread, and a message input',
  },
  {
    slug: 'settings-page',
    name: 'Settings Page',
    category: 'app',
    tagline: 'Tabbed settings with profile, account, and preferences.',
    description:
      'A comprehensive settings page template with a tabbed layout for profile, account, notifications, and preferences, plus grouped form fields and toggles. Perfect for SaaS apps and user dashboards. Generate an organized, accessible settings UI with shadcn/ui tabs and switches.',
    complexity: 'medium',
    keywords: [
      'AI app settings template',
      'settings page template React',
      'account preferences template',
      'user profile settings generator',
      'app settings template',
    ],
    tags: ['Settings', 'Forms', 'App', 'Tabs', 'Preferences'],
    features: [
      { title: 'Tabbed sections', description: 'Profile / Account / Notifications tabs to organize options.' },
      { title: 'Grouped forms', description: 'Labeled field groups with descriptions.' },
      { title: 'Toggle switches', description: 'Switch controls for boolean preferences.' },
    ],
    useCases: ['SaaS account settings', 'User preference panels', 'Admin configuration'],
    componentsUsed: ['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent', 'Card', 'Input', 'Label', 'Switch', 'Button'],
    codePreview: `<Tabs defaultValue="profile">
  <TabsList>
    <TabsTrigger value="profile">Profile</TabsTrigger>
    <TabsTrigger value="account">Account</TabsTrigger>
  </TabsList>
  <TabsContent value="profile">
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-2"><Label>Name</Label><Input /></div>
        <div className="flex items-center justify-between"><Label>Email alerts</Label><Switch /></div>
        <Button>Save changes</Button>
      </CardContent>
    </Card>
  </TabsContent>
</Tabs>`,
    prompt: 'Create a settings page with tabs for profile, account, and notification preferences',
  },
  {
    slug: 'saas-marketing-page',
    name: 'SaaS Marketing Page',
    category: 'landing',
    tagline: 'Full marketing page: hero, features, testimonials, CTA.',
    description:
      'A complete SaaS marketing landing page template combining a hero, a feature grid, social-proof testimonials, and a closing call-to-action. Perfect for product homepages and launch pages. Generate an end-to-end marketing page with cohesive sections in seconds.',
    complexity: 'advanced',
    keywords: [
      'AI SaaS landing template',
      'SaaS landing page template React',
      'marketing page generator',
      'product homepage template',
      'startup landing page template',
    ],
    tags: ['SaaS', 'Landing', 'Marketing', 'Features', 'Testimonials'],
    features: [
      { title: 'Feature grid', description: 'Icon-led feature cards highlighting key benefits.' },
      { title: 'Testimonials', description: 'Social-proof quotes with avatars and names.' },
      { title: 'End-to-end sections', description: 'Hero → features → testimonials → CTA in one page.' },
    ],
    useCases: ['Product homepages', 'Startup launch pages', 'Marketing sites'],
    componentsUsed: ['Card', 'CardContent', 'CardHeader', 'CardTitle', 'Button', 'Badge', 'Avatar'],
    codePreview: `<section className="py-24 text-center">
  <Badge>New</Badge>
  <h1 className="text-5xl font-bold">Ship faster with {product}</h1>
  <Button size="lg">Start free trial</Button>
</section>
<section className="grid md:grid-cols-3 gap-6">
  {features.map((f) => (
    <Card key={f.title}><CardHeader><f.icon /><CardTitle>{f.title}</CardTitle></CardHeader>
      <CardContent>{f.description}</CardContent></Card>
  ))}
</section>`,
    prompt: 'Create a SaaS marketing landing page with a hero, feature grid, testimonials, and a final CTA',
  },
  {
    slug: 'user-profile-card',
    name: 'User Profile Card',
    category: 'app',
    tagline: 'Profile card with avatar, bio, stats, and actions.',
    description:
      'A polished user profile card template with an avatar, name, bio, follower/stat counts, and follow/message action buttons. Perfect for social apps, team directories, and community platforms. Generate a clean, responsive profile component in seconds.',
    complexity: 'simple',
    keywords: [
      'AI app profile card template',
      'user profile template React',
      'profile card generator',
      'social profile UI template',
      'team member card template',
    ],
    tags: ['Profile', 'Social', 'App', 'Cards', 'Avatar'],
    features: [
      { title: 'Avatar + identity', description: 'Prominent avatar with name and handle.' },
      { title: 'Stat row', description: 'Followers / following / posts counters.' },
      { title: 'Action buttons', description: 'Follow and message CTAs ready to wire.' },
    ],
    useCases: ['Social apps', 'Team directories', 'Community platforms'],
    componentsUsed: ['Card', 'CardContent', 'CardHeader', 'Avatar', 'AvatarImage', 'AvatarFallback', 'Button', 'Badge'],
    codePreview: `<Card className="max-w-sm text-center">
  <CardHeader className="items-center">
    <Avatar className="h-20 w-20"><AvatarImage src={user.avatar} /><AvatarFallback>{user.initials}</AvatarFallback></Avatar>
    <h2 className="text-xl font-bold">{user.name}</h2>
    <p className="text-muted-foreground">{user.bio}</p>
  </CardHeader>
  <CardContent>
    <div className="flex justify-around"><div>{user.followers} Followers</div><div>{user.following} Following</div></div>
    <div className="flex gap-2 mt-4"><Button className="flex-1">Follow</Button><Button variant="outline" className="flex-1">Message</Button></div>
  </CardContent>
</Card>`,
    prompt: 'Create a user profile card with an avatar, bio, follower stats, and follow/message buttons',
  },
]

/** All template slugs — used by generateStaticParams and the sitemap. */
export const TEMPLATE_SLUGS = SEO_TEMPLATES.map((t) => t.slug)

/** Look up a template by its URL slug. */
export function getSeoTemplateBySlug(slug: string): SeoTemplate | undefined {
  return SEO_TEMPLATES.find((t) => t.slug === slug)
}
