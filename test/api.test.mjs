// End-to-end API tests.
// Runs the real handlers + real migrate script against an in-process Postgres
// (PGlite) by mocking the @neondatabase/serverless driver.
//
// Run with: npm test

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

process.env.DATABASE_URL = 'postgres://user:pass@fake.neon.tech/db';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.VERCEL_ENV = 'development';

const db = new PGlite();

async function runQuery(text, params = []) {
  const { rows } = await db.query(text, params);
  return rows;
}

function fakeNeon() {
  const sql = (strings, ...values) => {
    let text = '';
    const params = [];
    for (let i = 0; i < values.length; i++) {
      text += strings[i] + `$${i + 1}`;
      params.push(values[i]);
    }
    text += strings[values.length];
    return runQuery(text, params);
  };
  sql.query = (text, params = []) => runQuery(text, params);
  return sql;
}

mock.module('@neondatabase/serverless', { namedExports: { neon: fakeNeon } });

await import('../scripts/migrate.mjs');
const { default: authHandler } = await import('../api/auth.js');
const { default: pollsHandler } = await import('../api/polls.js');
const { default: voteHandler } = await import('../api/vote.js');
const { default: invitesHandler } = await import('../api/invites.js');

const TEST_IP = '10.9.8.7';

function call(handler, { method = 'GET', body, query, cookies, headers } = {}) {
  const req = {
    method,
    body,
    query: query ?? {},
    cookies: cookies ?? {},
    headers: { 'x-forwarded-for': TEST_IP, ...headers },
    socket: { remoteAddress: TEST_IP },
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk = '') {
      this.body = String(chunk);
    },
  };

  return Promise.resolve(handler(req, res)).then(() => {
    let data = null;
    try {
      data = JSON.parse(res.body);
    } catch {
      /* no JSON body */
    }
    return { status: res.statusCode, data, headers: res.headers };
  });
}

