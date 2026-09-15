// The record's read path, driven with real Requests through the real gate, the
// way test/plays-write.test.js drives the writes.
//
// The D1 stub holds rows for the three tables and applies the statements
// worker/record.js issues — including the compound cursor and the page
// subquery the results and players statements repeat, because "two plays in the
// same millisecond both come back" is a claim about that WHERE clause and
// nothing else would test it.
//
// What it is not is a database. It checks the Worker's decisions, not SQLite's.

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleGate } from '../worker/gate.js';
import { handleApi } from '../worker/api.js';
import { GATE_COOKIE } from '../worker/auth.js';

const PASSPHRASE = 'blue fox';
const SECRET = 'test-session-secret-test-session-secret';

/** Three profiles, one of them retired: a result outlives the profile. */
const HOUSE = () => [
  { id: 'p1', screen_name: 'Eleven', avatar: 'fox', created_at: 1, retired_at: null },
  { id: 'p2', screen_name: 'Twelve', avatar: 'dragon', created_at: 2, retired_at: null },
  { id: 'p3', screen_name: 'Gone', avatar: 'owl', created_at: 3, retired_at: 99 },
];

/**
 * @param {object[]} players
 * @param {object[]} plays
 * @param {object[]} results
 */
function fakeDb(players, plays, results) {
  /** The page worker/record.js asks for, recomputed from the same binds. */
  function pageOf(args) {
    const bound = [...args];
    const limit = bound.pop();

    let rows = [...plays];
    // The binds arrive in the order the WHERE clause was built: game, then the
    // three of the cursor, then the limit.
    if (typeof bound[0] === 'string') {
      const game = bound.shift();
      rows = rows.filter((row) => row.game === game);
    }
    if (bound.length === 3) {
      const [at, , id] = bound;
      rows = rows.filter((row) => row.started_at < at || (row.started_at === at && row.id < id));
    }

    rows.sort((a, b) => b.started_at - a.started_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return rows.slice(0, limit);
  }

  /** @param {string} sql @param {any[]} args */
  function statement(sql, args) {
    const exec = () => {
      if (sql.startsWith('SELECT id, screen_name, avatar FROM players')) {
        return { results: players.filter((row) => row.retired_at === null) };
      }

      if (sql.startsWith('SELECT id, game, mode, config_json')) {
        return { results: pageOf(args) };
      }

      if (sql.startsWith('SELECT play_id, player_id, rank')) {
        const ids = new Set(pageOf(args).map((row) => row.id));
        const rows = results.filter((row) => ids.has(row.play_id));
        rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (a.player_id < b.player_id ? -1 : 1));
        return { results: rows };
      }

      if (sql.startsWith('SELECT id, screen_name, avatar, retired_at FROM players')) {
        const ids = new Set(pageOf(args).map((row) => row.id));
        const named = new Set(results.filter((row) => ids.has(row.play_id)).map((row) => row.player_id));
        return { results: players.filter((row) => named.has(row.id)) };
      }

      if (sql.startsWith('SELECT COUNT(*) AS n FROM plays')) {
        return { results: [{ n: plays.length }] };
      }

      if (sql.startsWith('SELECT COUNT(DISTINCT play_id) AS n FROM play_results')) {
        return { results: [{ n: new Set(results.map((row) => row.play_id)).size }] };
      }

      if (sql.startsWith('SELECT player_id, outcome, COUNT(*) AS n FROM play_results')) {
        /** @type {Map<string, { player_id: string, outcome: string, n: number }>} */
        const groups = new Map();
        for (const row of results) {
          const key = `${row.player_id}|${row.outcome}`;
          const entry = groups.get(key) || { player_id: row.player_id, outcome: row.outcome, n: 0 };
          entry.n += 1;
          groups.set(key, entry);
        }
        return { results: [...groups.values()] };
      }

      if (sql.startsWith('SELECT started_at FROM plays ORDER BY started_at DESC')) {
        const rows = [...plays].sort((a, b) => b.started_at - a.started_at).slice(0, args[0]);
        return { results: rows.map((row) => ({ started_at: row.started_at })) };
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

const env = ({ players = HOUSE(), plays = [], results = [] } = {}) => ({
  FAMILY_PASSPHRASE: PASSPHRASE,
  SESSION_SECRET: SECRET,
  DB: fakeDb(players, plays, results),
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

/** Types the passphrase. Reading the record needs nothing else. */
async function knock(e) {
  const gated = await handleGate(
    req('/gate', {
      method: 'POST',
      body: new URLSearchParams({ word: PASSPHRASE, next: '/' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
    e,
  );
  return cookieFrom(gated, GATE_COOKIE);
}

/** @param {any} e @param {string} cookie @param {string} [query] */
async function plays(e, cookie, query = '') {
  const response = await handleApi(req(`/api/plays${query}`, { cookie }), e, '/api/plays');
  return { response, body: await response.json() };
}

/** @param {any} e @param {string} cookie */
async function stats(e, cookie) {
  const response = await handleApi(req('/api/stats', { cookie }), e, '/api/stats');
  return { response, body: await response.json() };
}

/** @param {string} id @param {number} started_at @param {object} [extra] */
const play = (id, started_at, extra = {}) => ({
  id,
  session_id: null,
  game: 'pit',
  mode: 'bots',
  config_json: '{"target":300}',
  started_at,
  ended_at: started_at + 1000,
  ...extra,
});

/** @param {string} play_id @param {string} player_id @param {object} [extra] */
const result = (play_id, player_id, extra = {}) => ({
  play_id,
  player_id,
  rank: 1,
  outcome: 'won',
  value: 310,
  unit: 'points',
  detail_json: '{"corners":3}',
  ...extra,
});

test('the record is behind the gate, in both directions', async () => {
  const e = env({ plays: [play('a', 1000)] });

  const log = await plays(e, '');
  assert.equal(log.response.status, 401);
  assert.equal(log.body.gate, '/gate');

  const tile = await stats(e, '');
  assert.equal(tile.response.status, 401);
});

test('both routes are GET, and say so when they are not', async () => {
  const e = env();
  const cookie = await knock(e);

  const put = await handleApi(req('/api/stats', { method: 'PUT', cookie }), e, '/api/stats');
  assert.equal(put.status, 405);
  assert.equal(put.headers.get('allow'), 'GET');

  // /api/plays answers to both verbs now, and the refusal has to say both.
  const patched = await handleApi(req('/api/plays', { method: 'PATCH', cookie }), e, '/api/plays');
  assert.equal(patched.status, 405);
  assert.equal(patched.headers.get('allow'), 'GET, POST');
});

test('the log comes back newest first, with its results and the players they name', async () => {
  const e = env({
    plays: [play('a', 1000), play('b', 3000), play('c', 2000, { game: 'sudoku', mode: 'solo' })],
    results: [
      result('a', 'p1'),
      result('b', 'p2', { rank: 2, outcome: 'lost', value: 90 }),
      result('c', 'p1', { outcome: 'solved', value: 412, unit: 'seconds', detail_json: null }),
    ],
  });
  const cookie = await knock(e);

  const { response, body } = await plays(e, cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  assert.deepEqual(body.plays.map((row) => row.id), ['b', 'c', 'a']);
  assert.deepEqual(body.plays[0].results[0], {
    player_id: 'p2',
    rank: 2,
    outcome: 'lost',
    value: 90,
    unit: 'points',
    detail: { corners: 3 },
  });
  // Handed through parsed and unread: the Worker has no idea what a target is.
  assert.deepEqual(body.plays[0].config, { target: 300 });
  assert.equal(body.plays[1].results[0].detail, null);

  assert.deepEqual(
    body.players.map((row) => row.id).sort(),
    ['p1', 'p2'],
    'every player the page names, and nobody it does not',
  );
  assert.equal(body.next, null, 'a page shorter than the limit is the end of the record');
});

test('a play nobody finished comes back, both ways of not finishing', async () => {
  const e = env({
    plays: [
      play('locked', 3000, { ended_at: null }), // the phone was locked
      play('walked', 2000), // ended, and no result written
      play('done', 1000),
    ],
    results: [result('done', 'p1')],
  });
  const cookie = await knock(e);

  const { body } = await plays(e, cookie);
  assert.deepEqual(body.plays.map((row) => row.id), ['locked', 'walked', 'done']);
  assert.equal(body.plays[0].ended_at, null);
  assert.deepEqual(body.plays[0].results, []);
  assert.equal(body.plays[1].ended_at, 3000);
  assert.deepEqual(body.plays[1].results, [], 'ended with no result is a game somebody walked away from');
  assert.equal(body.plays[2].results.length, 1);
});

test('a retired player is in the answer, because their rows are', async () => {
  const e = env({ plays: [play('a', 1000)], results: [result('a', 'p3')] });
  const cookie = await knock(e);

  const { body } = await plays(e, cookie);
  const gone = body.players.find((row) => row.id === 'p3');
  assert.ok(gone, 'GET /api/players would not have them, and the log still has to draw them');
  assert.equal(gone.name, 'Gone');
  assert.equal(gone.avatar, 'owl');
  assert.equal(gone.retired, true);
});

test('config that does not parse is null rather than an exception', async () => {
  const e = env({
    plays: [play('a', 1000, { config_json: '{this is not json' })],
    results: [result('a', 'p1', { detail_json: 'nor is this' })],
  });
  const cookie = await knock(e);

  const { response, body } = await plays(e, cookie);
  assert.equal(response.status, 200, 'a row written by a version that is gone is still a row');
  assert.equal(body.plays[0].config, null);
  assert.equal(body.plays[0].results[0].detail, null);
});

test('the compound cursor keeps two plays that share a millisecond', async () => {
  // Same start, two rows: a bare timestamp cursor drops one of them silently.
  const e = env({ plays: [play('aaa', 5000), play('bbb', 5000), play('ccc', 4000)] });
  const cookie = await knock(e);

  const first = await plays(e, cookie, '?limit=2');
  assert.deepEqual(first.body.plays.map((row) => row.id), ['bbb', 'aaa']);
  assert.equal(first.body.next, '5000.aaa');

  const second = await plays(e, cookie, `?limit=2&before=${encodeURIComponent(first.body.next)}`);
  assert.deepEqual(second.body.plays.map((row) => row.id), ['ccc'], 'the other row at 5000 is not skipped');
  assert.equal(second.body.next, null);
});

test('paging walks the whole log and stops', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => play(`p${i}`, 1000 + i * 10));
  const e = env({ plays: rows });
  const cookie = await knock(e);

  const seen = [];
  let before = null;
  for (let page = 0; page < 10; page += 1) {
    const { body } = await plays(e, cookie, `?limit=3${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    seen.push(...body.plays.map((row) => row.id));
    before = body.next;
    if (!before) break;
  }

  assert.equal(before, null);
  assert.deepEqual(seen, ['p6', 'p5', 'p4', 'p3', 'p2', 'p1', 'p0']);
  assert.equal(new Set(seen).size, 7, 'nothing is served twice');
});

test('limit is clamped rather than obeyed, and nonsense falls back to the default', async () => {
  const rows = Array.from({ length: 40 }, (_, i) => play(`p${i}`, 1000 + i));
  const e = env({ plays: rows });
  const cookie = await knock(e);

  const capped = await plays(e, cookie, '?limit=9000');
  assert.equal(capped.body.plays.length, 40, 'the cap is 500, and there are only 40 rows');

  const silly = await plays(e, cookie, '?limit=not-a-number');
  assert.equal(silly.body.plays.length, 30, 'the default is a screenful and a bit');

  const zero = await plays(e, cookie, '?limit=0');
  assert.equal(zero.body.plays.length, 30);
});

test('a game filters, and a game nobody has heard of is an empty page', async () => {
  const e = env({
    plays: [play('a', 1000), play('b', 2000, { game: 'sudoku', mode: 'solo' })],
    results: [result('a', 'p1')],
  });
  const cookie = await knock(e);

  const pit = await plays(e, cookie, '?game=pit');
  assert.deepEqual(pit.body.plays.map((row) => row.id), ['a']);

  // Not a 404: a game dropped from games.js still has rows, and one that never
  // existed is the same shape of answer.
  const nothing = await plays(e, cookie, '?game=hopscotch');
  assert.equal(nothing.response.status, 200);
  assert.deepEqual(nothing.body.plays, []);
  assert.deepEqual(nothing.body.players, []);
  assert.equal(nothing.body.next, null);

  const shouting = await plays(e, cookie, '?game=PIT');
  assert.equal(shouting.response.status, 400);
  assert.equal(shouting.body.field, 'game');
});

test('the tile counts plays, finishes, and each player without ordering them', async () => {
  const e = env({
    plays: [play('a', 1000), play('b', 2000), play('c', 3000), play('d', 4000, { ended_at: null })],
    results: [
      result('a', 'p1'),
      result('b', 'p1', { outcome: 'lost' }),
      result('c', 'p2', { outcome: 'solved' }),
    ],
  });
  const cookie = await knock(e);

  const { response, body } = await stats(e, cookie);
  assert.equal(response.status, 200);
  assert.equal(body.plays, 4);
  // Finishing is leaving a result behind, not having an ended_at: 'd' is open
  // and 'a', 'b' and 'c' are the three that left one.
  assert.equal(body.finished, 3);

  const eleven = body.players.find((row) => row.id === 'p1');
  assert.deepEqual(eleven, { id: 'p1', played: 2, won: 1 });
  const twelve = body.players.find((row) => row.id === 'p2');
  assert.deepEqual(twelve, { id: 'p2', played: 1, won: 1 }, 'solved is a win, and the Worker imports the set');
});

test('the tile hands back timestamps, never days', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => play(`p${i}`, 1000 + i * 10));
  const e = env({ plays: rows });
  const cookie = await knock(e);

  const { body } = await stats(e, cookie);
  assert.deepEqual(body.starts, [1040, 1030, 1020, 1010, 1000], 'newest first, and nothing is grouped');
  assert.equal(body.starts_truncated, false);
  assert.ok(!('days' in body), 'a UTC Worker filing an evening under tomorrow is the bug this avoids');
});

test('a record longer than the streak window says so', async () => {
  const rows = Array.from({ length: 450 }, (_, i) => play(`p${i}`, 1000 + i));
  const e = env({ plays: rows });
  const cookie = await knock(e);

  const { body } = await stats(e, cookie);
  assert.equal(body.starts.length, 400, 'the window is 400, about 3KB on the wire');
  assert.equal(body.starts_truncated, true, 'so the tile can say 400+ rather than a number that is wrong');
  assert.equal(body.plays, 450);
});

test('an empty record is an empty answer rather than an error', async () => {
  const e = env();
  const cookie = await knock(e);

  const log = await plays(e, cookie);
  assert.deepEqual(log.body, { plays: [], players: [], next: null });

  const tile = await stats(e, cookie);
  assert.deepEqual(tile.body, { plays: 0, finished: 0, players: [], starts: [], starts_truncated: false });
});
