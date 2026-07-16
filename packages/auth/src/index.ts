import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { TlevorContext, HookHandler } from '@tlevor/types';

// ==================== JWT ====================

export interface JwtPayload {
  sub: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

export interface JwtOptions {
  secret: string;
  expiresIn?: number;
  algorithm?: 'HS256' | 'HS384' | 'HS512';
  issuer?: string;
  audience?: string;
}

function base64url(data: Buffer | string): string {
  return (typeof data === 'string' ? Buffer.from(data) : data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(str: string): Buffer {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64');
}

function hmacSign(data: string, secret: string, algorithm: string = 'sha256'): string {
  return base64url(createHmacRaw(algorithm, secret).update(data).digest());
}

function createHmacRaw(algorithm: string, key: string) {
  const { createHmac } = require('crypto');
  const algoMap: Record<string, string> = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };
  return createHmac(algoMap[algorithm] || algorithm, key);
}

export class JwtManager {
  private options: Required<JwtOptions>;

  constructor(options: JwtOptions) {
    this.options = {
      secret: options.secret,
      expiresIn: options.expiresIn || 3600000,
      algorithm: options.algorithm || 'HS256',
      issuer: options.issuer || 'tlevor',
      audience: options.audience || 'tlevor-users',
    };
  }

  sign(payload: JwtPayload): string {
    const header = { alg: this.options.algorithm, typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      ...payload,
      iat: payload.iat || now,
      exp: payload.exp || now + Math.floor(this.options.expiresIn / 1000),
      iss: this.options.issuer,
      aud: this.options.audience,
    };

    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(fullPayload));
    const signature = hmacSign(`${headerB64}.${payloadB64}`, this.options.secret, this.options.algorithm);

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  verify(token: string): JwtPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signature] = parts;
      const expectedSignature = hmacSign(`${headerB64}.${payloadB64}`, this.options.secret, this.options.algorithm);

      const sigBuffer = Buffer.from(signature, 'base64');
      const expectedBuffer = Buffer.from(expectedSignature, 'base64');
      if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) return null;

      const payload = JSON.parse(base64urlDecode(payloadB64).toString());
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) return null;
      if (payload.iss && payload.iss !== this.options.issuer) return null;
      if (payload.aud && payload.aud !== this.options.audience) return null;

      return payload;
    } catch {
      return null;
    }
  }

  decode(token: string): JwtPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(base64urlDecode(parts[1]).toString());
    } catch {
      return null;
    }
  }

  refresh(token: string, expiresIn?: number): string | null {
    const payload = this.verify(token);
    if (!payload) return null;
    delete payload.iat;
    delete payload.exp;
    delete payload.iss;
    delete payload.aud;
    payload.iat = Math.floor(Date.now() / 1000) + 1;
    if (expiresIn) payload.exp = payload.iat + Math.floor(expiresIn / 1000);
    return this.sign(payload);
  }
}

// ==================== Password Hashing ====================

export class PasswordManager {
  private saltRounds: number;

