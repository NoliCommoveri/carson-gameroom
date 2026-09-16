// The site's own endpoints. Everything here is about who you are.
//
//   GET   /api/players       every live profile, and which one this device is
//   POST  /api/players       create one
//   PATCH /api/players/:id   rename one, or change its face
//   POST  /api/who           pick a profile on this device, or clear it
//   POST  /api/plays         open a row when a game is dealt
//   POST  /api/plays/:id/end close it, with a result or without one
//
// Reading the record — GET /api/plays and GET /api/stats — is worker/record.js,
// routed from here. This file is about who you are; that one is about what
// happened, and they share the gate and the shape of a refusal.
//
// Everything is behind the gate, and `who` is only ever set from a signed
// cookie this Worker issued. That is the difference between "the client says it
// is player 3" and "the server issued this", and it is what stops a stray
// script writing a play result as somebody else: the `player_id` on a result
// comes from that cookie and never from the body
// (docs/identity-and-stats.md §3.3).
//
// **There are no locks inside the gate.** Anybody through the door can edit
// anybody's profile, deliberately: this is a family of six who share devices,
// and an adult fixing a 4-year-old's name from their own phone is the case that
// actually happens (docs/identity-and-stats.md §1). The deterrent against a
// sibling renaming their brother is the same one that works at a physical board
// game.
//
// The record is game-agnostic and stays that way: `game` and `mode` are slugs
// and are not checked against a list, because public/shared/games.js is the
// only place a game is named to the hub (H2). A Worker holding a second list
// would be a third game that touches two files instead of one.
//
// The rules a name and a face have to pass live in public/shared/profile.js, so
// the editor can say "somebody already has that face" without a round trip and
// this file can decide it again without trusting that it did.

import { WHO_COOKIE, COOKIE_MAX_AGE, cookieHeader, readCookie, sign, verify } from './auth.js';
import { throughGate } from './gate.js';
import { listPlays, readStats } from './record.js';
import { normaliseName, profileProblem } from '../public/shared/profile.js';

/** @param {unknown} body @param {number} [status] @param {Record<string,string>} [headers] */
function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/**
 * @typedef {{ id: string, name: string, avatar: string }} Player
 */

/**
 * Live profiles, in a fixed order.
 *
 * Order is not cosmetic: the shelf does not reorder itself, because position is
 * how a pre-reader finds their own face (docs/design-language.md §2). Creation
 * order is the one order that never changes under them, and `id` breaks the tie
 * when a seed inserts six rows in the same millisecond. A profile created today
 * joins the end of the strip and stays there.
 *
 * @param {D1Database} db
 * @returns {Promise<Player[]>}
 */
async function livePlayers(db) {
  const { results } = await db
    .prepare(
      `SELECT id, screen_name, avatar FROM players
        WHERE retired_at IS NULL
        ORDER BY created_at, id`,
    )
    .all();
  return results.map((row) => ({
    id: String(row.id),
    name: String(row.screen_name),
    avatar: String(row.avatar),
  }));
}

/**
 * The player id in the `who` cookie, if it verifies and still names a live
 * player. A retired or deleted player reads as nobody rather than as an error:
 * the picker is the answer to both.
 *
 * @param {Request} request
 * @param {{ SESSION_SECRET?: string }} env
 * @param {Player[]} players
 * @returns {Promise<string | null>}
 */
async function currentWho(request, env, players) {
  const cookie = readCookie(request.headers.get('cookie'), WHO_COOKIE);
  const payload = await verify(env.SESSION_SECRET, cookie, 'who');
  if (!payload || typeof payload.id !== 'string') return null;
  return players.some((player) => player.id === payload.id) ? payload.id : null;
}

/** The `who` cookie, signed. @param {string} secret @param {string} id */
function whoCookie(secret, id) {
  return sign(String(secret), { k: 'who', id, exp: Date.now() + COOKIE_MAX_AGE * 1000 });
}

/**
 * Whether a D1 error is the live-avatar index refusing a duplicate.
 *
 * The check for a taken face is made before the write and would normally catch
 * it, so this is the narrow window where two phones pick the fox in the same
 * second. The schema is what actually enforces the rule (`players_avatar_live`,
 * Session A); this only turns its message into the same sentence the editor
 * would have shown.
 *
 * @param {unknown} err
 */
