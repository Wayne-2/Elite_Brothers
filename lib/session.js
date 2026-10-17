import crypto from 'node:crypto';
import { getSql } from './db.js';
import { sendJson } from './http.js';

export const COOKIE_NAME = 'sid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function cookieValue(req, name) {
  if (req.cookies && name in req.cookies) return req.cookies[name];
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function sessionCookie(token) {
  const secure =
    process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'development' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

export async function getSession(req) {
  const token = cookieValue(req, COOKIE_NAME);
  if (!token || token.length !== 64) return null;
  const sql = getSql();
  const rows = await sql`
    SELECT token, role, voter_id, expires_at
    FROM sessions
    WHERE token = ${token}`;
  const session = rows[0];
  if (!session) return null;
  if (new Date(session.expires_at) <= new Date()) {
    await sql`DELETE FROM sessions WHERE token = ${token}`;
    return null;
  }
  return session;
}

export async function createSession(res, role, voterId = null) {
  const sql = getSql();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  await sql`
    INSERT INTO sessions (token, role, voter_id, expires_at)
    VALUES (${token}, ${role}, ${voterId}, ${expiresAt})`;
  res.setHeader('Set-Cookie', sessionCookie(token));
  return token;
}

export async function destroySession(req, res) {
  const session = await getSession(req);
  if (session) {
    const sql = getSql();
    await sql`DELETE FROM sessions WHERE token = ${session.token}`;
  }
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function denyUnlessRole(res, session, role) {
  if (!session) {
    sendJson(res, 401, { error: 'Not signed in' });
    return true;
  }
  if (session.role !== role) {
    sendJson(res, 403, { error: 'You do not have access to do that' });
    return true;
  }
  return false;
}

export function verifyAdminPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, configured: false };
  const digest = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest();
  const equal = crypto.timingSafeEqual(digest(candidate), digest(expected));
  return { ok: equal, configured: true };
}
