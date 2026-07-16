import { describe, it, expect } from 'vitest';
import { JwtManager, PasswordManager, AuthManager, SessionManager, MemorySessionStore } from '../src/index';

describe('JwtManager', () => {
  const jwt = new JwtManager({ secret: 'test-secret-key', expiresIn: 60000 });

  it('should sign and verify tokens', () => {
    const token = jwt.sign({ sub: 'user123', name: 'John' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
    const payload = jwt.verify(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('user123');
    expect(payload!.name).toBe('John');
  });

  it('should reject expired tokens', () => {
    const shortJwt = new JwtManager({ secret: 'test', expiresIn: 1 });
    const token = shortJwt.sign({ sub: 'user1' });
    // Manually set exp to past
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    payload.exp = Math.floor(Date.now() / 1000) - 10;
    const expiredToken = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.${parts[2]}`;
    expect(shortJwt.verify(expiredToken)).toBeNull();
  });

  it('should reject tokens with wrong secret', () => {
    const jwt2 = new JwtManager({ secret: 'different-secret' });
    const token = jwt.sign({ sub: 'user1' });
    expect(jwt2.verify(token)).toBeNull();
  });

  it('should decode without verification', () => {
    const token = jwt.sign({ sub: 'user1', name: 'Test' });
    const decoded = jwt.decode(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('user1');
  });

  it('should refresh tokens', () => {
    const token = jwt.sign({ sub: 'user1' });
    const refreshed = jwt.refresh(token);
    expect(refreshed).not.toBeNull();
    expect(refreshed).not.toBe(token);
    const payload = jwt.verify(refreshed!);
    expect(payload!.sub).toBe('user1');
  });
});

describe('PasswordManager', () => {
  const pm = new PasswordManager(4);

  it('should hash passwords', async () => {
    const hash = await pm.hash('mypassword');
    expect(hash).toContain(':');
    expect(hash.split(':')).toHaveLength(2);
  });

  it('should verify correct passwords', async () => {
    const hash = await pm.hash('mypassword');
    expect(await pm.verify('mypassword', hash)).toBe(true);
  });

  it('should reject wrong passwords', async () => {
    const hash = await pm.hash('mypassword');
    expect(await pm.verify('wrongpassword', hash)).toBe(false);
  });

  it('should generate tokens', () => {
    const token = pm.generateToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(64);
  });

  it('should produce different hashes for same password', async () => {
    const hash1 = await pm.hash('password');
    const hash2 = await pm.hash('password');
    expect(hash1).not.toBe(hash2);
  });
});

describe('MemorySessionStore', () => {
  const store = new MemorySessionStore();

  it('should set and get sessions', async () => {
    const session = { id: 's1', userId: 'u1', data: {}, createdAt: Date.now(), expiresAt: Date.now() + 60000 };
    await store.set('s1', session);
    const result = await store.get('s1');
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('u1');
  });

  it('should return null for expired sessions', async () => {
    const session = { id: 's2', userId: 'u2', data: {}, createdAt: Date.now(), expiresAt: Date.now() - 1000 };
    await store.set('s2', session);
    expect(await store.get('s2')).toBeNull();
  });

  it('should destroy sessions', async () => {
    const session = { id: 's3', userId: 'u3', data: {}, createdAt: Date.now(), expiresAt: Date.now() + 60000 };
    await store.set('s3', session);
    await store.destroy('s3');
    expect(await store.get('s3')).toBeNull();
  });
});

describe('AuthManager', () => {
  it('should create auth with JWT', () => {
    const auth = new AuthManager({ jwt: { secret: 'test' } });
    expect(auth.getJwt()).toBeInstanceOf(JwtManager);
  });

  it('should create auth with session', () => {
    const auth = new AuthManager({ session: { secret: 'test' } });
    expect(auth.getSession()).toBeInstanceOf(SessionManager);
  });

  it('should throw if JWT not configured', () => {
    const auth = new AuthManager();
    expect(() => auth.getJwt()).toThrow('JWT not configured');
  });

  it('normalizes a numeric sub to a number on the authenticated user', async () => {
    const auth = new AuthManager({ jwt: { secret: 'test' } });
    const token = auth.getJwt().sign({ sub: '42', role: 'admin' });

    const ctx: any = {
      req: { headers: { authorization: `Bearer ${token}` } },
      res: { status: () => ({ json: () => {} }), json: () => {}, headersSent: false },
      state: {},
    };
    const result = auth.authenticate()(ctx);
    if (result && typeof (result as any).then === 'function') await result;
    expect((ctx.state as any).user.id).toBe(42);
    expect(typeof (ctx.state as any).user.id).toBe('number');
  });

  it('keeps a non-numeric id (e.g. UUID) as a string', async () => {
    const auth = new AuthManager({ jwt: { secret: 'test' } });
    const token = auth.getJwt().sign({ sub: 'abc-123', role: 'user' });

    const ctx: any = {
      req: { headers: { authorization: `Bearer ${token}` } },
      res: { status: () => ({ json: () => {} }), json: () => {}, headersSent: false },
      state: {},
    };
    const result = auth.authenticate()(ctx);
    if (result && typeof (result as any).then === 'function') await result;
    expect((ctx.state as any).user.id).toBe('abc-123');
  });
});