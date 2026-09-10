/**
 * Stateless sessions: a signed JWT carried in an httpOnly cookie. Two audiences
 * — the public user UI and the internal ops UI — use different cookie names and
 * a different `aud` claim so a token from one is never valid for the other.
 */
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.auth.jwtSecret);

export type Audience = 'user' | 'ops';

export interface SessionClaims {
  sub: string; // userId (or ops username)
  username: string;
  aud: Audience;
}

export async function issueSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ username: claims.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setAudience(claims.aud)
    .setIssuedAt()
    .setExpirationTime(`${config.auth.sessionTtlDays}d`)
    .sign(secret);
}

export async function readSession(token: string, aud: Audience): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { audience: aud });
    if (!payload.sub || typeof payload.username !== 'string') return null;
    return { sub: payload.sub, username: payload.username, aud };
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: config.auth.sessionTtlDays * 24 * 60 * 60,
  };
}
