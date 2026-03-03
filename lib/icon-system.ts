export const ICON_LIBRARY = {
  // Brand/Logo Icons (using emojis as placeholders)
  logos: {
    default: '🚀',
    tech: '💻',
    finance: '💰',
    health: '🏥',
    education: '🎓',
    ecommerce: '🛍️',
    social: '👥',
    analytics: '📊',
    creative: '🎨',
    productivity: '⚡',
    gaming: '🎮',
    travel: '✈️',
    food: '🍔',
    fitness: '💪',
    music: '🎵',
    real_estate: '🏠',
    automotive: '🚗',
    construction: '🏗️',
    agriculture: '🌾',
    energy: '⚡'
  },

  // Navigation Icons
  navigation: {
    dashboard: '📊',
    projects: '📁',
    tasks: '✅',
    calendar: '📅',
    messages: '💬',
    notifications: '🔔',
    settings: '⚙️',
    profile: '👤',
    search: '🔍',
    menu: '☰',
    close: '✕',
    home: '🏠',
    analytics: '📈',
    reports: '📄',
    team: '👥',
    help: '❓'
  },

  // Action Icons
  actions: {
    add: '➕',
    edit: '✏️',
    delete: '🗑️',
    save: '💾',
    download: '⬇️',
    upload: '⬆️',
    share: '🔗',
    copy: '📋',
    filter: '🔽',
    sort: '↕️',
    refresh: '🔄',
    expand: '⬆',
    collapse: '⬇',
    more: '•••',
    star: '⭐',
    heart: '❤️'
  },

  // Status Icons
  status: {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    pending: '⏳',
    in_progress: '🔄',
    completed: '✓',
    cancelled: '✗',
    online: '🟢',
    offline: '🔴',
    away: '🟡'
  },

  // Category Icons
  categories: {
    design: '🎨',
    development: '💻',
    marketing: '📢',
    sales: '💰',
    support: '🎧',
    hr: '👔',
    legal: '⚖️',
    finance: '💳',
    operations: '⚙️',
    strategy: '🎯',
    research: '🔬',
    security: '🔒',
    data: '📊',
    cloud: '☁️',
    mobile: '📱',
    web: '🌐'
  }
};

