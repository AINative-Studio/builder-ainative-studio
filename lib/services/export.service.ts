import AdmZip from 'adm-zip';
import { getPreview } from '@/lib/preview-store';

export interface ExportOptions {
  generationId: string;
  includeComments?: boolean;
  minify?: boolean;
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  size: number;
}

/**
 * Exports a generated UI project as a complete Next.js application
 * US-066: Next.js Project Export (simplified for in-memory store)
 */
export async function exportProject(
  generationId: string,
  options: Partial<ExportOptions> = {}
): Promise<Buffer> {
  // Fetch generation from preview store
  const generatedCode = getPreview(generationId);

  if (!generatedCode) {
    throw new Error(`Generation ${generationId} not found`);
  }

  const generation = {
    id: generationId,
    generated_code: generatedCode
  }

  const zip = new AdmZip();

  // Add package.json
  const packageJson = generatePackageJson(generation);
  zip.addFile('package.json', Buffer.from(JSON.stringify(packageJson, null, 2)));

  // Add Next.js config
  const nextConfig = generateNextConfig();
  zip.addFile('next.config.ts', Buffer.from(nextConfig));

  // Add TypeScript config
  const tsConfig = generateTsConfig();
  zip.addFile('tsconfig.json', Buffer.from(JSON.stringify(tsConfig, null, 2)));

  // Add Tailwind config
  const tailwindConfig = generateTailwindConfig();
  zip.addFile('tailwind.config.ts', Buffer.from(tailwindConfig));

  // Add PostCSS config
  const postcssConfig = generatePostCSSConfig();
  zip.addFile('postcss.config.mjs', Buffer.from(postcssConfig));

  // Add app directory
  const appPage = generateAppPage(generation);
  zip.addFile('app/page.tsx', Buffer.from(appPage));

  const appLayout = generateAppLayout();
  zip.addFile('app/layout.tsx', Buffer.from(appLayout));

  const globalsCss = generateGlobalsCss();
  zip.addFile('app/globals.css', Buffer.from(globalsCss));

  // Add components/ui directory
  const uiComponents = generateUIComponents(generation);
  for (const [filename, content] of Object.entries(uiComponents)) {
    zip.addFile(`components/ui/${filename}`, Buffer.from(content));
  }

  // Add lib/utils.ts
  const utils = generateUtils();
  zip.addFile('lib/utils.ts', Buffer.from(utils));

  // Add README.md
  const readme = generateReadme(generation);
  zip.addFile('README.md', Buffer.from(readme));

  // Add .gitignore
  const gitignore = generateGitignore();
  zip.addFile('.gitignore', Buffer.from(gitignore));

  // Add .env.example
  const envExample = generateEnvExample();
  zip.addFile('.env.example', Buffer.from(envExample));

  return zip.toBuffer();
}

/**
 * Generate package.json with all required dependencies
 */
function generatePackageJson(generation: any): any {
  return {
    name: `generated-app-${generation.id}`,
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev --turbopack',
      build: 'next build',
      start: 'next start',
      lint: 'next lint',
    },
    dependencies: {
      react: '19.1.0',
      'react-dom': '19.1.0',
      next: '15.5.0',
      tailwindcss: '^4',
      '@tailwindcss/postcss': '^4',
      'class-variance-authority': '^0.7.0',
      clsx: '^2.1.1',
      'tailwind-merge': '^2.5.5',
      'lucide-react': '^0.540.0',
      '@radix-ui/react-slot': '^1.2.3',
      '@radix-ui/react-dialog': '^1.1.15',
      '@radix-ui/react-dropdown-menu': '^2.1.16',
      '@radix-ui/react-select': '^2.2.6',
      '@radix-ui/react-separator': '^1.1.7',
      '@radix-ui/react-avatar': '^1.1.10',
      '@radix-ui/react-tooltip': '^1.2.8',
      '@radix-ui/react-toast': '^1.2.15',
      '@radix-ui/react-tabs': '^1.1.13',
      '@radix-ui/react-accordion': '^1.2.12',
      '@radix-ui/react-checkbox': '^1.3.3',
      '@radix-ui/react-label': '^2.1.7',
      '@radix-ui/react-progress': '^1.1.7',
      '@radix-ui/react-scroll-area': '^1.2.10',
    },
    devDependencies: {
      typescript: '^5',
      '@types/node': '^20',
      '@types/react': '^19',
      '@types/react-dom': '^19',
    },
  };
}

