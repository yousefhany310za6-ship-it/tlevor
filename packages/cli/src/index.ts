#!/usr/bin/env node

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const VERSION = '0.1.0';

export function showHelp(): void {
  console.log(`
\x1b[1mTlevor CLI\x1b[0m v${VERSION}

\x1b[1mUsage:\x1b[0m
  tlevor <command> [options]

\x1b[1mCommands:\x1b[0m
  init [name]          Initialize a new Tlevor project
  generate <type> <name>  Generate a component (route, plugin, middleware)
  help                 Show this help message
  version              Show version number

\x1b[1mExamples:\x1b[0m
  tlevor init my-app
  tlevor generate route users
  tlevor generate plugin auth
  tlevor generate middleware logger
`);
}

export function showVersion(): void {
  console.log(`Tlevor CLI v${VERSION}`);
}

export function initProject(name: string): void {
  const projectDir = join(process.cwd(), name);
  
  if (existsSync(projectDir)) {
    throw new Error(`Directory "${name}" already exists.`);
  }

  console.log(`\x1b[34mCreating Tlevor project "${name}"...\x1b[0m`);

  // Create directories
  mkdirSync(join(projectDir, 'src'), { recursive: true });
  mkdirSync(join(projectDir, 'src', 'routes'), { recursive: true });
  mkdirSync(join(projectDir, 'src', 'plugins'), { recursive: true });
  mkdirSync(join(projectDir, 'src', 'middleware'), { recursive: true });
  mkdirSync(join(projectDir, 'src', 'config'), { recursive: true });
  mkdirSync(join(projectDir, 'tests'), { recursive: true });

  // Create package.json
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    description: 'A Tlevor application',
    main: 'dist/index.js',
    scripts: {
      dev: 'tsx watch src/index.ts',
      build: 'tsc',
      start: 'node dist/index.js',
      test: 'vitest',
      lint: 'eslint src/**/*.ts',
    },
    dependencies: {
      '@tlevor/core': '^0.3.0',
      '@tlevor/config': '^0.3.0',
    },
    devDependencies: {
      '@types/node': '^20.12.7',
      'tsx': '^4.10.1',
      'typescript': '^5.4.5',
      'vitest': '^1.6.0',
    },
  }, null, 2));

  // Create tsconfig.json
  writeFileSync(join(projectDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: './dist',
      rootDir: './src',
      declaration: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      strict: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  }, null, 2));

  // Create .env
  writeFileSync(join(projectDir, '.env'), `NODE_ENV=development
PORT=3000
HOST=0.0.0.0
`);

  // Create .gitignore
  writeFileSync(join(projectDir, '.gitignore'), `node_modules/
dist/
.env
*.log
`);

  // Create src/index.ts
  writeFileSync(join(projectDir, 'src/index.ts'), `import { createApp } from '@tlevor/core';

const app = createApp({
  cors: true,
  bodyParser: true,
  security: true,
});

app.addRoute({
  method: 'GET',
  path: '/',
  handler: async () => ({ message: 'Welcome to Tlevor!' }),
});

app.addRoute({
  method: 'GET',
  path: '/health',
  handler: async () => ({ status: 'ok', timestamp: new Date().toISOString() }),
});

const port = parseInt(process.env.PORT || '3000');
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host).then(() => {
  console.log(\`Server running on http://\${host}:\${port}\`);
});
`);

  // Create README.md
  writeFileSync(join(projectDir, 'README.md'), `# ${name}

A Tlevor application.

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

## Production

\`\`\`bash
npm run build
npm start
\`\`\`
`);

  console.log(`\x1b[32m✓ Project "${name}" created successfully!\x1b[0m`);
  console.log(`\nNext steps:\n  cd ${name}\n  npm install\n  npm run dev\n`);
}

function generateComponent(type: string, name: string): void {
  const srcDir = join(process.cwd(), 'src');
  
  if (!existsSync(srcDir)) {
    throw new Error('No "src" directory found. Run this command from your project root.');
  }

  let targetDir: string;
  let content: string;

  switch (type) {
    case 'route':
      targetDir = join(srcDir, 'routes');
      content = `import type { RouteOptions } from '@tlevor/types';

export const ${name}Routes: RouteOptions[] = [
  {
    method: 'GET',
    path: '/${name}',
    handler: async (ctx) => {
      return { message: 'Get ${name}' };
    },
  },
  {
    method: 'POST',
    path: '/${name}',
    handler: async (ctx) => {
      const data = ctx.req.body;
      return { message: 'Create ${name}', data };
    },
  },
];
`;
      break;

    case 'plugin':
      targetDir = join(srcDir, 'plugins');
      content = `import type { TlevorApp } from '@tlevor/types';

export interface ${name}Options {
  // Add plugin options here
}

export function ${name}Plugin(app: TlevorApp, opts: ${name}Options = {}): void {
  // Plugin implementation
  console.log('${name} plugin registered');
}
`;
      break;

    case 'middleware':
      targetDir = join(srcDir, 'middleware');
      content = `import type { HookHandler } from '@tlevor/types';

export const ${name}Middleware: HookHandler = async (ctx) => {
  // Middleware implementation
  console.log('${name} middleware executed');
};
`;
      break;

    default:
      throw new Error(`Unknown component type "${type}". Use "route", "plugin", or "middleware".`);
  }

  mkdirSync(targetDir, { recursive: true });
  const filePath = join(targetDir, `${name}.ts`);
  
  if (existsSync(filePath)) {
    throw new Error(`File "${filePath}" already exists.`);
  }

  writeFileSync(filePath, content);
  console.log(`\x1b[32m✓ Generated ${type} "${name}" at ${filePath}\x1b[0m`);
}

export function run(args: string[]): number {
  const command = args[0];
  try {
    if (!command || command === 'help') {
      showHelp();
    } else if (command === 'version') {
      showVersion();
    } else if (command === 'init') {
      const name = args[1];
      if (!name) throw new Error('Project name is required. Usage: tlevor init <name>');
      initProject(name);
    } else if (command === 'generate') {
      const type = args[1];
      const name = args[2];
      if (!type || !name) throw new Error('Type and name are required. Usage: tlevor generate <type> <name>');
      generateComponent(type, name);
    } else {
      throw new Error(`Unknown command "${command}". Run "tlevor help" for usage.`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\x1b[31mError: ${message}\x1b[0m`);
    return 1;
  }
}

// Main: run only when executed directly as the CLI binary.
if (typeof require !== 'undefined' && require.main === module) {
  process.exit(run(process.argv.slice(2)));
}