function cookieFrom(res) {
  const setCookie = res.headers['set-cookie'];
  assert.ok(setCookie, 'expected a Set-Cookie header');
  const match = /(?:^|;\s*)sid=([^;]+)/.exec(setCookie);
  assert.ok(match, 'expected sid cookie');
  return { sid: match[1] };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('voting app API', async (t) => {
  let adminCookies;
  let pollId;
  let candidateIds;
  let otherPollId;
  let otherCandidateId;
  let inviteCodes;
  let voter1;
  let voter2;
  let voter3;
  let spareCode;

  await t.test('migrate created the schema', async () => {
    const rows = await runQuery('SELECT COUNT(*)::int AS n FROM polls');
    assert.equal(rows[0].n, 0);
    await runQuery('SELECT COUNT(*)::int FROM votes');
    await runQuery('SELECT COUNT(*)::int FROM sessions');
  });

  await t.test('unauthenticated requests are rejected', async () => {
    let res = await call(authHandler);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { authenticated: false });

    res = await call(pollsHandler);
    assert.equal(res.status, 401);

    res = await call(voteHandler, { method: 'POST', body: { pollId: 'x', candidateId: 'y' } });
    assert.equal(res.status, 401);

    res = await call(invitesHandler);
    assert.equal(res.status, 401);
  });

  await t.test('admin sign-in', async () => {
    let res = await call(authHandler, {
      method: 'POST',
      body: { action: 'admin', password: 'wrong' },
    });
    assert.equal(res.status, 401);

    res = await call(authHandler, {
      method: 'POST',
      body: { action: 'admin', password: 'correct-horse-battery' },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers['set-cookie'], /HttpOnly/);
    assert.match(res.headers['set-cookie'], /SameSite=Lax/);
    assert.match(res.headers['set-cookie'], /Path=\//);
    adminCookies = cookieFrom(res);

    res = await call(authHandler, { cookies: adminCookies });
    assert.deepEqual(res.data, { authenticated: true, role: 'admin', voterId: null });
  });

  await t.test('admin creates a poll', async () => {
    let res = await call(pollsHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { title: '', candidates: ['A', 'B'] },
    });
    assert.equal(res.status, 400);

    res = await call(pollsHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { title: 'President 2026', candidates: ['Only One'] },
    });
    assert.equal(res.status, 400);

    res = await call(pollsHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { title: 'President 2026', candidates: ['Alice', 'Bob', 'alice'] },
    });
    assert.equal(res.status, 400);

    res = await call(pollsHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: {
        title: 'President 2026',
        description: 'Choose the next club president.',
        candidates: ['Alice', 'Bob', 'Carol'],
      },
    });
    assert.equal(res.status, 201);
    assert.match(res.data.id, UUID_RE);
    pollId = res.data.id;

    res = await call(pollsHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { title: 'Best meeting time', candidates: ['Morning', 'Evening'] },
    });
    assert.equal(res.status, 201);
    otherPollId = res.data.id;
  });

  await t.test('poll detail: admin sees results, cannot vote', async () => {
    let res = await call(pollsHandler, { query: { id: pollId }, cookies: adminCookies });
    assert.equal(res.status, 200);
    assert.equal(res.data.candidates.length, 3);
    assert.equal(res.data.results.totalVotes, 0);
    assert.equal(res.data.canVote, false);
    candidateIds = res.data.candidates.map((c) => c.id);

    res = await call(pollsHandler, { query: { id: otherPollId }, cookies: adminCookies });
    otherCandidateId = res.data.candidates[0].id;

    res = await call(voteHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { pollId, candidateId: candidateIds[0] },
    });
    assert.equal(res.status, 403);
  });

  await t.test('admin generates invite codes', async () => {
    let res = await call(invitesHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'generate', count: 0 },
    });
    assert.equal(res.status, 400);

    res = await call(invitesHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'generate', count: 4 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.invites.length, 4);
    for (const invite of res.data.invites) {
      assert.match(invite.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
    inviteCodes = res.data.invites.map((i) => i.code.replace('-', ''));
    spareCode = inviteCodes[3];
  });

  await t.test('voter signs in with invite code', async () => {
    let res = await call(authHandler, {
      method: 'POST',
      body: { action: 'invite', inviteCode: 'nope' },
    });
    assert.equal(res.status, 400);

    res = await call(authHandler, {
      method: 'POST',
      body: { action: 'invite', inviteCode: inviteCodes[0] },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers['set-cookie'], /HttpOnly/);
    voter1 = cookieFrom(res);

    res = await call(authHandler, { cookies: voter1 });
    assert.deepEqual(res.data, { authenticated: true, role: 'voter', voterId: res.data.voterId });
    assert.ok(res.data.voterId);

    res = await call(authHandler, {
      method: 'POST',
      body: { action: 'invite', inviteCode: inviteCodes[0] },
    });
    assert.equal(res.status, 401);
  });

  await t.test('poll list hides tallies while open', async () => {
    const res = await call(pollsHandler, { cookies: voter1 });
    assert.equal(res.status, 200);
    assert.equal(res.data.polls.length, 2);
    const open = res.data.polls.find((p) => p.id === pollId);
    assert.equal(open.totalVotes, null);
    assert.equal(open.candidateCount, 3);
  });

  await t.test('voter sees no results before voting', async () => {
    const res = await call(pollsHandler, { query: { id: pollId }, cookies: voter1 });
    assert.equal(res.status, 200);
    assert.equal(res.data.results, null);
    assert.equal(res.data.hasVoted, false);
    assert.equal(res.data.canVote, true);
    assert.equal(res.data.votedFor, null);
  });

  await t.test('voting rules are enforced', async () => {
    let res = await call(voteHandler, {
      method: 'POST',
      cookies: voter1,
      body: { pollId: 'not-a-uuid', candidateId: candidateIds[0] },
    });
    assert.equal(res.status, 400);

    const randomUuid = '00000000-0000-4000-8000-000000000000';
    res = await call(voteHandler, {
      method: 'POST',
      cookies: voter1,
      body: { pollId, candidateId: randomUuid },
    });
    assert.equal(res.status, 400);

    res = await call(voteHandler, {
      method: 'POST',
      cookies: voter1,
      body: { pollId, candidateId: otherCandidateId },
    });
    assert.equal(res.status, 400);

    res = await call(voteHandler, {
      method: 'POST',
      cookies: voter1,
      body: { pollId, candidateId: candidateIds[1] },
    });
    assert.equal(res.status, 201);

    res = await call(voteHandler, {
      method: 'POST',
      cookies: voter1,
      body: { pollId, candidateId: candidateIds[0] },
    });
    assert.equal(res.status, 409);
  });

  await t.test('voter sees results after voting', async () => {
    const res = await call(pollsHandler, { query: { id: pollId }, cookies: voter1 });
    assert.equal(res.status, 200);
    assert.equal(res.data.hasVoted, true);
    assert.equal(res.data.votedFor, candidateIds[1]);
    assert.equal(res.data.canVote, false);
    assert.equal(res.data.results.totalVotes, 1);
    assert.equal(res.data.results.candidates.find((c) => c.id === candidateIds[1]).votes, 1);
  });

  await t.test('second voter votes and tallies add up', async () => {
    let res = await call(authHandler, {
      method: 'POST',
      body: { action: 'invite', inviteCode: inviteCodes[1] },
    });
    assert.equal(res.status, 200);
    voter2 = cookieFrom(res);

    res = await call(voteHandler, {
      method: 'POST',
      cookies: voter2,
      body: { pollId, candidateId: candidateIds[1] },
    });
    assert.equal(res.status, 201);

    res = await call(voteHandler, {
      method: 'POST',
      cookies: voter1,
      body: { pollId: otherPollId, candidateId: otherCandidateId },
    });
    assert.equal(res.status, 201, 'a voter may vote once in each poll');

    res = await call(pollsHandler, { query: { id: pollId }, cookies: adminCookies });
    assert.equal(res.data.results.totalVotes, 2);
    assert.equal(res.data.results.candidates.find((c) => c.id === candidateIds[1]).votes, 2);
  });

  await t.test('closing a poll reveals results and blocks votes', async () => {
    let res = await call(pollsHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'close', id: 'nope' },
    });
    assert.equal(res.status, 400);

    res = await call(pollsHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'close', id: pollId },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'closed');

    res = await call(authHandler, {
      method: 'POST',
      body: { action: 'invite', inviteCode: inviteCodes[2] },
    });
    assert.equal(res.status, 200);
    voter3 = cookieFrom(res);

    res = await call(pollsHandler, { query: { id: pollId }, cookies: voter3 });
    assert.equal(res.data.results.totalVotes, 2, 'closed poll shows results to non-voters');
    assert.equal(res.data.canVote, false);

    res = await call(voteHandler, {
      method: 'POST',
      cookies: voter3,
      body: { pollId, candidateId: candidateIds[0] },
    });
    assert.equal(res.status, 409);

    res = await call(pollsHandler, { cookies: voter1 });
    const closed = res.data.polls.find((p) => p.id === pollId);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.totalVotes, 2, 'list shows tallies once closed');
  });

  await t.test('blocking and reactivating invite codes', async () => {
    const spareVoter = await call(invitesHandler, { cookies: adminCookies });
    const spareVoterId = spareVoter.data.invites.find(
      (i) => i.code === `${spareCode.slice(0, 4)}-${spareCode.slice(4)}`
    ).id;

    let res = await call(invitesHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'revoke', voterId: spareVoterId },
    });
    assert.equal(res.status, 200);

    res = await call(authHandler, {
      method: 'POST',
      body: { action: 'invite', inviteCode: spareCode },
    });
    assert.equal(res.status, 401, 'blocked code cannot sign in');

    res = await call(invitesHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'revoke', voterId: voter3.sid },
    });
    assert.equal(res.status, 400, 'invalid invite id rejected');

    res = await call(invitesHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'reopen', voterId: spareVoterId },
    });
    assert.equal(res.status, 200);

    res = await call(authHandler, {
      method: 'POST',
      body: { action: 'invite', inviteCode: spareCode },
    });
    assert.equal(res.status, 200, 'reactivated code can sign in again');
  });

  await t.test('blocking a used code signs the member out', async () => {
    const voter2Code = `${inviteCodes[1].slice(0, 4)}-${inviteCodes[1].slice(4)}`;

    let res = await call(authHandler, { cookies: voter2 });
    assert.equal(res.data.authenticated, true);

    const list = await call(invitesHandler, { cookies: adminCookies });
    const invite = list.data.invites.find((i) => i.code === voter2Code);
    assert.ok(invite?.used, 'voter 2 code should be marked used');

    res = await call(invitesHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'revoke', voterId: invite.id },
    });
    assert.equal(res.status, 200);

    res = await call(authHandler, { cookies: voter2 });
    assert.equal(res.data.authenticated, false, 'sessions are destroyed on block');

    res = await call(authHandler, { cookies: voter1 });
    assert.equal(res.data.authenticated, true, 'other members stay signed in');
  });

  await t.test('voters cannot use admin endpoints', async () => {
    let res = await call(pollsHandler, {
      method: 'POST',
      cookies: voter1,
      body: { title: 'Sneaky', candidates: ['A', 'B'] },
    });
    assert.equal(res.status, 403);

    res = await call(invitesHandler, { cookies: voter1 });
    assert.equal(res.status, 403);
  });

  await t.test('sign out', async () => {
    let res = await call(authHandler, { method: 'POST', cookies: voter3, body: { action: 'logout' } });
    assert.equal(res.status, 200);
    assert.match(res.headers['set-cookie'], /Max-Age=0/);

    res = await call(authHandler, { cookies: voter3 });
    assert.equal(res.data.authenticated, false);
  });

  await t.test('missing resources', async () => {
    let res = await call(pollsHandler, {
      query: { id: '00000000-0000-4000-8000-000000000000' },
      cookies: adminCookies,
    });
    assert.equal(res.status, 404);

    res = await call(pollsHandler, { query: { id: 'bogus' }, cookies: adminCookies });
    assert.equal(res.status, 404);

    res = await call(pollsHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'close', id: '00000000-0000-4000-8000-000000000000' },
    });
    assert.equal(res.status, 404);

    res = await call(invitesHandler, {
      method: 'POST',
      cookies: adminCookies,
      body: { action: 'reopen', voterId: '00000000-0000-4000-8000-000000000000' },
    });
    assert.equal(res.status, 404);
  });
});