/**
 * Generate Next.js configuration
 */
function generateNextConfig(): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`;
}

/**
 * Generate TypeScript configuration
 */
function generateTsConfig(): any {
  return {
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [
        {
          name: 'next',
        },
      ],
      paths: {
        '@/*': ['./*'],
      },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  };
}

/**
 * Generate Tailwind CSS configuration
 */
function generateTailwindConfig(): string {
  return `import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {},
    },
  },
  plugins: [],
};

export default config;
`;
}

/**
 * Generate PostCSS configuration
 */
function generatePostCSSConfig(): string {
  return `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;
}

/**
 * Generate app/page.tsx with generated code
 */
function generateAppPage(generation: any): string {
  return `export default function Home() {
  return (
    ${generation.generated_code || '<div>Generated UI</div>'}
  );
}
`;
}

/**
 * Generate app/layout.tsx
 */
function generateAppLayout(): string {
  return `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Generated App",
  description: "Generated by AI-Native Web Builder",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
}

/**
 * Generate globals.css
 */
function generateGlobalsCss(): string {
  return `@import "tailwindcss";

:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 3.9%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 96.1%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 96.1%;
  --muted-foreground: 0 0% 45.1%;
  --accent: 0 0% 96.1%;
  --accent-foreground: 0 0% 9%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 89.8%;
  --input: 0 0% 89.8%;
  --ring: 0 0% 3.9%;
  --radius: 0.5rem;
}

.dark {
  --background: 0 0% 3.9%;
  --foreground: 0 0% 98%;
  --card: 0 0% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 0 0% 3.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;
  --primary-foreground: 0 0% 9%;
  --secondary: 0 0% 14.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 0 0% 14.9%;
  --muted-foreground: 0 0% 63.9%;
  --accent: 0 0% 14.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 14.9%;
  --input: 0 0% 14.9%;
  --ring: 0 0% 83.1%;
}

* {
  border-color: hsl(var(--border));
}

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
}
`;
}

/**
 * Generate UI components based on generation
 */
function generateUIComponents(generation: any): Record<string, string> {
  return {
    'button.tsx': generateButtonComponent(),
    'card.tsx': generateCardComponent(),
    'input.tsx': generateInputComponent(),
  };
}

function generateButtonComponent(): string {
  return `import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
`;
}

function generateCardComponent(): string {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
`;
}

function generateInputComponent(): string {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
`;
}

/**
 * Generate lib/utils.ts
 */
function generateUtils(): string {
  return `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
}

/**
 * Generate README.md
 */
function generateReadme(generation: any): string {
  return `# Generated Next.js Application

This application was generated by the AI-Native Web Builder.

## Getting Started

1. Install dependencies:

\`\`\`bash
npm install
\`\`\`

2. Run the development server:

\`\`\`bash
npm run dev
\`\`\`

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Build for Production

\`\`\`bash
npm run build
npm start
\`\`\`

## Generation Details

- Generation ID: ${generation.id}
- Created: ${new Date().toISOString()}

## Tech Stack

- Next.js 15.5
- React 19
- TypeScript
- Tailwind CSS 4
- Radix UI Components

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
`;
}

/**
 * Generate .gitignore
 */
function generateGitignore(): string {
  return `# dependencies
/node_modules
/.pnp
.pnp.js

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# local env files
.env*.local
.env

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
`;
}

/**
 * Generate .env.example
 */
function generateEnvExample(): string {
  return `# Add your environment variables here
# NEXT_PUBLIC_API_URL=
`;
}

/**
 * Get export with metadata
 */
export async function getExportWithMetadata(
  generationId: string
): Promise<ExportResult> {
  const buffer = await exportProject(generationId);

  return {
    buffer,
    filename: `nextjs-app-${generationId}.zip`,
    size: buffer.length,
  };
}
