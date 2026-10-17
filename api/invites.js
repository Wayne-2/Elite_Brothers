import crypto from 'node:crypto';
import { getSql } from '../lib/db.js';
import { sendJson, readJson, serverError, UUID_RE } from '../lib/http.js';
import { getSession, denyUnlessRole } from '../lib/session.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

function displayCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export default async function handler(req, res) {
  try {
    const session = await getSession(req);
    if (denyUnlessRole(res, session, 'admin')) return;

    if (req.method === 'GET') return await sendList(res);
    if (req.method === 'POST') return await sendAction(req, res);
    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}

async function sendList(res) {
  const sql = getSql();
  const rows = await sql`
    SELECT v.id, v.invite_code, v.used_at, v.created_at,
      (SELECT count(*) FROM votes vb WHERE vb.voter_id = v.id)::int AS vote_count
    FROM voters v
    ORDER BY v.created_at DESC, v.id`;

  return sendJson(res, 200, {
    invites: rows.map((row) => ({
      id: row.id,
      code: displayCode(row.invite_code),
      used: Boolean(row.used_at),
      createdAt: row.created_at,
      voteCount: row.vote_count,
    })),
  });
}

async function sendAction(req, res) {
  const body = readJson(req);
  switch (String(body.action || '')) {
    case 'generate':
      return await generate(req, res, body);
    case 'reopen':
      return await setUsed(res, body, false);
    case 'revoke':
      return await revoke(res, body);
    default:
      return sendJson(res, 400, { error: 'Unknown action' });
  }
}

async function generate(req, res, body) {
  const count = Number.parseInt(body.count, 10);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return sendJson(res, 400, { error: 'Choose between 1 and 100 invites' });
  }

  const sql = getSql();
  let rows = null;

  for (let attempt = 0; attempt < 5 && !rows; attempt++) {
    const codes = [];
    while (codes.length < count) {
      const code = generateCode();
      if (!codes.includes(code)) codes.push(code);
    }
    try {
      const placeholders = codes.map((_, i) => `($${i + 1})`).join(', ');
      rows = await sql.query(
        `INSERT INTO voters (invite_code) VALUES ${placeholders} RETURNING invite_code`,
        codes
      );
    } catch (err) {
      if (attempt === 4 || err?.code !== '23505') throw err;
    }
  }

  return sendJson(res, 201, {
    invites: rows.map((row) => ({ code: displayCode(row.invite_code), used: false })),
  });
}

async function setUsed(res, body, used) {
  const voterId = String(body.voterId || '');
  if (!UUID_RE.test(voterId)) return sendJson(res, 400, { error: 'Invalid invite id' });

  const sql = getSql();
  const rows = await sql`
    UPDATE voters SET used_at = ${used ? new Date().toISOString() : null}
    WHERE id = ${voterId}
    RETURNING id`;
  if (!rows[0]) return sendJson(res, 404, { error: 'Invite not found' });

  return sendJson(res, 200, { ok: true });
}

async function revoke(res, body) {
  const voterId = String(body.voterId || '');
  if (!UUID_RE.test(voterId)) return sendJson(res, 400, { error: 'Invalid invite id' });

  const sql = getSql();
  const rows = await sql`
    UPDATE voters SET used_at = COALESCE(used_at, now())
    WHERE id = ${voterId}
    RETURNING id`;
  if (!rows[0]) return sendJson(res, 404, { error: 'Invite not found' });

  await sql`DELETE FROM sessions WHERE voter_id = ${voterId}`;
  return sendJson(res, 200, { ok: true });
}