function isAvatarClash(err) {
  const text = String((err && /** @type {Error} */ (err).message) || err);
  return /UNIQUE constraint failed/i.test(text) || /players_avatar_live/i.test(text);
}

/** @param {{ field: string, message: string }} problem */
function refuse(problem) {
  return json({ error: 'invalid', field: problem.field, detail: problem.message }, 400);
}

/** Reads a JSON body, or null if there is not one. @param {Request} request */
async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : null;
  } catch {
    return null;
  }
}

/**
 * Every /api/* request. The gate is checked here rather than in index.js so
 * that a refusal is JSON: a fetch that gets an HTML page back fails at
 * `res.json()` with an error naming the wrong problem, and the client needs to
 * be told to go to the gate rather than to guess.
 *
 * @param {Request} request
 * @param {{ DB?: D1Database, SESSION_SECRET?: string, FAMILY_PASSPHRASE?: string }} env
 * @param {string} pathname
 * @returns {Promise<Response>}
 */
export async function handleApi(request, env, pathname) {
  if (!(await throughGate(request, env))) {
    return json({ error: 'gate', gate: '/gate' }, 401);
  }
  if (!env.DB) {
    return json({ error: 'no_database', detail: 'The Worker has no DB binding. See docs/architecture.md §8, task A2.' }, 503);
  }

  if (pathname === '/api/players') {
    if (request.method === 'GET') {
      const players = await livePlayers(env.DB);
      return json({ players, me: await currentWho(request, env, players) });
    }
    if (request.method === 'POST') return createPlayer(request, env, env.DB);
    return json({ error: 'method' }, 405, { allow: 'GET, POST' });
  }

  if (pathname.startsWith('/api/players/')) {
    const id = decodeURIComponent(pathname.slice('/api/players/'.length));
    if (request.method !== 'PATCH') return json({ error: 'method' }, 405, { allow: 'PATCH' });
    return editPlayer(request, env.DB, id);
  }

  if (pathname === '/api/plays') {
    if (request.method === 'GET') return listPlays(request, env.DB);
    if (request.method === 'POST') return startPlay(request, env.DB);
    return json({ error: 'method' }, 405, { allow: 'GET, POST' });
  }

  if (pathname === '/api/stats') {
    if (request.method !== 'GET') return json({ error: 'method' }, 405, { allow: 'GET' });
    return readStats(env.DB);
  }

  if (pathname.startsWith('/api/plays/') && pathname.endsWith('/end')) {
    const id = decodeURIComponent(pathname.slice('/api/plays/'.length, -'/end'.length));
    if (request.method !== 'POST') return json({ error: 'method' }, 405, { allow: 'POST' });
    return endPlay(request, env, env.DB, id);
  }

  if (pathname === '/api/who') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405, { allow: 'POST' });
    return pickWho(request, env, env.DB);
  }

  return json({ error: 'not_found', path: pathname }, 404);
}

/**
 * Creating a profile.
 *
 * **It picks the new player only if this device had nobody.** That is the
 * common case — somebody new sitting down at a phone that has just been cleared
 * — and it saves them hunting for the face they made a second ago. A parent
 * making a profile for a child from their own phone is the other case, and
 * there the device stays as the parent: creating a profile is not the same
 * thing as becoming one.
 *
 * @param {Request} request
 * @param {{ SESSION_SECRET?: string }} env
 * @param {D1Database} db
 */
async function createPlayer(request, env, db) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_body' }, 400);

  const before = await livePlayers(db);
  const proposal = { name: normaliseName(body.name), avatar: String(body.avatar || '') };

  const problem = profileProblem(proposal, before);
  if (problem) return refuse(problem);

  const player = { id: crypto.randomUUID(), ...proposal };
  try {
    await db
      .prepare('INSERT INTO players (id, screen_name, avatar, created_at) VALUES (?, ?, ?, ?)')
      .bind(player.id, player.name, player.avatar, Date.now())
      .run();
  } catch (err) {
    if (isAvatarClash(err)) {
      return refuse({ field: 'avatar', message: 'Somebody already has that face. Pick another one.' });
    }
    throw err;
  }

  const players = [...before, player];
  const me = await currentWho(request, env, players);
  if (me !== null) return json({ player, me }, 201);

  return json({ player, me: player.id }, 201, {
    'set-cookie': cookieHeader(WHO_COOKIE, await whoCookie(String(env.SESSION_SECRET), player.id)),
  });
}

