export const MOCK_DATA_TEMPLATES = {
  users: {
    template: `[
      { id: 1, name: 'John Harrison', initials: 'JH', email: 'john@example.com', role: 'Senior Developer', avatar: null, color: 'from-purple-400 to-pink-400' },
      { id: 2, name: 'Anna Chen', initials: 'AC', email: 'anna@example.com', role: 'Product Designer', avatar: null, color: 'from-blue-400 to-cyan-400' },
      { id: 3, name: 'Marcus Kim', initials: 'MK', email: 'marcus@example.com', role: 'Project Manager', avatar: null, color: 'from-green-400 to-teal-400' },
      { id: 4, name: 'Victoria Kumar', initials: 'VK', email: 'victoria@example.com', role: 'UX Researcher', avatar: null, color: 'from-orange-400 to-red-400' },
      { id: 5, name: 'David Brown', initials: 'DB', email: 'david@example.com', role: 'Backend Engineer', avatar: null, color: 'from-indigo-400 to-purple-400' }
    ]`,
    usage: 'Team members, assignees, or user profiles'
  },

  projects: {
    template: `[
      {
        id: 1,
        title: 'Design System Implementation',
        description: 'Create comprehensive design system with components, colors, and typography guidelines',
        status: 'in_progress',
        priority: 'high',
        progress: 65,
        dueDate: '2024-03-15',
        team: ['JH', 'AC', 'MK'],
        budget: 45000,
        spent: 28500,
        tasks: 24,
        completed: 15,
        category: 'DESIGN SYSTEM',
        categoryColor: 'bg-purple-100 text-purple-700'
      },
      {
        id: 2,
        title: 'Mobile App Redesign',
        description: 'Complete overhaul of mobile experience with new navigation and modern UI patterns',
        status: 'planning',
        priority: 'medium',
        progress: 25,
        dueDate: '2024-04-20',
        team: ['AC', 'VK'],
        budget: 32000,
        spent: 8000,
        tasks: 18,
        completed: 4,
        category: 'MOBILE',
        categoryColor: 'bg-blue-100 text-blue-700'
      },
      {
        id: 3,
        title: 'API Integration Phase 2',
        description: 'Integrate payment processing, notification system, and third-party analytics',
        status: 'in_progress',
        priority: 'high',
        progress: 80,
        dueDate: '2024-02-28',
        team: ['JH', 'DB'],
        budget: 28000,
        spent: 22400,
        tasks: 16,
        completed: 13,
        category: 'DEVELOPMENT',
        categoryColor: 'bg-green-100 text-green-700'
      }
    ]`,
    usage: 'Project cards, dashboards, or portfolio items'
  },

  kanbanTasks: {
    template: `{
      todo: {
        title: 'To Do',
        count: 12,
        color: 'bg-gray-50',
        items: [
          {
            id: 1,
            title: 'Implement user authentication flow',
            category: 'BACKEND',
            categoryColor: 'bg-green-100 text-green-700',
            description: 'Set up OAuth 2.0 with Google and GitHub providers, implement JWT tokens',
            priority: 'high',
            assignees: [
              { name: 'JH', color: 'from-purple-400 to-pink-400' },
              { name: 'DB', color: 'from-indigo-400 to-purple-400' }
            ],
            comments: 8,
            attachments: 3,
            labels: ['security', 'auth'],
            estimatedHours: 16,
            createdAt: '2024-01-15'
          },
          {
            id: 2,
            title: 'Design responsive navigation menu',
            category: 'UI/UX',
            categoryColor: 'bg-purple-100 text-purple-700',
            description: 'Create mobile-first navigation with hamburger menu and smooth transitions',
            priority: 'medium',
            assignees: [
              { name: 'AC', color: 'from-blue-400 to-cyan-400' }
            ],
            comments: 5,
            attachments: 2,
            labels: ['design', 'mobile'],
            estimatedHours: 8,
            createdAt: '2024-01-16'
          },
          {
            id: 3,
            title: 'Optimize database queries',
            category: 'PERFORMANCE',
            categoryColor: 'bg-orange-100 text-orange-700',
            description: 'Index frequently queried columns and implement caching strategy',
            priority: 'low',
            assignees: [
              { name: 'DB', color: 'from-indigo-400 to-purple-400' }
            ],
            comments: 3,
            attachments: 1,
            labels: ['optimization', 'database'],
            estimatedHours: 12,
            createdAt: '2024-01-17'
          }
        ]
      },
      inProgress: {
        title: 'In Progress',
        count: 5,
        color: 'bg-yellow-50',
        items: [
          {
            id: 4,
            title: 'Build admin dashboard',
            category: 'FEATURE',
            categoryColor: 'bg-blue-100 text-blue-700',
            description: 'Create comprehensive admin panel with user management and analytics',
            priority: 'high',
            progress: 65,
            assignees: [
              { name: 'VK', color: 'from-orange-400 to-red-400' },
              { name: 'JH', color: 'from-purple-400 to-pink-400' }
            ],
            comments: 12,
            attachments: 5,
            labels: ['admin', 'dashboard'],
            estimatedHours: 24,
            actualHours: 15.5,
            createdAt: '2024-01-10',
            startedAt: '2024-01-18'
          },
          {
            id: 5,
            title: 'Implement real-time notifications',
            category: 'FEATURE',
            categoryColor: 'bg-blue-100 text-blue-700',
            description: 'Add WebSocket support for live updates and push notifications',
            priority: 'medium',
            progress: 40,
            assignees: [
              { name: 'MK', color: 'from-green-400 to-teal-400' }
            ],
            comments: 6,
            attachments: 2,
            labels: ['realtime', 'websocket'],
            estimatedHours: 20,
            actualHours: 8,
            createdAt: '2024-01-12',
            startedAt: '2024-01-19'
          }
        ]
      },
      review: {
        title: 'In Review',
        count: 3,
        color: 'bg-purple-50',
        items: [
          {
            id: 6,
            title: 'Update API documentation',
            category: 'DOCS',
            categoryColor: 'bg-gray-100 text-gray-700',
            description: 'Document all new endpoints with examples and response schemas',
            priority: 'medium',
            assignees: [
              { name: 'AC', color: 'from-blue-400 to-cyan-400' },
              { name: 'MK', color: 'from-green-400 to-teal-400' }
            ],
            comments: 4,
            attachments: 3,
            labels: ['documentation', 'api'],
            estimatedHours: 6,
            actualHours: 5,
            createdAt: '2024-01-08',
            startedAt: '2024-01-15',
            reviewRequestedAt: '2024-01-20'
          }
        ]
      },
      completed: {
        title: 'Completed',
        count: 24,
        color: 'bg-green-50',
        items: [
          {
            id: 7,
            title: 'Set up CI/CD pipeline',
            category: 'DEVOPS',
            categoryColor: 'bg-indigo-100 text-indigo-700',
            description: 'Configure GitHub Actions for automated testing and deployment',
            priority: 'low',
            assignees: [
              { name: 'DB', color: 'from-indigo-400 to-purple-400' }
            ],
            comments: 8,
            attachments: 4,
            labels: ['automation', 'deployment'],
            estimatedHours: 10,
            actualHours: 9,
            createdAt: '2024-01-05',
            startedAt: '2024-01-10',
            completedAt: '2024-01-14'
          },
          {
            id: 8,
            title: 'Migrate to PostgreSQL',
            category: 'BACKEND',
            categoryColor: 'bg-green-100 text-green-700',
            description: 'Successfully migrated from MySQL to PostgreSQL with zero downtime',
            priority: 'high',
            assignees: [
              { name: 'JH', color: 'from-purple-400 to-pink-400' },
              { name: 'DB', color: 'from-indigo-400 to-purple-400' }
            ],
            comments: 15,
            attachments: 6,
            labels: ['database', 'migration'],
            estimatedHours: 20,
            actualHours: 18,
            createdAt: '2024-01-01',
            startedAt: '2024-01-02',
            completedAt: '2024-01-12'
          }
        ]
      }
    }`,
    usage: 'Kanban boards, task management, or project tracking'
  },

  products: {
    template: `[
      {
        id: 1,
        name: 'Premium Wireless Headphones',
        price: 299.99,
        originalPrice: 399.99,
        discount: 25,
        category: 'Electronics',
        image: '🎧',
        rating: 4.5,
        reviews: 234,
        inStock: true,
        stockCount: 45,
        features: ['Noise Cancelling', '30hr Battery', 'Premium Audio'],
        colors: ['Black', 'Silver', 'Blue'],
        badge: 'BESTSELLER',
        badgeColor: 'bg-red-500'
      },
      {
        id: 2,
        name: 'Ergonomic Office Chair',
        price: 549.00,
        originalPrice: 649.00,
        discount: 15,
        category: 'Furniture',
        image: '🪑',
        rating: 4.8,
        reviews: 189,
        inStock: true,
        stockCount: 12,
        features: ['Lumbar Support', 'Adjustable Height', 'Breathable Mesh'],
        colors: ['Gray', 'Black'],
        badge: 'NEW',
        badgeColor: 'bg-green-500'
      },
      {
        id: 3,
        name: 'Smart Fitness Watch',
        price: 199.99,
        originalPrice: 249.99,
        discount: 20,
        category: 'Wearables',
        image: '⌚',
        rating: 4.3,
        reviews: 567,
        inStock: true,
        stockCount: 89,
        features: ['Heart Rate Monitor', 'GPS', 'Water Resistant'],
        colors: ['Black', 'Rose Gold', 'White'],
        badge: 'TRENDING',
        badgeColor: 'bg-purple-500'
      }
    ]`,
    usage: 'E-commerce, product listings, or catalogs'
  },

  metrics: {
    template: `[
      {
        title: 'Total Revenue',
        value: '\\$45,231',
        change: '+20.1%',
        trend: 'up',
        description: 'vs last month',
        iconLabel: '\\$',
        color: 'bg-green-600',
        sparkline: [30, 40, 35, 50, 45, 60, 55, 70, 65, 75]
      },
      {
        title: 'Active Users',
        value: '12,543',
        change: '+12.5%',
        trend: 'up',
        description: 'vs last week',
        iconLabel: 'U',
        color: 'bg-blue-600',
        sparkline: [100, 120, 115, 130, 140, 135, 150, 145, 160, 155]
      },
      {
        title: 'Conversion Rate',
        value: '3.24%',
        change: '-0.5%',
        trend: 'down',
        description: 'vs last period',
        iconLabel: '%',
        color: 'bg-purple-600',
        sparkline: [3.5, 3.4, 3.3, 3.4, 3.2, 3.3, 3.25, 3.24, 3.24, 3.24]
      },
      {
        title: 'Avg Response Time',
        value: '1.2s',
        change: '-15.3%',
        trend: 'up',
        description: 'improvement',
        iconLabel: 'T',
        color: 'bg-orange-600',
        sparkline: [1.5, 1.4, 1.35, 1.3, 1.28, 1.25, 1.22, 1.2, 1.2, 1.2]
      }
    ]`,
    usage: 'Dashboards, analytics, or KPI displays'
  },

  messages: {
    template: `[
      {
        id: 1,
        sender: 'Anna Chen',
        initials: 'AC',
        message: 'Hey! Can you review the new design mockups when you get a chance?',
        timestamp: '10:30 AM',
        unread: true,
        avatar: null,
        color: 'from-blue-400 to-cyan-400',
        status: 'online'
      },
      {
        id: 2,
        sender: 'Marcus Kim',
        initials: 'MK',
        message: 'The API endpoints are ready for testing. Let me know if you need any help.',
        timestamp: '9:45 AM',
        unread: true,
        avatar: null,
        color: 'from-green-400 to-teal-400',
        status: 'online'
      },
      {
        id: 3,
        sender: 'Victoria Kumar',
        initials: 'VK',
        message: 'Great work on the presentation! The client loved it 🎉',
        timestamp: 'Yesterday',
        unread: false,
        avatar: null,
        color: 'from-orange-400 to-red-400',
        status: 'away'
      }
    ]`,
    usage: 'Chat interfaces, messaging, or notifications'
  },

  activities: {
    template: `[
      {
        id: 1,
        user: 'John Harrison',
        initials: 'JH',
        action: 'pushed to',
        target: 'main',
        targetType: 'branch',
        description: '3 commits with bug fixes',
        timestamp: '2 minutes ago',
        iconLabel: 'P',
        color: 'bg-purple-600'
      },
      {
        id: 2,
        user: 'Anna Chen',
        initials: 'AC',
        action: 'commented on',
        target: 'Issue #234',
        targetType: 'issue',
        description: 'Added design review feedback',
        timestamp: '15 minutes ago',
        iconLabel: 'C',
        color: 'bg-blue-600'
      },
      {
        id: 3,
        user: 'Marcus Kim',
        initials: 'MK',
        action: 'completed',
        target: 'User Authentication',
        targetType: 'task',
        description: 'OAuth integration finished',
        timestamp: '1 hour ago',
        iconLabel: '✓',
        color: 'bg-green-600'
      },
      {
        id: 4,
        user: 'Victoria Kumar',
        initials: 'VK',
        action: 'created',
        target: 'Project Roadmap',
        targetType: 'document',
        description: 'Q2 planning document',
        timestamp: '3 hours ago',
        iconLabel: 'D',
        color: 'bg-orange-600'
      }
    ]`,
    usage: 'Activity feeds, timelines, or audit logs'
  }
};

