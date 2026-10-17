import { getSql } from '../lib/db.js';
import { sendJson, readJson, serverError, rateLimit } from '../lib/http.js';
import { getSession, createSession, destroySession, verifyAdminPassword } from '../lib/session.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await sendMe(req, res);
    if (req.method === 'POST') return await sendAction(req, res);
    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}

async function sendMe(req, res) {
  const session = await getSession(req);
  if (!session) return sendJson(res, 200, { authenticated: false });
  return sendJson(res, 200, {
    authenticated: true,
    role: session.role,
    voterId: session.voter_id || null,
  });
}

async function sendAction(req, res) {
  const body = readJson(req);
  switch (String(body.action || '')) {
    case 'invite':
      return await inviteLogin(req, res, body);
    case 'admin':
      return await adminLogin(req, res, body);
    case 'logout':
      await destroySession(req, res);
      return sendJson(res, 200, { ok: true });
    default:
      return sendJson(res, 400, { error: 'Unknown action' });
  }
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function inviteLogin(req, res, body) {
  if (!rateLimit(req, res, 'invite-login')) return;
  const code = normalizeCode(body.inviteCode);
  if (code.length !== 8) {
    return sendJson(res, 400, { error: 'Enter the 8-character invite code from your organizer' });
  }

  const sql = getSql();
  const claimed = await sql`
    UPDATE voters SET used_at = now()
    WHERE invite_code = ${code} AND used_at IS NULL
    RETURNING id`;
  const voter = claimed[0];

  if (!voter) {
    return sendJson(res, 401, { error: 'That invite code is invalid or has already been used' });
  }

  try {
    await createSession(res, 'voter', voter.id);
  } catch (err) {
    await sql`UPDATE voters SET used_at = NULL WHERE id = ${voter.id}`;
    throw err;
  }

  return sendJson(res, 200, { ok: true, role: 'voter' });
}

async function adminLogin(req, res, body) {
  if (!rateLimit(req, res, 'admin-login')) return;
  const result = verifyAdminPassword(body.password);
  if (!result.configured) {
    return sendJson(res, 500, { error: 'Admin sign-in is not configured on this deployment' });
  }
  if (!result.ok) {
    return sendJson(res, 401, { error: 'Incorrect password' });
  }
  await createSession(res, 'admin', null);
  return sendJson(res, 200, { ok: true, role: 'admin' });
}