/**
 * Changing a screen name or a face.
 *
 * Both fields are optional and what is missing keeps its current value, so the
 * editor can post a name without knowing which avatar is on the row. What it
 * may never change is `id`: that is the whole point of splitting it from the
 * name, and it is why a rename does not touch a single play result
 * (docs/identity-and-stats.md §3).
 *
 * @param {Request} request
 * @param {D1Database} db
 * @param {string} id
 */
async function editPlayer(request, db, id) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_body' }, 400);

  const players = await livePlayers(db);
  const current = players.find((player) => player.id === id);
  if (!current) return json({ error: 'no_such_player', id }, 404);

  const proposal = {
    name: body.name === undefined ? current.name : normaliseName(body.name),
    avatar: body.avatar === undefined ? current.avatar : String(body.avatar || ''),
  };

  // Everybody but the player being edited: keeping your own name and your own
  // face has to stay legal, or saving a changed name would refuse the face you
  // arrived with.
  const others = players.filter((player) => player.id !== id);
  const problem = profileProblem(proposal, others);
  if (problem) return refuse(problem);

  try {
    await db
      .prepare('UPDATE players SET screen_name = ?, avatar = ? WHERE id = ? AND retired_at IS NULL')
      .bind(proposal.name, proposal.avatar, id)
      .run();
  } catch (err) {
    if (isAvatarClash(err)) {
      return refuse({ field: 'avatar', message: 'Somebody already has that face. Pick another one.' });
    }
    throw err;
  }

  return json({ player: { id, ...proposal } });
}

/**
 * Picking who you are on this device, and unpicking.
 *
 * `{"id": null}` clears the cookie, which is the shared tablet's answer: the
 * next person gets the picker instead of somebody else's face. There is no
 * confirmation on either direction and no password, deliberately — switching is
 * one tap from the header and always will be.
 *
 * @param {Request} request
 * @param {{ SESSION_SECRET?: string }} env
 * @param {D1Database} db
 */
async function pickWho(request, env, db) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_body' }, 400);
  const id = body.id === null ? null : String(body.id || '');

  if (id === null) {
    return json({ me: null }, 200, { 'set-cookie': cookieHeader(WHO_COOKIE, '', 0) });
  }

  const players = await livePlayers(db);
  if (!players.some((player) => player.id === id)) {
    return json({ error: 'no_such_player', id }, 404);
  }

  return json({ me: id }, 200, {
    'set-cookie': cookieHeader(WHO_COOKIE, await whoCookie(String(env.SESSION_SECRET), id)),
  });
}

/* ------------------------------------------------------------- the record */

/** A game slug or a mode slug. Short, lowercase, and safe in a URL and a query. */
const SLUG = /^[a-z][a-z0-9-]{0,31}$/;

/** What a game may say about itself, and what it may say about how it went. */
const CONFIG_MAX = 4096;
const DETAIL_MAX = 2048;

/**
 * Opening a row when the cards are dealt.
 *
 *   { game, mode, config } -> { id, started_at }
 *
 * **The Worker chooses the id and the clock.** A client-supplied id is a client
 * that can overwrite somebody else's row, and a client-supplied timestamp is a
 * kid's phone clock in the play log. Both are ignored if a body carries them.
 *
 * `session_id` stays null: a Pit session is one play, not one play per round. A
 * round is twenty seconds, and a row per round would bury the log in a game the
 * family plays for an hour.
 *
 * Nothing here checks that a game finished, or that it was ever played. A row
 * with a `started_at` and no `ended_at` is a phone that was locked mid-game, and
 * that is a true thing worth being able to see (docs/identity-and-stats.md §4.1).
 *
 * @param {Request} request
 * @param {D1Database} db
 */
async function startPlay(request, db) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_body' }, 400);

  const game = String(body.game ?? '');
  const mode = String(body.mode ?? '');
  if (!SLUG.test(game)) return refuse({ field: 'game', message: 'A game is a short lowercase name, like "pit".' });
  if (!SLUG.test(mode)) return refuse({ field: 'mode', message: 'A mode is a short lowercase name, like "bots".' });

  let configJson = null;
  if (body.config !== undefined && body.config !== null) {
    configJson = JSON.stringify(body.config);
    if (configJson.length > CONFIG_MAX) {
      return refuse({ field: 'config', message: `That is more than ${CONFIG_MAX} characters of config.` });
    }
  }

  const play = { id: crypto.randomUUID(), started_at: Date.now() };
  await db
    .prepare('INSERT INTO plays (id, session_id, game, mode, config_json, started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(play.id, null, game, mode, configJson, play.started_at)
    .run();

  return json(play, 201);
}

