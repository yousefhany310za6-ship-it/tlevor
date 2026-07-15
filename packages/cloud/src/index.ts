import { writeFileSync } from 'fs';

// ==================== Docker ====================

export interface DockerfileOptions {
  nodeVersion?: string;
  workDir?: string;
  expose?: number[];
  user?: string;
}

export function generateDockerfile(options: DockerfileOptions = {}): string {
  const { nodeVersion = '20-alpine', workDir = '/app', expose = [3000], user = 'node' } = options;

  return `FROM node:${nodeVersion}

WORKDIR ${workDir}

COPY package*.json ./
COPY pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile --prod

COPY dist/ ./dist/
COPY prisma/ ./prisma/ 2>/dev/null || true

RUN addgroup -g 1001 -S ${user} && adduser -S ${user} -u 1001
USER ${user}

EXPOSE ${expose.join(' ')}

CMD ["node", "dist/index.js"]
`;
}

export function writeDockerfile(path: string, options: DockerfileOptions = {}): void {
  writeFileSync(path, generateDockerfile(options));
}

export interface DockerComposeOptions {
  services: Record<string, {
    image?: string;
    build?: string;
    ports?: string[];
    environment?: Record<string, string>;
    dependsOn?: string[];
    volumes?: string[];
    restart?: 'always' | 'on-failure' | 'no';
  }>;
  networks?: Record<string, any>;
  volumes?: Record<string, any>;
}

export function generateDockerCompose(options: DockerComposeOptions): string {
  const compose: any = { version: '3.8', services: {} };

  for (const [name, service] of Object.entries(options.services)) {
    const s: any = {};
    if (service.image) s.image = service.image;
    if (service.build) s.build = service.build;
    if (service.ports) s.ports = service.ports;
    if (service.environment) s.environment = Object.entries(service.environment).map(([k, v]) => `${k}=${v}`);
    if (service.dependsOn) s.depends_on = service.dependsOn;
    if (service.volumes) s.volumes = service.volumes;
    if (service.restart) s.restart = service.restart;
    compose.services[name] = s;
  }

  if (options.networks) compose.networks = options.networks;
  if (options.volumes) compose.volumes = options.volumes;

  return JSON.stringify(compose, null, 2);
}

// ==================== Health Check ====================

export interface HealthCheckOptions {
  checks?: Record<string, () => Promise<boolean>>;
  timeout?: number;
}

export function healthCheckHandler(options: HealthCheckOptions = {}) {
  const { checks = {}, timeout = 5000 } = options;
  return async (ctx: any) => {
    const results: Record<string, { status: string; duration: number }> = {};
    let healthy = true;

    for (const [name, check] of Object.entries(checks)) {
      const start = Date.now();
      try {
        const result = await Promise.race([check(), new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))]);
        results[name] = { status: result ? 'ok' : 'error', duration: Date.now() - start };
        if (!result) healthy = false;
      } catch (error: any) {
        results[name] = { status: 'error', duration: Date.now() - start };
        healthy = false;
      }
    }

    ctx.res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks: results,
    });
  };
}

// ==================== Graceful Shutdown ====================

export function gracefulShutdown(app: { close: () => Promise<void> }, signals: string[] = ['SIGTERM', 'SIGINT']): void {
  let shutting = false;
  for (const signal of signals) {
    process.on(signal, async () => {
      if (shutting) return;
      shutting = true;
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      try { await app.close(); process.exit(0); }
      catch (err) { console.error('Error during shutdown:', err); process.exit(1); }
    });
  }
}

// ==================== Factory ====================

export { generateDockerfile as dockerfile };
export { generateDockerCompose as dockerCompose };