export const HEADER_TEMPLATES = {
  professional: `
    <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600">
      <div className="px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-lg flex items-center justify-center text-white text-2xl">
              {logo}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{title}</h1>
              <p className="text-white/80 text-sm mt-1">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button className="bg-white/10 backdrop-blur text-white border border-white/20 hover:bg-white/20">
              <span className="mr-2">🔍</span> Search
            </Button>
            <Button className="bg-white text-purple-600 hover:bg-gray-50">
              <span className="mr-2">➕</span> {primaryAction}
            </Button>
            <div className="ml-3 flex items-center gap-2">
              <button className="w-8 h-8 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-white hover:bg-white/20">
                🔔
              </button>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-pink-400 flex items-center justify-center text-white font-bold border-2 border-white">
                JH
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,

  modern: `
    <div className="bg-white border-b border-gray-200">
      <div className="px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center text-white text-2xl shadow-lg">
              {logo}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{title}</h1>
              <p className="text-gray-500 text-sm">{subtitle}</p>
            </div>
          </div>
          <nav className="flex items-center gap-6">
            <a href="#" className="text-gray-600 hover:text-gray-900 font-medium">Dashboard</a>
            <a href="#" className="text-gray-600 hover:text-gray-900 font-medium">Projects</a>
            <a href="#" className="text-gray-600 hover:text-gray-900 font-medium">Team</a>
            <a href="#" className="text-gray-600 hover:text-gray-900 font-medium">Reports</a>
          </nav>
          <div className="flex items-center gap-3">
            <Button className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:shadow-lg">
              <span className="mr-2">✨</span> {primaryAction}
            </Button>
          </div>
        </div>
      </div>
    </div>
  `,

  minimal: `
    <div className="bg-gray-50 border-b">
      <div className="px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{logo}</span>
            <h1 className="text-2xl font-semibold text-gray-800">{title}</h1>
          </div>
          <Button className="bg-gray-900 text-white hover:bg-gray-800">
            {primaryAction}
          </Button>
        </div>
      </div>
    </div>
  `,

  colorful: `
    <div className="relative overflow-hidden bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
      <div className="absolute inset-0 bg-black/10"></div>
      <div className="relative px-8 py-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-3xl shadow-xl">
              {logo}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white drop-shadow-lg">{title}</h1>
              <p className="text-white/90 text-sm mt-1">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-white/20 backdrop-blur rounded-lg px-4 py-2">
              <span className="text-white">📊</span>
              <span className="text-white font-medium">Analytics</span>
            </div>
            <div className="flex items-center gap-2 bg-white/20 backdrop-blur rounded-lg px-4 py-2">
              <span className="text-white">👥</span>
              <span className="text-white font-medium">Team</span>
            </div>
            <Button className="bg-white text-purple-600 font-semibold hover:shadow-lg">
              <span className="mr-2">🚀</span> {primaryAction}
            </Button>
          </div>
        </div>
      </div>
    </div>
  `
};

export function getIconForContext(context: string): string {
  // DISABLED: Return text label instead of emoticon
  const contextLower = context.toLowerCase();

  // Return contextual text labels instead of emoticons
  if (contextLower.includes('dashboard')) return 'DB';
  if (contextLower.includes('project')) return 'PR';
  if (contextLower.includes('task') || contextLower.includes('kanban')) return 'TK';
  if (contextLower.includes('ecommerce') || contextLower.includes('shop')) return 'SH';
  if (contextLower.includes('analytics') || contextLower.includes('metric')) return 'AN';
  if (contextLower.includes('finance') || contextLower.includes('payment')) return 'FN';
  if (contextLower.includes('health') || contextLower.includes('medical')) return 'MD';
  if (contextLower.includes('education') || contextLower.includes('learning')) return 'ED';
  if (contextLower.includes('social') || contextLower.includes('network')) return 'SO';
  if (contextLower.includes('creative') || contextLower.includes('design')) return 'CR';
  if (contextLower.includes('fitness') || contextLower.includes('workout')) return 'FT';
  if (contextLower.includes('travel') || contextLower.includes('booking')) return 'TR';

  return 'AP';  // Default: APP
}

export function enhancePromptWithIcons(prompt: string): string {
  // DISABLED: Emoticons and gradients are not allowed
  // Returning reinforcement of the NO EMOTICONS, NO GRADIENTS rules
  return `
**CRITICAL DESIGN RULES (MUST FOLLOW):**
- ❌ NEVER use gradients (bg-gradient-*, from-*, to-*, via-*)
- ❌ NEVER use emoticons/emoji (🏠, 📊, ✅, etc.)
- ✅ ONLY use solid colors (bg-slate-900, bg-blue-600, etc.)
- ✅ Use TEXT LABELS instead of icons (since imports aren't allowed)

**Professional Header Pattern (SOLID COLORS ONLY):**
\`\`\`jsx
<div className="bg-slate-900">
  <div className="px-8 py-6">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
          [INITIAL]
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Project Dashboard</h1>
          <p className="text-slate-300 text-sm mt-1">Manage your team efficiently</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button className="bg-slate-700 text-white hover:bg-slate-600">
          Search
        </Button>
        <Button className="bg-blue-600 text-white hover:bg-blue-700">
          New Project
        </Button>
        <div className="ml-3 flex items-center gap-2">
          <button className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white">
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
\`\`\`

**UI LABELING RULES:**
1. Use descriptive text labels for all interactive elements
2. Buttons should have clear text (Search, Add, Delete, Save, etc.)
3. Use simple text or bullet points (•) for indicators
4. Status badges should use color + text (not emoticons)

The user requested: ${prompt}
`;
}