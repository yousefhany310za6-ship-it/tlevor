import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run, showVersion } from '../src/index';

let originalCwd: string;
let dir: string;
const logs: string[] = [];
const errors: string[] = [];

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'tlevor-cli-'));
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  logs.length = 0;
  errors.length = 0;
  vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(String(msg)); });
  vi.spyOn(console, 'error').mockImplementation((msg: string) => { errors.push(String(msg)); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(process, 'cwd').mockReturnValue(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

describe('tlevor CLI', () => {
  describe('run()', () => {
    it('prints help for no args and returns 0', () => {
      expect(run([])).toBe(0);
      expect(logs.join('\n')).toContain('Tlevor CLI');
      expect(logs.join('\n')).toContain('init [name]');
    });

    it('prints help for the "help" command', () => {
      expect(run(['help'])).toBe(0);
      expect(logs.join('\n')).toContain('Usage:');
    });

    it('prints the version', () => {
      expect(run(['version'])).toBe(0);
      expect(logs.join('\n')).toContain('Tlevor CLI v0.1.0');
    });

    it('fails on unknown commands with exit code 1', () => {
      expect(run(['bogus'])).toBe(1);
      expect(errors.join('\n')).toContain('Unknown command "bogus"');
    });

    it('fails on init without a name', () => {
      expect(run(['init'])).toBe(1);
      expect(errors.join('\n')).toContain('Project name is required');
    });

    it('fails on generate without type and name', () => {
      expect(run(['generate', 'route'])).toBe(1);
      expect(errors.join('\n')).toContain('Type and name are required');
    });
  });

  describe('init', () => {
    it('scaffolds a complete project', () => {
      expect(run(['init', 'my-app'])).toBe(0);
      expect(existsSync(join(dir, 'my-app', 'package.json'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', 'tsconfig.json'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', '.env'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', '.gitignore'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', 'src', 'index.ts'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', 'src', 'routes'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', 'src', 'plugins'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', 'src', 'middleware'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', 'src', 'config'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', 'tests'))).toBe(true);
      expect(existsSync(join(dir, 'my-app', 'README.md'))).toBe(true);
    });

    it('writes a valid package.json', () => {
      run(['init', 'app']);
      const pkg = JSON.parse(readFileSync(join(dir, 'app', 'package.json'), 'utf8'));
      expect(pkg.name).toBe('app');
      expect(pkg.scripts.dev).toContain('tsx');
      expect(pkg.dependencies['@tlevor/core']).toBeDefined();
    });

    it('writes the health route into src/index.ts', () => {
      run(['init', 'app']);
      const src = readFileSync(join(dir, 'app', 'src', 'index.ts'), 'utf8');
      expect(src).toContain("path: '/health'");
      expect(src).toContain('createApp');
    });

    it('fails when the directory already exists', () => {
      run(['init', 'app']);
      expect(run(['init', 'app'])).toBe(1);
      expect(errors.join('\n')).toContain('Directory "app" already exists');
    });
  });

  describe('generate', () => {
    it('generates a route component', () => {
      run(['init', 'app']);
      vi.spyOn(process, 'cwd').mockReturnValue(join(dir, 'app'));
      expect(run(['generate', 'route', 'users'])).toBe(0);
      const file = join(dir, 'app', 'src', 'routes', 'users.ts');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('usersRoutes');
    });

    it('generates a plugin component', () => {
      run(['init', 'app']);
      vi.spyOn(process, 'cwd').mockReturnValue(join(dir, 'app'));
      expect(run(['generate', 'plugin', 'auth'])).toBe(0);
      expect(existsSync(join(dir, 'app', 'src', 'plugins', 'auth.ts'))).toBe(true);
    });

    it('generates a middleware component', () => {
      run(['init', 'app']);
      vi.spyOn(process, 'cwd').mockReturnValue(join(dir, 'app'));
      expect(run(['generate', 'middleware', 'logger'])).toBe(0);
      expect(existsSync(join(dir, 'app', 'src', 'middleware', 'logger.ts'))).toBe(true);
    });

    it('fails for an unknown component type', () => {
      run(['init', 'app']);
      vi.spyOn(process, 'cwd').mockReturnValue(join(dir, 'app'));
      expect(run(['generate', 'controller', 'x'])).toBe(1);
      expect(errors.join('\n')).toContain('Unknown component type "controller"');
    });

    it('fails without a src directory', () => {
      expect(run(['generate', 'route', 'users'])).toBe(1);
      expect(errors.join('\n')).toContain('No "src" directory found');
    });

    it('fails when the target file already exists', () => {
      run(['init', 'app']);
      vi.spyOn(process, 'cwd').mockReturnValue(join(dir, 'app'));
      run(['generate', 'route', 'users']);
      expect(run(['generate', 'route', 'users'])).toBe(1);
      expect(errors.join('\n')).toContain('already exists');
    });
  });

  describe('showVersion', () => {
    it('prints the version string', () => {
      showVersion();
      expect(logs.join('\n')).toBe('Tlevor CLI v0.1.0');
    });
  });
});
