import type { HTTPMethod, InjectOptions, InjectResult } from '@tlevor/types';
import type { TlevorApp } from '@tlevor/core';

export interface TestApp {
  inject(opts: InjectOptions): Promise<InjectResult>;
}

export function createTestApp(app: TlevorApp): TestApp {
  return {
    inject: (opts: InjectOptions) => app.inject(opts),
  };
}

export function buildTestApp(setupFn: (app: TlevorApp) => void): TestApp {
  const { createApp } = require('@tlevor/core') as { createApp: () => TlevorApp };
  const app = createApp();
  setupFn(app);
  return createTestApp(app);
}
