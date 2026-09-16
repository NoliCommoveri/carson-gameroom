// Reading the record.
//
//   GET /api/plays?game=&limit=&before=   the log, and everything drawn from it
//   GET /api/stats                        the numbers on the tile
//
// Both are behind the gate, because worker/api.js checks it before it routes
// here. Nothing in this file writes.
//
// It is split from api.js because api.js is about who you are and this is about
// what happened. They share the gate and four lines of `json()`, and the
// alternative is a 900-line file, which is the thing this repo has avoided
// everywhere else.
//
// **The Worker does not read what the games wrote.** `config_json` and
// `detail_json` are parsed and handed through uninterpreted: config is sudoku's
// size and tier and Pit's table as dealt, and a Worker that learned either
// would be a third game touching two files instead of one (H2). Text that does
// not parse comes back as null rather than throwing, because a row written by a
// version that is gone is still a row worth seeing in the log.
//
// **Nothing here groups by day.** The Worker runs in UTC and has no idea what
// the phones think midnight is. It hands back timestamps and
// public/shared/record.js cuts them where the browser's clock says.

import { WON } from '../public/shared/record.js';

/** @param {unknown} body @param {number} [status] @param {Record<string,string>} [headers] */
function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/** The same slug the write path uses, so a filter cannot name what cannot exist. */
const SLUG = /^[a-z][a-z0-9-]{0,31}$/;

/** A screenful and a bit on the phone; the cap is one page of a per-game view. */
const LIMIT_DEFAULT = 30;
const LIMIT_MAX = 500;

/** Longer than a year of playing every day, and about 3KB on the wire. */
const STARTS_MAX = 400;

/** JSON a game wrote, or null. A row from a version that is gone still shows. */
function parseOrNull(text) {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

/**
 * `<started_at>.<id>`, and the page is rows strictly older than it.
 *
 * Compound because two phones can open a play in the same millisecond, and a
 * bare timestamp cursor would silently drop one of them. A cursor that does not
 * parse is ignored rather than refused: it can only have come from a `next` this
 * Worker built, so a broken one is a bug here and a first page is a better
 * answer to it than a 400 on the front page.
 *
 * @param {string | null} before
 * @returns {{ at: number, id: string } | null}
 */
function readCursor(before) {
  if (!before) return null;
  const dot = before.indexOf('.');
  if (dot <= 0) return null;
  const at = Number(before.slice(0, dot));
  const id = before.slice(dot + 1);
  return Number.isInteger(at) && id ? { at, id } : null;
}

/** The cursor naming a row, for the client to ask for what is older. */
const cursorFor = (row) => `${row.started_at}.${row.id}`;

/**
 * The log.
 *
 * **Three statements, one batch(), never N+1.** The page; the results those
 * plays carry; the players those results name. Each one repeats the page as a
 * subquery so that all three can be issued together — a per-row query for
 * results would be thirty round trips to draw one screen.
 *
 * **`players` is part of the answer rather than a second call.** GET
 * /api/players returns live profiles only, and a result outlives the profile
 * that made it: `retired_at` is a soft delete precisely so results keep their
 * author (docs/identity-and-stats.md §3). So every player id this page mentions
 * comes back with the name and face to draw it, live or retired.
 *
 * @param {Request} request
 * @param {D1Database} db
 */
export async function listPlays(request, db) {
  const params = new URL(request.url).searchParams;

  const game = params.get('game');
  if (game !== null && !SLUG.test(game)) {
    return json({ error: 'invalid', field: 'game', detail: 'A game is a short lowercase name, like "pit".' }, 400);
  }

  const asked = Number(params.get('limit'));
  const limit = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), LIMIT_MAX) : LIMIT_DEFAULT;

  const cursor = readCursor(params.get('before'));

  const where = [];
  const binds = [];
  // An unknown game is an empty page rather than a 404: a game dropped from
  // games.js still has rows, and the record outliving the shelf is the point of
  // keeping it game-agnostic.
  if (game !== null) {
    where.push('game = ?');
    binds.push(game);
  }
  if (cursor) {
    where.push('(started_at < ? OR (started_at = ? AND id < ?))');
    binds.push(cursor.at, cursor.at, cursor.id);
  }
  binds.push(limit);

  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = 'ORDER BY started_at DESC, id DESC LIMIT ?';
  // What plays_recent and plays_by_game are indexed for.
  const page = `SELECT id FROM plays ${filter} ${order}`;

  const [pageRows, resultRows, playerRows] = await db.batch([
    db
      .prepare(`SELECT id, game, mode, config_json, started_at, ended_at FROM plays ${filter} ${order}`)
      .bind(...binds),
    db
      .prepare(
        `SELECT play_id, player_id, rank, outcome, value, unit, detail_json
           FROM play_results WHERE play_id IN (${page})
          ORDER BY rank, player_id`,
      )
      .bind(...binds),
    db
      .prepare(
        `SELECT id, screen_name, avatar, retired_at FROM players
          WHERE id IN (SELECT player_id FROM play_results WHERE play_id IN (${page}))`,
      )
      .bind(...binds),
  ]);

  /** @type {Map<string, object[]>} */
  const byPlay = new Map();
  for (const row of resultRows.results || []) {
    const list = byPlay.get(String(row.play_id)) || [];
    list.push({
      player_id: String(row.player_id),
      rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
      outcome: String(row.outcome),
      value: row.value === null || row.value === undefined ? null : Number(row.value),
      unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
      detail: parseOrNull(row.detail_json),
    });
    byPlay.set(String(row.play_id), list);
  }

  const rows = pageRows.results || [];
  const plays = rows.map((row) => ({
    id: String(row.id),
    game: String(row.game),
    mode: String(row.mode),
    config: parseOrNull(row.config_json),
    started_at: Number(row.started_at),
    ended_at: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at),
    results: byPlay.get(String(row.id)) || [],
  }));

  const players = (playerRows.results || []).map((row) => ({
    id: String(row.id),
    name: String(row.screen_name),
    avatar: String(row.avatar),
    retired: row.retired_at !== null && row.retired_at !== undefined,
  }));

  // A short page is the end of the log; a full one may or may not be, and one
  // wasted call saying so beats a `More` button that is missing when there is
  // more behind it.
  const next = rows.length === limit && rows.length > 0 ? cursorFor(rows[rows.length - 1]) : null;

  return json({ plays, players, next });
}

