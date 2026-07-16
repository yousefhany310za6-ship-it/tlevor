import { JwtManager, PasswordManager, createAuth, AuthManager } from '@tlevor/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'tlevor-tickets-dev-secret';

export const jwt = new JwtManager({ secret: JWT_SECRET, expiresIn: 3600_000 });
export const passwords = new PasswordManager();

export const auth: AuthManager = createAuth({
  jwt: { secret: JWT_SECRET, expiresIn: 3600_000 },
  unauthenticated: ['/health', '/auth/login', '/auth/register'],
});

/** Build a signed JWT for a user record loaded from the DB. */
export function issueToken(user: { id: number; email: string; role: string; name: string }): string {
  return jwt.sign({
    sub: String(user.id),
    email: user.email,
    role: user.role,
    roles: [user.role],
    name: user.name,
  });
}