export function generateMockDataPrompt(dataType: string): string {
  const template = MOCK_DATA_TEMPLATES[dataType as keyof typeof MOCK_DATA_TEMPLATES];
  if (!template) {
    return '';
  }

  return `
// Mock data for ${template.usage}
const ${dataType} = ${template.template};
`;
}

import { getIconForContext, enhancePromptWithIcons } from './icon-system';

export function enhancePromptWithMockData(userPrompt: string): string {
  const promptLower = userPrompt.toLowerCase();
  let mockData = '';
  let contextIcon = getIconForContext(userPrompt);

  // Detect what type of UI is being requested and add appropriate mock data
  if (promptLower.includes('kanban') || promptLower.includes('task') || promptLower.includes('board')) {
    mockData += generateMockDataPrompt('kanbanTasks');
  } else if (promptLower.includes('dashboard') || promptLower.includes('metric') || promptLower.includes('analytics')) {
    mockData += generateMockDataPrompt('metrics');
    mockData += generateMockDataPrompt('activities');
  } else if (promptLower.includes('ecommerce') || promptLower.includes('product') || promptLower.includes('shop')) {
    mockData += generateMockDataPrompt('products');
  } else if (promptLower.includes('chat') || promptLower.includes('message') || promptLower.includes('conversation')) {
    mockData += generateMockDataPrompt('messages');
  } else if (promptLower.includes('project') || promptLower.includes('portfolio')) {
    mockData += generateMockDataPrompt('projects');
    mockData += generateMockDataPrompt('users');
  } else {
    // Default to providing metrics and activities for general dashboards
    mockData += generateMockDataPrompt('metrics');
    mockData += generateMockDataPrompt('activities');
  }

  // Add icon enhancement to the prompt
  const iconEnhancement = enhancePromptWithIcons(userPrompt);

  return `${userPrompt}

IMPORTANT: Use this realistic mock data in your implementation:
${mockData}

${iconEnhancement}

ENHANCED HEADER REQUIREMENTS:
1. MUST include a professional header with:
   - App title and subtitle
   - Search button with text label
   - Primary action button with text label
   - Notification indicator
   - User avatar with initials

Example header structure (use SOLID COLORS only, NO gradients):
<div className="bg-slate-900">
  <div className="px-8 py-6">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white text-2xl font-bold">
          [INITIAL]
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">[Your App Title]</h1>
          <p className="text-slate-300 text-sm mt-1">[Descriptive subtitle]</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button className="bg-slate-700 text-white border border-slate-600 hover:bg-slate-600">
          Search
        </Button>
        <Button className="bg-blue-600 text-white hover:bg-blue-700">
          [Primary Action]
        </Button>
        <div className="ml-3 flex items-center gap-2">
          <button className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white hover:bg-slate-600">
            •
          </button>
          <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold border-2 border-white">
            JH
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

Make sure to:
1. Use the exact data structure provided above
2. Use TEXT LABELS ONLY - NO emoticons/emoji since imports aren't allowed
3. Create a professional header with solid colors (NO gradients)
4. Map over arrays to create dynamic content
5. Use all the fields provided (colors, badges, text labels, etc.)
6. Show realistic values, not placeholder text
7. Include interactive states (hover effects, transitions)`;
}