/**
 * The tile's numbers.
 *
 * **`finished` counts plays that left a result behind**, not plays with an
 * `ended_at`. "We started six and finished two" is the sentence the two-call
 * write path exists to make true (docs/identity-and-stats.md §4.1).
 *
 * **What counts as a win is folded here rather than in SQL.** `outcome` is an
 * unchecked slug on the way in, on purpose, and WON is the one place the
 * reading decides — putting the set in a `WHERE` clause would make the schema a
 * second list of game vocabulary.
 *
 * @param {D1Database} db
 */
export async function readStats(db) {
  const [playRows, finishedRows, outcomeRows, startRows] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM plays'),
    db.prepare('SELECT COUNT(DISTINCT play_id) AS n FROM play_results'),
    db.prepare('SELECT player_id, outcome, COUNT(*) AS n FROM play_results GROUP BY player_id, outcome'),
    // One more than the window, which is how truncation is noticed without a
    // second count over the whole table.
    db.prepare('SELECT started_at FROM plays ORDER BY started_at DESC LIMIT ?').bind(STARTS_MAX + 1),
  ]);

  const count = (rows) => Number((rows.results && rows.results[0] && rows.results[0].n) || 0);

  /** @type {Map<string, { id: string, played: number, won: number }>} */
  const players = new Map();
  for (const row of outcomeRows.results || []) {
    const id = String(row.player_id);
    const entry = players.get(id) || { id, played: 0, won: 0 };
    const n = Number(row.n) || 0;
    entry.played += n;
    if (WON.has(String(row.outcome))) entry.won += n;
    players.set(id, entry);
  }

  const starts = (startRows.results || []).map((row) => Number(row.started_at));

  return json({
    plays: count(playRows),
    finished: count(finishedRows),
    players: [...players.values()],
    starts: starts.slice(0, STARTS_MAX),
    // The streak then reads as a floor — "400+ days" — rather than as a lie.
    starts_truncated: starts.length > STARTS_MAX,
  });
}
