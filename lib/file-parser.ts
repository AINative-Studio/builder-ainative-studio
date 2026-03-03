import { FileNode, FileGroup } from '@/components/chat/file-tree'
import { nanoid } from 'nanoid'

/**
 * Parses generated code and extracts file structure information
 */
export function parseGeneratedFiles(content: string): FileGroup[] {
  const groups: FileGroup[] = []

  // For now, we'll create a simple structure based on the generated content
  // In a real implementation, this would parse actual file paths from the generated code

  // Check if content contains React component code
  if (content.includes('function Dashboard') || content.includes('export default function')) {
    const componentFiles: FileNode[] = []

    // Main component
    componentFiles.push({
      id: nanoid(),
      path: 'src/components/Dashboard.tsx',
      name: 'Dashboard.tsx',
      type: 'file',
      status: 'completed',
      action: 'create'
    })

    groups.push({
      id: 'components',
      title: '📦 Components',
      files: componentFiles
    })
  }

  // Check for styling/UI patterns
  if (content.includes('className=') || content.includes('tailwind')) {
    const styleFiles: FileNode[] = [
      {
        id: nanoid(),
        path: 'src/styles/globals.css',
        name: 'globals.css',
        type: 'file',
        status: 'completed',
        action: 'update'
      }
    ]

    groups.push({
      id: 'styles',
      title: '🎨 Styles',
      files: styleFiles
    })
  }

  // Configuration files
  const configFiles: FileNode[] = []

  if (content.includes('React') || content.includes('useState')) {
    configFiles.push({
      id: nanoid(),
      path: 'package.json',
      name: 'package.json',
      type: 'file',
      status: 'completed',
      action: 'update'
    })
  }

  if (configFiles.length > 0) {
    groups.push({
      id: 'config',
      title: '⚙️ Configuration',
      files: configFiles
    })
  }

  return groups
}

/**
 * Simulates file generation progress with realistic timing
 */
export function simulateFileProgress(
  groups: FileGroup[],
  onUpdate: (groups: FileGroup[]) => void
): () => void {
  const allFiles = groups.flatMap((g) => g.files)
  let currentIndex = 0

  const interval = setInterval(() => {
    if (currentIndex >= allFiles.length) {
      clearInterval(interval)
      return
    }

    // Update current file to in_progress
    const updatedGroups = groups.map((group) => ({
      ...group,
      files: group.files.map((file) => {
        const fileIndex = allFiles.findIndex((f) => f.id === file.id)
        if (fileIndex === currentIndex) {
          return { ...file, status: 'in_progress' as const }
        } else if (fileIndex < currentIndex) {
          return { ...file, status: 'completed' as const }
        }
        return file
      })
    }))

    onUpdate(updatedGroups)

    currentIndex++
  }, 800) // 800ms per file

  // Cleanup function
  return () => clearInterval(interval)
}

/**
 * Creates a realistic file tree based on the type of application being generated
 */
export function createFileTree(prompt: string): FileGroup[] {
  const groups: FileGroup[] = []

  // Detect application type from prompt
  const isDashboard = /dashboard|analytics|metrics/i.test(prompt)
  const isEcommerce = /ecommerce|shop|cart|product/i.test(prompt)
  const isLanding = /landing|homepage|marketing/i.test(prompt)
  const isForm = /form|contact|input|submit/i.test(prompt)

  // Configuration files
  groups.push({
    id: 'config',
    title: '⚙️ Configuration',
    files: [
      {
        id: nanoid(),
        path: 'package.json',
        name: 'package.json',
        type: 'file',
        status: 'pending',
        action: 'update'
      },
      {
        id: nanoid(),
        path: 'tsconfig.json',
        name: 'tsconfig.json',
        type: 'file',
        status: 'pending',
        action: 'update'
      }
    ]
  })

  // Components based on app type
  const componentFiles: FileNode[] = []

  if (isDashboard) {
    componentFiles.push(
      {
        id: nanoid(),
        path: 'src/components/Dashboard.tsx',
        name: 'Dashboard.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      },
      {
        id: nanoid(),
        path: 'src/components/MetricCard.tsx',
        name: 'MetricCard.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      },
      {
        id: nanoid(),
        path: 'src/components/Chart.tsx',
        name: 'Chart.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      }
    )
  } else if (isEcommerce) {
    componentFiles.push(
      {
        id: nanoid(),
        path: 'src/components/ProductList.tsx',
        name: 'ProductList.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      },
      {
        id: nanoid(),
        path: 'src/components/ProductCard.tsx',
        name: 'ProductCard.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      },
      {
        id: nanoid(),
        path: 'src/components/ShoppingCart.tsx',
        name: 'ShoppingCart.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      }
    )
  } else if (isForm) {
    componentFiles.push(
      {
        id: nanoid(),
        path: 'src/components/ContactForm.tsx',
        name: 'ContactForm.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      },
      {
        id: nanoid(),
        path: 'src/components/FormField.tsx',
        name: 'FormField.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      }
    )
  } else {
    componentFiles.push(
      {
        id: nanoid(),
        path: 'src/components/App.tsx',
        name: 'App.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      },
      {
        id: nanoid(),
        path: 'src/components/Layout.tsx',
        name: 'Layout.tsx',
        type: 'file',
        status: 'pending',
        action: 'create'
      }
    )
  }

  if (componentFiles.length > 0) {
    groups.push({
      id: 'components',
      title: '📦 Components',
      files: componentFiles
    })
  }

  // Styles
  groups.push({
    id: 'styles',
    title: '🎨 Styles',
    files: [
      {
        id: nanoid(),
        path: 'src/styles/globals.css',
        name: 'globals.css',
        type: 'file',
        status: 'pending',
        action: 'update'
      },
      {
        id: nanoid(),
        path: 'tailwind.config.js',
        name: 'tailwind.config.js',
        type: 'file',
        status: 'pending',
        action: 'update'
      }
    ]
  })

  // Pages/Routes
  groups.push({
    id: 'pages',
    title: '📄 Pages',
    files: [
      {
        id: nanoid(),
        path: 'src/app/page.tsx',
        name: 'page.tsx',
        type: 'file',
        status: 'pending',
        action: 'update'
      }
    ]
  })

  return groups
}