/**
 * What a result has to be before it goes in a table Phase 3 has to render:
 * numbers that are numbers, slugs, and a detail that fits.
 *
 * Nothing checks that a score of 300 was earned. The deterrent against a
 * 12-year-old posting a fake result is that the family can see the log, which is
 * the same deterrent that works at a physical board game
 * (docs/identity-and-stats.md §4.1). What is enforced is authorship and shape.
 *
 * @param {Record<string, unknown>} result
 * @returns {{ field: string, message: string } | { row: { rank: number | null,
 *   outcome: string, value: number | null, unit: string | null, detail: string | null } }}
 */
function resultRow(result) {
  const outcome = String(result.outcome ?? '');
  if (!SLUG.test(outcome)) {
    return { field: 'outcome', message: 'An outcome is a short lowercase name, like "won".' };
  }

  const rank = result.rank === undefined || result.rank === null ? null : Number(result.rank);
  if (rank !== null && !Number.isInteger(rank)) {
    return { field: 'rank', message: 'A rank is a whole number.' };
  }

  const value = result.value === undefined || result.value === null ? null : Number(result.value);
  if (value !== null && !Number.isFinite(value)) {
    return { field: 'value', message: 'A value is a number.' };
  }

  const unit = result.unit === undefined || result.unit === null ? null : String(result.unit);
  if (unit !== null && !SLUG.test(unit)) {
    return { field: 'unit', message: 'A unit is a short lowercase name, like "points".' };
  }

  let detail = null;
  if (result.detail !== undefined && result.detail !== null) {
    detail = JSON.stringify(result.detail);
    if (detail.length > DETAIL_MAX) {
      return { field: 'detail', message: `That is more than ${DETAIL_MAX} characters of detail.` };
    }
  }

  return { row: { rank, outcome, value, unit, detail } };
}

/**
 * Closing the row, with a result or without one.
 *
 *   { result: { rank, outcome, value, unit, detail } | null } -> { ok: true }
 *
 * `result: null` is the abandon: the row gets an `ended_at` and no
 * `play_results` row, which is how "we started six and finished two" stays a
 * true sentence.
 *
 * **`player_id` comes from the `who` cookie, never from the body.** That is what
 * the signature on the cookie is for, and a device with nobody picked cannot
 * write a result at all.
 *
 * Both statements are idempotent and go in one `batch()`, because a phone on bad
 * wifi will retry: the update only fires while `ended_at` is null, and the
 * insert ignores a row that is already there. Ending twice leaves one row with
 * one `ended_at`.
 *
 * **Only the human's row is written.** `play_results.player_id` references
 * `players`, and a bot is not a player. The bots' scores travel in `detail_json`,
 * which is where the client puts them. Phase 7 is where several seats end one
 * play, and that is a loop over these same two statements.
 *
 * @param {Request} request
 * @param {{ SESSION_SECRET?: string }} env
 * @param {D1Database} db
 * @param {string} id
 */
async function endPlay(request, env, db, id) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_body' }, 400);

  const play = await db.prepare('SELECT id FROM plays WHERE id = ?').bind(id).first();
  if (!play) return json({ error: 'no_such_play', id }, 404);

  const statements = [
    db.prepare('UPDATE plays SET ended_at = ? WHERE id = ? AND ended_at IS NULL').bind(Date.now(), id),
  ];

  const result = body.result === undefined ? null : body.result;
  if (result !== null) {
    if (typeof result !== 'object') {
      return refuse({ field: 'result', message: 'A result is an object, or null for a game nobody finished.' });
    }

    const players = await livePlayers(db);
    const me = await currentWho(request, env, players);
    if (me === null) {
      return json(
        { error: 'nobody', detail: 'Nobody is picked on this device, so there is no one to write this down for.' },
        403,
      );
    }

    const checked = resultRow(/** @type {Record<string, unknown>} */ (result));
    if ('field' in checked) return refuse(checked);

    const { rank, outcome, value, unit, detail } = checked.row;
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO play_results (play_id, player_id, rank, outcome, value, unit, detail_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, me, rank, outcome, value, unit, detail),
    );
  }

  await db.batch(statements);
  return json({ ok: true });
}