  constructor(saltRounds: number = 10) {
    this.saltRounds = saltRounds;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const hash = this.pbkdf2(password, salt, this.saltRounds);
    return `${salt}:${hash}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const computed = this.pbkdf2(password, salt, this.saltRounds);
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computed, 'hex'));
  }

  private pbkdf2(password: string, salt: string, rounds: number): string {
    const { pbkdf2Sync } = require('crypto');
    return pbkdf2Sync(password, salt, rounds, 64, 'sha512').toString('hex');
  }

  generateToken(length: number = 32): string {
    return randomBytes(length).toString('hex');
  }
}

// ==================== Session ====================

export interface SessionData {
  id: string;
  userId: string;
  data: Record<string, any>;
  createdAt: number;
  expiresAt: number;
}

export interface SessionStore {
  get(id: string): Promise<SessionData | null>;
  set(id: string, data: SessionData): Promise<void>;
  destroy(id: string): Promise<void>;
  touch(id: string): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  private store: Map<string, SessionData> = new Map();

  async get(id: string): Promise<SessionData | null> {
    const session = this.store.get(id);
    if (!session) return null;
    if (Date.now() > session.expiresAt) { this.store.delete(id); return null; }
    return session;
  }

  async set(id: string, data: SessionData): Promise<void> { this.store.set(id, data); }
  async destroy(id: string): Promise<void> { this.store.delete(id); }
  async touch(id: string): Promise<void> {
    const session = this.store.get(id);
    if (session) { session.expiresAt = Date.now() + 86400000; }
  }
}

export interface SessionOptions {
  secret: string;
  name?: string;
  maxAge?: number;
  store?: SessionStore;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
}

export class SessionManager {
  private options: Required<SessionOptions>;
  private store: SessionStore;
  private pm: PasswordManager;

  constructor(options: SessionOptions) {
    this.options = {
      secret: options.secret,
      name: options.name || 'tlevor.sid',
      maxAge: options.maxAge || 86400000,
      store: options.store || new MemorySessionStore(),
      secure: options.secure || false,
      httpOnly: options.httpOnly !== false,
      sameSite: options.sameSite || 'lax',
    };
    this.store = this.options.store;
    this.pm = new PasswordManager();
  }

  async create(userId: string, data: Record<string, any> = {}): Promise<string> {
    const id = this.pm.generateToken(32);
    const session: SessionData = {
      id,
      userId,
      data,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.options.maxAge,
    };
    await this.store.set(id, session);
    return id;
  }

  async get(sessionId: string): Promise<SessionData | null> { return this.store.get(sessionId); }
  async destroy(sessionId: string): Promise<void> { return this.store.destroy(sessionId); }
  async touch(sessionId: string): Promise<void> { return this.store.touch(sessionId); }

  getSessionIdFromCookie(ctx: TlevorContext): string | null {
    return ctx.req.cookies[this.options.name] || null;
  }

  setSessionCookie(ctx: TlevorContext, sessionId: string): void {
    ctx.res.cookie(this.options.name, sessionId, {
      httpOnly: this.options.httpOnly,
      secure: this.options.secure,
      maxAge: Math.floor(this.options.maxAge / 1000),
      sameSite: this.options.sameSite,
      path: '/',
    });
  }

  middleware(): HookHandler {
    return async (ctx: TlevorContext) => {
      const sessionId = this.getSessionIdFromCookie(ctx);
      if (sessionId) {
        const session = await this.get(sessionId);
        if (session) {
          (ctx.state as any).session = session;
          (ctx.state as any).sessionId = sessionId;
          await this.touch(sessionId);
        }
      }
    };
  }
}

// ==================== Auth Middleware ====================

export interface AuthOptions {
  jwt?: JwtOptions;
  session?: SessionOptions;
  unauthenticated?: string[];
}

export interface AuthUser {
  id: string;
  [key: string]: any;
}

export class AuthManager {
  private jwt: JwtManager | null = null;
  private session: SessionManager | null = null;
  private unauthenticatedPaths: string[];

  constructor(options: AuthOptions = {}) {
    if (options.jwt) this.jwt = new JwtManager(options.jwt);
    if (options.session) this.session = new SessionManager(options.session);
    this.unauthenticatedPaths = options.unauthenticated || [];
  }

  getJwt(): JwtManager { if (!this.jwt) throw new Error('JWT not configured'); return this.jwt; }
  getSession(): SessionManager { if (!this.session) throw new Error('Session not configured'); return this.session; }

  authenticate(): HookHandler {
    return async (ctx: TlevorContext) => {
      if (this.unauthenticatedPaths.some(p => ctx.req.path.startsWith(p))) return;

      // Try JWT first
      const authHeader = ctx.req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ') && this.jwt) {
        const token = authHeader.slice(7);
        const payload = this.jwt.verify(token);
        if (payload) { (ctx.state as any).user = { id: normalizeUserId(payload.sub), ...payload } as AuthUser; return; }
      }

      // Try session
      if (this.session) {
        const sessionId = this.session.getSessionIdFromCookie(ctx);
        if (sessionId) {
          const sessionData = await this.session.get(sessionId);
          if (sessionData) {
            (ctx.state as any).user = { id: normalizeUserId(sessionData.userId), ...sessionData.data } as AuthUser;
            (ctx.state as any).session = sessionData;
            return;
          }
        }
      }

      ctx.res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED', statusCode: 401 });
      return false;
    };
  }

  authorize(...roles: string[]): HookHandler {
    return async (ctx: TlevorContext) => {
      const user = (ctx.state as any).user as AuthUser | undefined;
      if (!user) {
        ctx.res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED', statusCode: 401 });
        return false;
      }
      const userRoles = (user as any).roles || [];
      if (roles.length > 0 && !roles.some(r => userRoles.includes(r))) {
        ctx.res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', statusCode: 403 });
        return false;
      }
    };
  }
}

// ==================== Factory ====================

export function createAuth(options: AuthOptions): AuthManager {
  return new AuthManager(options);
}

export { base64url, base64urlDecode };

/**
 * Normalize a user identifier to a number when it is a numeric string.
 * Keeps string ids (e.g. UUIDs) untouched. This keeps `ctx.state.user.id`
 * consistent with numeric primary keys coming from SQL adapters, avoiding
 * string/number mismatches when comparing ownership.
 */
export function normalizeUserId(id: any): any {
  if (typeof id === 'string' && id.trim() !== '' && !isNaN(Number(id))) {
    return Number(id);
  }
  return id;
}