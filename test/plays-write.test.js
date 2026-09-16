// The record's write path, driven with real Requests through the real gate, the
// way test/players-write.test.js drives profile writes.
//
// The D1 stub keeps rows for the three tables this path touches and applies the
// five statements worker/api.js issues, including the two idempotent ones — the
// update that only fires while `ended_at` is null and the insert that ignores a
// result already written. Without those, "ending twice leaves one row" would
// pass against a Worker that wrote three.
//
// What it is not is a database. It checks the Worker's decisions, not SQLite's.

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleGate } from '../worker/gate.js';
import { handleApi } from '../worker/api.js';
import { GATE_COOKIE, WHO_COOKIE } from '../worker/auth.js';

const PASSPHRASE = 'blue fox';
const SECRET = 'test-session-secret-test-session-secret';

/** Two profiles: the one playing, and the one a forged body will try to blame. */
const HOUSE = () => [
  { id: 'p1', screen_name: 'Eleven', avatar: 'fox', created_at: 1, retired_at: null },
  { id: 'p3', screen_name: 'Twelve', avatar: 'dragon', created_at: 2, retired_at: null },
];

/** @param {object[]} players */
function fakeDb(players) {
  const plays = [];
  const results = [];

  /** @param {string} sql @param {any[]} args */
  function statement(sql, args) {
    const exec = () => {
      if (sql.startsWith('SELECT id, screen_name, avatar FROM players')) {
        return { results: players.filter((row) => row.retired_at === null) };
      }

      if (sql.startsWith('SELECT id FROM plays')) {
        return plays.find((row) => row.id === args[0]) ?? null;
      }

      if (sql.startsWith('INSERT INTO plays')) {
        const [id, session_id, game, mode, config_json, started_at] = args;
        plays.push({ id, session_id, game, mode, config_json, started_at, ended_at: null });
        return { success: true };
      }

      if (sql.startsWith('UPDATE plays SET ended_at')) {
        const [ended_at, id] = args;
        const row = plays.find((play) => play.id === id && play.ended_at === null);
        if (row) row.ended_at = ended_at;
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }

      if (sql.startsWith('INSERT OR IGNORE INTO play_results')) {
        const [play_id, player_id, rank, outcome, value, unit, detail_json] = args;
        if (!plays.some((play) => play.id === play_id)) {
          throw new Error('D1_ERROR: FOREIGN KEY constraint failed');
        }
        if (!players.some((player) => player.id === player_id)) {
          throw new Error('D1_ERROR: FOREIGN KEY constraint failed');
        }
        const held = results.some((row) => row.play_id === play_id && row.player_id === player_id);
        if (!held) results.push({ play_id, player_id, rank, outcome, value, unit, detail_json });
        return { success: true };
      }

      throw new Error(`the stub does not know this statement: ${sql}`);
    };

    return {
      exec,
      run: async () => exec(),
      first: async () => exec(),
      all: async () => exec(),
    };
  }

  return {
    plays,
    results,
    prepare: (sql) => ({ bind: (...args) => statement(sql, args), ...statement(sql, []) }),
    batch: async (statements) => statements.map((entry) => entry.exec()),
  };
}

const env = (players = HOUSE()) => ({
  FAMILY_PASSPHRASE: PASSPHRASE,
  SESSION_SECRET: SECRET,
  DB: fakeDb(players),
});

/** @param {string} path @param {RequestInit & { cookie?: string }} [init] */
function req(path, init = {}) {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set('cookie', cookie);
  return new Request(`https://games.example${path}`, { ...rest, headers });
}

const cookieFrom = (response, name) => {
  const line = (response.headers.getSetCookie() || []).find((c) => c.startsWith(`${name}=`));
  return line ? line.slice(0, line.indexOf(';')) : null;
};

