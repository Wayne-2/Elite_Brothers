import { getSql } from '../lib/db.js';
import { sendJson, readJson, serverError, UUID_RE } from '../lib/http.js';
import { getSession, denyUnlessRole } from '../lib/session.js';

export default async function handler(req, res) {
  try {
    const session = await getSession(req);
    if (!session) return sendJson(res, 401, { error: 'Not signed in' });

    if (req.method === 'GET') {
      const id = req.query?.id;
      return id ? await sendDetail(res, String(id), session) : await sendList(res, session);
    }

    if (req.method === 'POST') {
      const body = readJson(req);
      if (body.action === 'close' || body.action === 'reopen') {
        return await setStatus(req, res, body, session);
      }
      return await createPoll(req, res, body, session);
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}

async function sendList(res, session) {
  const sql = getSql();
  const rows = await sql`
    SELECT p.id, p.title, p.description, p.status, p.created_at,
      (SELECT count(*) FROM candidates c WHERE c.poll_id = p.id)::int AS candidate_count,
      (SELECT count(*) FROM votes v WHERE v.poll_id = p.id)::int AS vote_count
    FROM polls p
    ORDER BY p.created_at DESC, p.id`;

  const isAdmin = session.role === 'admin';
  const polls = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    candidateCount: row.candidate_count,
    totalVotes: isAdmin || row.status === 'closed' ? row.vote_count : null,
  }));

  return sendJson(res, 200, { polls });
}

async function sendDetail(res, id, session) {
  if (!UUID_RE.test(id)) return sendJson(res, 404, { error: 'Poll not found' });

  const sql = getSql();
  const pollRows = await sql`
    SELECT id, title, description, status, created_at
    FROM polls WHERE id = ${id}`;
  const poll = pollRows[0];
  if (!poll) return sendJson(res, 404, { error: 'Poll not found' });

  const candidates = await sql`
    SELECT id, name, position
    FROM candidates WHERE poll_id = ${id}
    ORDER BY position, name`;

  const isVoter = session.role === 'voter';
  let hasVoted = false;
  let votedFor = null;

  if (isVoter && session.voter_id) {
    const votes = await sql`
      SELECT candidate_id FROM votes
      WHERE poll_id = ${id} AND voter_id = ${session.voter_id}`;
    if (votes[0]) {
      hasVoted = true;
      votedFor = votes[0].candidate_id;
    }
  }

  const isAdmin = session.role === 'admin';
  const eligible = isAdmin || poll.status === 'closed' || hasVoted;

  let results = null;
  if (eligible) {
    const tallies = await sql`
      SELECT c.id, c.name, c.position, COUNT(v.id)::int AS votes
      FROM candidates c
      LEFT JOIN votes v ON v.candidate_id = c.id
      WHERE c.poll_id = ${id}
      GROUP BY c.id, c.name, c.position
      ORDER BY c.position, c.name`;
    const totalVotes = tallies.reduce((sum, row) => sum + row.votes, 0);
    results = {
      totalVotes,
      candidates: tallies.map((row) => ({ id: row.id, name: row.name, votes: row.votes })),
    };
  }

  return sendJson(res, 200, {
    poll: {
      id: poll.id,
      title: poll.title,
      description: poll.description,
      status: poll.status,
      createdAt: poll.created_at,
    },
    candidates: candidates.map((row) => ({ id: row.id, name: row.name })),
    results,
    votedFor,
    hasVoted,
    canVote: poll.status === 'open' && isVoter && !hasVoted,
  });
}

async function createPoll(req, res, body, session) {
  if (denyUnlessRole(res, session, 'admin')) return;

  const sql = getSql();
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const names = Array.isArray(body.candidates)
    ? body.candidates.map((name) => String(name || '').trim()).filter(Boolean)
    : [];

  if (title.length < 1 || title.length > 200) {
    return sendJson(res, 400, { error: 'Poll title must be between 1 and 200 characters' });
  }
  if (description.length > 2000) {
    return sendJson(res, 400, { error: 'Description must be 2000 characters or fewer' });
  }
  if (names.length < 2 || names.length > 20) {
    return sendJson(res, 400, { error: 'Add between 2 and 20 options' });
  }
  if (names.some((name) => name.length > 80)) {
    return sendJson(res, 400, { error: 'Option names must be 80 characters or fewer' });
  }
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    return sendJson(res, 400, { error: 'Options must be unique' });
  }

  const pollRows = await sql`
    INSERT INTO polls (title, description)
    VALUES (${title}, ${description})
    RETURNING id, created_at`;
  const pollId = pollRows[0].id;

  try {
    const placeholders = names.map((_, i) => `($1, $${i + 2}, ${i})`).join(', ');
    await sql.query(
      `INSERT INTO candidates (poll_id, name, position) VALUES ${placeholders}`,
      [pollId, ...names]
    );
  } catch (err) {
    await sql`DELETE FROM polls WHERE id = ${pollId}`;
    throw err;
  }

  return sendJson(res, 201, { id: pollId, title, createdAt: pollRows[0].created_at });
}

async function setStatus(req, res, body, session) {
  if (denyUnlessRole(res, session, 'admin')) return;

  const id = String(body.id || '');
  if (!UUID_RE.test(id)) return sendJson(res, 400, { error: 'Invalid poll id' });

  const status = body.action === 'close' ? 'closed' : 'open';
  const sql = getSql();
  const rows = await sql`
    UPDATE polls SET status = ${status}
    WHERE id = ${id}
    RETURNING id`;
  if (!rows[0]) return sendJson(res, 404, { error: 'Poll not found' });

  return sendJson(res, 200, { ok: true, id, status });
}
