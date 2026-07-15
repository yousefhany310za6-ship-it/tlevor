import { describe, it, expect } from 'vitest';
import { generateDockerfile, generateDockerCompose, healthCheckHandler } from '../src/index';

describe('Docker', () => {
  it('should generate Dockerfile', () => {
    const dockerfile = generateDockerfile({ nodeVersion: '20-alpine', expose: [3000] });
    expect(dockerfile).toContain('FROM node:20-alpine');
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
  });

  it('should generate Dockerfile with custom options', () => {
    const dockerfile = generateDockerfile({ nodeVersion: '18', expose: [8080, 8443] });
    expect(dockerfile).toContain('FROM node:18');
    expect(dockerfile).toContain('EXPOSE 8080 8443');
  });

  it('should generate docker-compose', () => {
    const compose = generateDockerCompose({
      services: {
        app: { build: '.', ports: ['3000:3000'], dependsOn: ['redis'] },
        redis: { image: 'redis:alpine', ports: ['6379:6379'] },
      },
    });
    const parsed = JSON.parse(compose);
    expect(parsed.version).toBe('3.8');
    expect(parsed.services.app).toBeDefined();
    expect(parsed.services.redis).toBeDefined();
    expect(parsed.services.app.depends_on).toContain('redis');
  });
});

describe('HealthCheck', () => {
  it('should return healthy status', async () => {
    const handler = healthCheckHandler({
      checks: {
        db: async () => true,
        redis: async () => true,
      },
    });

    let responseData: any;
    const ctx = {
      res: {
        status: (code: number) => ({ json: (data: any) => { responseData = { code, ...data }; } }),
      },
    };

    await handler(ctx);
    expect(responseData.status).toBe('ok');
    expect(responseData.checks.db.status).toBe('ok');
  });

  it('should return unhealthy status when check fails', async () => {
    const handler = healthCheckHandler({
      checks: {
        db: async () => false,
      },
    });

    let responseData: any;
    const ctx = {
      res: {
        status: (code: number) => ({ json: (data: any) => { responseData = { code, ...data }; } }),
      },
    };

    await handler(ctx);
    expect(responseData.code).toBe(503);
    expect(responseData.status).toBe('error');
  });
});