/** Types the passphrase, then picks a profile: what a phone mid-game carries. */
async function sitDown(e, id = 'p1') {
  const gated = await handleGate(
    req('/gate', {
      method: 'POST',
      body: new URLSearchParams({ word: PASSPHRASE, next: '/' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
    e,
  );
  const gate = cookieFrom(gated, GATE_COOKIE);

  const picked = await handleApi(
    req('/api/who', { method: 'POST', cookie: gate, body: JSON.stringify({ id }) }),
    e,
    '/api/who',
  );
  return `${gate}; ${cookieFrom(picked, WHO_COOKIE)}`;
}

const A_PIT_GAME = { game: 'pit', mode: 'bots', config: { target: 300, commodities: ['joy', 'peace'] } };

/** @param {any} e @param {string} cookie @param {object} body */
const open = (e, cookie, body = A_PIT_GAME) =>
  handleApi(req('/api/plays', { method: 'POST', cookie, body: JSON.stringify(body) }), e, '/api/plays');

/** @param {any} e @param {string} cookie @param {string} id @param {object} body */
const close = (e, cookie, id, body) =>
  handleApi(
    req(`/api/plays/${id}/end`, { method: 'POST', cookie, body: JSON.stringify(body) }),
    e,
    `/api/plays/${id}/end`,
  );

const A_WIN = {
  result: { rank: 1, outcome: 'won', value: 310, unit: 'points', detail: { corners: 3, rankOf: 4 } },
};

test('the record is behind the gate, and a refusal writes nothing', async () => {
  const e = env();

  const opened = await open(e, '', A_PIT_GAME);
  assert.equal(opened.status, 401);
  assert.equal((await opened.json()).gate, '/gate');
  assert.equal(e.DB.plays.length, 0, 'no row is opened for somebody who is not through the door');

  const closed = await close(e, '', 'anything', A_WIN);
  assert.equal(closed.status, 401);
  assert.equal(e.DB.results.length, 0);
});

test('dealing opens a row, with an id and a clock the client did not choose', async () => {
  const e = env();
  const cookie = await sitDown(e);

  const response = await open(e, cookie, { ...A_PIT_GAME, id: 'chosen-by-the-client', started_at: 5 });
  assert.equal(response.status, 201);

  const play = await response.json();
  assert.notEqual(play.id, 'chosen-by-the-client', 'a client that picks its own id can overwrite a row');
  assert.ok(play.id.length > 8);
  assert.notEqual(play.started_at, 5, "and a client's clock is a kid's phone clock");
  assert.ok(play.started_at > 1e12);

  assert.equal(e.DB.plays.length, 1);
  const row = e.DB.plays[0];
  assert.equal(row.id, play.id);
  assert.equal(row.game, 'pit');
  assert.equal(row.mode, 'bots');
  assert.equal(row.ended_at, null, 'a row is open until somebody ends it');
  assert.equal(row.session_id, null, 'a Pit session is one play, not one play per round');
  assert.deepEqual(JSON.parse(row.config_json).commodities, ['joy', 'peace']);
});

test('a finished game closes the row and writes one result', async () => {
  const e = env();
  const cookie = await sitDown(e);
  const { id } = await (await open(e, cookie)).json();

  const response = await close(e, cookie, id, A_WIN);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  assert.ok(e.DB.plays[0].ended_at > 1e12);
  assert.equal(e.DB.results.length, 1);
  const result = e.DB.results[0];
  assert.equal(result.play_id, id);
  assert.equal(result.player_id, 'p1');
  assert.equal(result.rank, 1);
  assert.equal(result.outcome, 'won');
  assert.equal(result.value, 310);
  assert.equal(result.unit, 'points');
  assert.equal(JSON.parse(result.detail_json).corners, 3);
});

test('the result is written for the cookie, whatever the body says', async () => {
  const e = env();
  const cookie = await sitDown(e, 'p1');
  const { id } = await (await open(e, cookie)).json();

  await close(e, cookie, id, {
    player_id: 'p3',
    result: { ...A_WIN.result, player_id: 'p3', playerId: 'p3' },
  });

  assert.equal(e.DB.results.length, 1);
  assert.equal(e.DB.results[0].player_id, 'p1', 'the signature on the cookie is what this is for');
});

test('an abandoned game is a row with an ending and no result', async () => {
  const e = env();
  const cookie = await sitDown(e);
  const { id } = await (await open(e, cookie)).json();

  const response = await close(e, cookie, id, { result: null });
  assert.equal(response.status, 200);
  assert.ok(e.DB.plays[0].ended_at > 1e12, 'it ended, and when is worth having');
  assert.equal(e.DB.results.length, 0, '"we started six and finished two" is a true sentence');
});

test('a phone on bad wifi can send the same ending twice', async () => {
  const e = env();
  const cookie = await sitDown(e);
  const { id } = await (await open(e, cookie)).json();

  await close(e, cookie, id, A_WIN);
  const first = e.DB.plays[0].ended_at;

  const again = await close(e, cookie, id, { result: { ...A_WIN.result, value: 999 } });
  assert.equal(again.status, 200);
  assert.equal(e.DB.plays[0].ended_at, first, 'the second ending does not move the first one');
  assert.equal(e.DB.results.length, 1, 'and does not write a second result');
  assert.equal(e.DB.results[0].value, 310, 'the row that is there is the one that was written');
});

test('a play nobody opened cannot be ended', async () => {
  const e = env();
  const cookie = await sitDown(e);

  const response = await close(e, cookie, 'no-such-play', A_WIN);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'no_such_play');
  assert.equal(e.DB.results.length, 0);
});

test('a device with nobody on it cannot write a result', async () => {
  const e = env();
  const gated = await handleGate(
    req('/gate', {
      method: 'POST',
      body: new URLSearchParams({ word: PASSPHRASE, next: '/' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
    e,
  );
  const gate = cookieFrom(gated, GATE_COOKIE);
  const { id } = await (await open(e, gate)).json();

  const response = await close(e, gate, id, A_WIN);
  assert.equal(response.status, 403);
  assert.equal(e.DB.results.length, 0, 'there is nobody for the row to belong to');

  const abandoned = await close(e, gate, id, { result: null });
  assert.equal(abandoned.status, 200, 'but the play can still be closed, which is the honest row');
  assert.ok(e.DB.plays[0].ended_at > 1e12);
});

test('a game or a mode that is not a slug is refused, by name', async () => {
  const e = env();
  const cookie = await sitDown(e);

  for (const game of ['', 'Pit', 'pit/../admin', 'a'.repeat(33)]) {
    const response = await open(e, cookie, { game, mode: 'bots' });
    assert.equal(response.status, 400, `${game} is not a game slug`);
    assert.equal((await response.json()).field, 'game');
  }

  const mode = await open(e, cookie, { game: 'pit', mode: 'BOTS!' });
  assert.equal(mode.status, 400);
  assert.equal((await mode.json()).field, 'mode');

  assert.equal(e.DB.plays.length, 0);
});

test('a config or a detail too big for the log is refused, by name', async () => {
  const e = env();
  const cookie = await sitDown(e);

  const fat = await open(e, cookie, { ...A_PIT_GAME, config: { note: 'x'.repeat(5000) } });
  assert.equal(fat.status, 400);
  assert.equal((await fat.json()).field, 'config');
  assert.equal(e.DB.plays.length, 0);

  const { id } = await (await open(e, cookie)).json();
  const wordy = await close(e, cookie, id, {
    result: { ...A_WIN.result, detail: { seats: 'x'.repeat(3000) } },
  });
  assert.equal(wordy.status, 400);
  assert.equal((await wordy.json()).field, 'detail');
  assert.equal(e.DB.plays[0].ended_at, null, 'a refused result does not end the play');
  assert.equal(e.DB.results.length, 0);
});

test('a result has to be shaped like one', async () => {
  const e = env();
  const cookie = await sitDown(e);
  const { id } = await (await open(e, cookie)).json();

  for (const [result, field] of [
    [{ outcome: 'Won big' }, 'outcome'],
    [{ outcome: 'won', rank: 1.5 }, 'rank'],
    [{ outcome: 'won', value: 'lots' }, 'value'],
    [{ outcome: 'won', unit: 'Points Scored' }, 'unit'],
  ]) {
    const response = await close(e, cookie, id, { result });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).field, field);
  }

  assert.equal(e.DB.results.length, 0);
  assert.equal(e.DB.plays[0].ended_at, null);
});

test('writing is POST, and the refusal names the verbs that are not', async () => {
  const e = env();
  const cookie = await sitDown(e);
  const { id } = await (await open(e, cookie)).json();

  // /api/plays also reads now (worker/record.js, test/plays-read.test.js).
  // Anything that is neither is refused here, and the allow header says both.
  const patched = await handleApi(req('/api/plays', { method: 'PATCH', cookie }), e, '/api/plays');
  assert.equal(patched.status, 405);
  assert.equal(patched.headers.get('allow'), 'GET, POST');

  // Ending never reads. There is nothing at that path to GET.
  const got = await handleApi(req(`/api/plays/${id}/end`, { cookie }), e, `/api/plays/${id}/end`);
  assert.equal(got.status, 405);
  assert.equal(got.headers.get('allow'), 'POST');
});
