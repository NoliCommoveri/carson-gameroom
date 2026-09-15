// The client half of identity and the record: eight calls, and one rule about
// what happens when the gate says no.
//
// The shell is a static file and cannot be gated (worker/index.js says why), so
// the first thing any hub screen does is ask for data and find out. A 401 here
// is not an error to render — it is a navigation to /gate, carrying where we
// were so the gate can put us back.
//
// The two writing calls are the exception, and pass `{ gate: false }`. Every
// other call is made by a screen with nothing to show without it, where going to
// the gate is the right answer. Those two are made by a screen with a game
// running on it, and a cookie that expired mid-session must not throw away the
// round in progress — the 401 comes back as an ApiError for the game to say
// something about instead.
//
// Reading the record is not one of them: `getPlays` and `getStats` are asked
// for by the shelf, which has nothing to show behind an expired cookie either.
//
// Nothing in here touches the DOM, and nothing outside it calls fetch.

/**
 * Thrown for anything the caller has to show a person.
 *
 * `field` is set when the server refused one field of a form rather than the
 * whole request — the editor puts the message beside that field, which is the
 * difference between "that did not work" and "somebody already has that face".
 */
export class ApiError extends Error {
  /** @param {string} message @param {number} status @param {string | null} [field] */
  constructor(message, status, field = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

/** Where the gate should send us back to. */
function here() {
  return location.pathname + location.search;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {{ gate?: boolean }} [options] `gate: false` reports a 401 rather than
 *   navigating to it, which is what a screen mid-game needs
 * @returns {Promise<any>}
 */
async function call(path, init, { gate = true } = {}) {
  let response;
  try {
    response = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init && init.headers) } });
  } catch {
    // Offline, or the deploy is mid-flight. Both look the same from here and
    // both are worth saying out loud rather than showing an empty shelf.
    throw new ApiError('No answer from the gameroom. Check the wifi and try again.', 0);
  }

  if (response.status === 401) {
    if (!gate) throw new ApiError('The gameroom wants the passphrase again.', 401);
    location.replace(`/gate?next=${encodeURIComponent(here())}`);
    // The navigation is asynchronous; nothing after this should render.
    throw new ApiError('Going to the gate…', 401);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = body && (body.detail || body.error);
    throw new ApiError(
      detail ? String(detail) : `That did not work (${response.status}).`,
      response.status,
      body && typeof body.field === 'string' ? body.field : null,
    );
  }
  return body;
}

/**
 * @typedef {{ id: string, name: string, avatar: string }} Player
 */

/**
 * Every live profile and which one this device is.
 *
 * One call rather than two: the shelf needs both to draw anything, and `me`
 * comes from an HttpOnly cookie the page cannot read for itself.
 *
 * @returns {Promise<{ players: Player[], me: string | null }>}
 */
export function getPlayers() {
  return call('/api/players');
}

/**
 * Remember, or forget, who is playing on this device.
 *
 * @param {string | null} id null clears it, which is what a shared tablet wants
 * @returns {Promise<{ me: string | null }>}
 */
export function setWho(id) {
  return call('/api/who', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

/**
 * Make a new profile.
 *
 * `me` comes back because creating one on a device that had nobody picks it —
 * the server decides that, not this call, since only it can read the `who`
 * cookie (worker/api.js).
 *
 * @param {{ name: string, avatar: string }} profile
 * @returns {Promise<{ player: Player, me: string | null }>}
 */
export function createPlayer(profile) {
  return call('/api/players', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  });
}

/**
 * Change a screen name, a face, or both. What is left out keeps its current
 * value.
 *
 * @param {string} id
 * @param {{ name?: string, avatar?: string }} changes
 * @returns {Promise<{ player: Player }>}
 */
export function updatePlayer(id, changes) {
  return call(`/api/players/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  });
}

/**
 * Open a row for a game that has just been dealt.
 *
 * The id and the timestamp are the Worker's, not this call's: a client that
 * chose its own id could overwrite somebody else's row, and a client that sent
 * its own clock would put a kid's phone time in the play log
 * (docs/identity-and-stats.md §4.1).
 *
 * `config` is what the game needs to describe itself a year later — for Pit, the
 * table as it was dealt. It is capped at 4KB by the Worker.
 *
 * @param {{ game: string, mode: string, config?: unknown }} play
 * @returns {Promise<{ id: string, started_at: number }>}
 */
export function startPlay(play) {
  return call('/api/plays', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(play),
  }, { gate: false });
}

/**
 * Close it. `result: null` is a game nobody finished, which is a row worth
 * having rather than a row to leave open.
 *
 * The result's author is the `who` cookie's player and nothing this call sends
 * can change that, which is the whole reason the cookie is signed.
 *
 * @param {string} id
 * @param {{ rank?: number | null, outcome: string, value?: number | null,
 *           unit?: string | null, detail?: unknown } | null} result
 * @returns {Promise<{ ok: true }>}
 */
export function endPlay(id, result) {
  return call(`/api/plays/${encodeURIComponent(id)}/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ result }),
  }, { gate: false });
}

/**
 * @typedef {{ player_id: string, rank: number | null, outcome: string,
 *   value: number | null, unit: string | null, detail: unknown }} PlayResult
 * @typedef {{ id: string, game: string, mode: string, config: unknown,
 *   started_at: number, ended_at: number | null, results: PlayResult[] }} Play
 * @typedef {Player & { retired: boolean }} RecordPlayer
 */

/**
 * A page of the log, newest first.
 *
 * The players it names come back with it rather than from `getPlayers`, because
 * a result outlives the profile that wrote it: a retired player still has rows,
 * and drawing them needs the name and face that are no longer in the live list
 * (docs/identity-and-stats.md §3).
 *
 * `next` is the cursor for the page behind this one, or null at the end of the
 * record. It is opaque — pass it back as `before` and do not read it.
 *
 * @param {{ game?: string, limit?: number, before?: string | null }} [query]
 * @returns {Promise<{ plays: Play[], players: RecordPlayer[], next: string | null }>}
 */
export function getPlays({ game, limit, before } = {}) {
  const params = new URLSearchParams();
  if (game) params.set('game', game);
  if (limit) params.set('limit', String(limit));
  if (before) params.set('before', before);
  const query = params.toString();
  return call(`/api/plays${query ? `?${query}` : ''}`);
}

/**
 * The numbers on the tile: what the family has played, and what each player has.
 *
 * `starts` is raw timestamps and nothing here is grouped by day — the Worker is
 * in UTC and a day is the phone's day. public/shared/record.js does the cutting.
 *
 * @returns {Promise<{ plays: number, finished: number,
 *   players: { id: string, played: number, won: number }[],
 *   starts: number[], starts_truncated: boolean }>}
 */
export function getStats() {
  return call('/api/stats');
}
