import { getSql } from '../lib/db.js';
import { sendJson, readJson, serverError, UUID_RE } from '../lib/http.js';
import { getSession, denyUnlessRole } from '../lib/session.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    const session = await getSession(req);
    if (denyUnlessRole(res, session, 'voter')) return;

    const body = readJson(req);
    const pollId = String(body.pollId || '');
    const candidateId = String(body.candidateId || '');

    if (!UUID_RE.test(pollId) || !UUID_RE.test(candidateId)) {
      return sendJson(res, 400, { error: 'Invalid vote payload' });
    }

    const sql = getSql();

    const pollRows = await sql`
      SELECT status FROM polls WHERE id = ${pollId}`;
    const poll = pollRows[0];
    if (!poll) return sendJson(res, 404, { error: 'Poll not found' });
    if (poll.status !== 'open') return sendJson(res, 409, { error: 'This poll is closed' });

    const candidateRows = await sql`
      SELECT id FROM candidates
      WHERE id = ${candidateId} AND poll_id = ${pollId}`;
    if (!candidateRows[0]) {
      return sendJson(res, 400, { error: 'That option is not part of this poll' });
    }

    const inserted = await sql`
      INSERT INTO votes (poll_id, candidate_id, voter_id)
      VALUES (${pollId}, ${candidateId}, ${session.voter_id})
      ON CONFLICT (poll_id, voter_id) DO NOTHING
      RETURNING id`;
    if (!inserted[0]) {
      return sendJson(res, 409, { error: 'You have already voted in this poll' });
    }

    return sendJson(res, 201, { ok: true });
  } catch (err) {
    return serverError(res, err);
  }
}
