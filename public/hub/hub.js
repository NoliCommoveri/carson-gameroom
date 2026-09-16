// The hub: the picker, the shelf, the editor, and the switches between them.
//
// Three screens, one page:
//
//   picker   nobody is chosen on this device yet, or somebody tapped to switch.
//            Every live profile as a big face, plus the tile that makes a new
//            one. Tap yours.
//   shelf    the games, the record's log under them, and the family strip
//            along the bottom.
//   editor   a name and thirty faces. Both ways in are on the picker — the
//            new-player tile, and the button that changes the profile you are
//            already on. That is where they belong: the picker is the screen
//            whose subject is who you are, and the shelf's bar has room for one
//            control rather than two (docs/design-language.md §3, which keeps
//            the front page down to the games and the faces).
//
// The picker comes first on a device that has never been used, because a play
// needs a player and asking once is cheaper than asking on the way into every
// game. After that the shelf is what opens, which is the whole point of the
// `who` cookie: the 12-year-old's phone opens straight to them and the shared
// tablet is cleared back to the picker with the Nobody tile.
//
// The log and the tile arrive after the shelf has already been drawn. The front
// page's job is getting a 5-year-old into a game, so a stats query that is slow
// or broken may not stand between them and the tiles: the shelf renders from
// /api/players alone and the record fills in under it, or says one sentence
// where it would have been.
//
// Rendering is innerHTML into one container. There is nothing here worth a
// framework, no dependency is allowed, and every screen redraws whole — the
// most this page ever holds is thirty faces and a handful of tiles. The one
// thing that survives a redraw is what has been typed into the editor's name
// field, which is why it is read into state on the way past rather than out of
// the DOM at save time.

import { AVATARS, avatarSvg, avatarTint } from '../shared/avatars.js';
import { GAMES } from '../shared/games.js';
import { NAME_MAX, normaliseName, profileProblem, takenAvatars } from '../shared/profile.js';
import { ApiError, createPlayer, getPlayers, getPlays, getStats, setWho, updatePlayer } from '../shared/api.js';
import { SHAPED, byDay, finished, formatValue, recent, streak } from '../shared/record.js';

const root = /** @type {HTMLElement} */ (document.getElementById('app'));

/**
 * @typedef {{
 *   id: string | null,
 *   name: string,
 *   avatar: string,
 *   problem: { field: string, message: string } | null,
 *   busy: boolean,
 * }} Editing an open editor; `id` is null when the profile does not exist yet
 */

/**
 * @typedef {{
 *   plays: import('../shared/api.js').Play[],
 *   faces: Map<string, { name: string, avatar: string, retired: boolean }>,
 *   failed: boolean,
 *   loaded: boolean,
 * }} Record the log, and who it names
 */

/**
 * @type {{
 *   players: import('../shared/api.js').Player[],
 *   me: string | null,
 *   switching: boolean,
 *   editing: Editing | null,
 *   record: Record,
 *   stats: { plays: number, finished: number, players: { id: string, played: number, won: number }[],
 *            starts: number[], starts_truncated: boolean } | null,
 * }}
 */
const state = {
  players: [],
  me: null,
  switching: false,
  editing: null,
  record: { plays: [], faces: new Map(), failed: false, loaded: false },
  stats: null,
};

/** @param {string} text */
const esc = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * A face on its disc, tinted to match the glyph. The tint is set on the tile
 * rather than inside the SVG so the disc behind it can mix with it.
 *
 * @param {string} avatarKey
 */
const face = (avatarKey) =>
  `<span class="disc" style="color:${avatarTint(avatarKey)}">${avatarSvg(avatarKey)}</span>`;

/**
 * One player, as a button. The same markup in the picker and in the strip; the
 * two sizes are CSS.
 *
 * `aria-pressed` carries "this is you" to a screen reader and draws the ring in
 * CSS, which is one attribute doing both jobs.
 *
 * @param {import('../shared/api.js').Player} player
 * @param {boolean} isMe
 */
function playerTile(player, isMe) {
  return `<button class="who" type="button" data-id="${esc(player.id)}" aria-pressed="${isMe}">
    ${face(player.avatar)}
    <span>${esc(player.name)}</span>
  </button>`;
}

/** @param {import('../shared/games.js').Game} game */
function gameTile(game) {
  return `<a class="game" href="${game.href}" style="--tile:${game.accent}">
    ${game.art}
    <div>
      <h2>${esc(game.title)}</h2>
      <p>${esc(game.blurb)}</p>
    </div>
  </a>`;
}

/**
 * The picker. `switching` is the difference between the first screen a device
 * ever shows and the one reached from the bar: only the second offers Nobody,
 * because clearing a device that has nobody on it is a button that does
 * nothing.
 *
 * The new-player tile is the same shape as a face, at the end of the row where
 * the next face would go. A plus on a disc is the one glyph a pre-reader can be
 * expected to already know, and putting it in the grid rather than in a toolbar
 * keeps it above the 64px floor without a second layout.
 */
function picker() {
  const tiles = state.players.map((player) => `<li>${playerTile(player, player.id === state.me)}</li>`);

  const nobody = state.switching
    ? `<li><button class="who nobody" type="button" data-id="" aria-pressed="false">
        <span class="disc">${avatarSvg('__none__')}</span>
        <span>Nobody</span>
      </button></li>`
    : '';

  const add = `<li><button class="who add" type="button" id="new-player">
      <span class="disc"><svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path d="M24 13v22M13 24h22" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
      </svg></span>
      <span>New player</span>
    </button></li>`;

  const heading = state.players.length === 0
    ? `<h1 class="ask">Nobody lives here yet</h1>
      <p class="note">Make the first profile, or press <strong>Run seed</strong> on
      <code>/admin</code> and everybody appears at once.</p>`
    : `<h1 class="ask">${state.switching ? 'Who is playing now?' : 'Who is playing?'}</h1>`;

  const change = state.players.some((player) => player.id === state.me)
    ? `<div class="row wide">
        <button class="btn" type="button" id="edit-me">
          <svg class="pencil" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path d="M30 8l10 10-20 20-12 2 2-12z" fill="none" stroke="currentColor"
                  stroke-width="4" stroke-linejoin="round"/>
            <path d="M27 11l10 10" fill="none" stroke="currentColor" stroke-width="4"/>
          </svg>
          Change my name or face
        </button>
      </div>`
    : '';

  return `${heading}
  <ul class="picker">${tiles.join('')}${nobody}${add}</ul>
  ${change}`;
}

/* ---- the record, on the shelf ------------------------------------------ */

/** A game's mark, at 32px in its own accent, or a neutral one for a game that
 *  has left the shelf. The record outlives games.js on purpose, and a row for a
 *  game nobody can start any more is still a row.
 *
 *  @param {string} key */
function logArt(key) {
  const game = GAMES.find((entry) => entry.key === key);
  if (game) return `<span class="log-art" style="--tile:${game.accent}" title="${esc(game.title)}">${game.art}</span>`;
  return `<span class="log-art gone" title="${esc(key)}"><svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <rect x="8" y="8" width="48" height="48" rx="10" fill="none" stroke="currentColor" stroke-width="5"/>
  </svg></span>`;
}

/**
 * Who a result belongs to. The record carries its own player list because a
 * retired profile is not in the live one, and their rows keep their author.
 *
 * @param {string} id
 */
function logFace(id) {
  const player = state.record.faces.get(id);
  if (!player) return '';
  return `<span class="log-player${player.retired ? ' retired' : ''}">
    ${face(player.avatar)}
    <span>${esc(player.name)}</span>
  </span>`;
}

/**
 * What one play came to.
 *
 * The value is formatted by its unit and the unit's word follows it unless the
 * shape already says it — `6:52` needs no caption, `310` needs `points`. Rank 1
 * gets a pip and there is no ranking beyond that, and no detail: `detail_json`
 * is the per-game views' (Session C).
 *
 * @param {import('../shared/api.js').Play} play
 */
function logOutcome(play) {
  if (!finished(play)) return '<span class="log-none">didn\'t finish</span>';

  return play.results
    .map((result) => {
      const shown = formatValue(result.value, result.unit);
      const said = shown && result.unit && !SHAPED.has(result.unit) ? `${shown} ${result.unit}` : shown;
      const pip = result.rank === 1 ? '<span class="pip" title="First">\u2460</span>' : '';
      return `<span class="log-value">${esc(said || result.outcome)}${pip}</span>`;
    })
    .join('');
}

/**
 * One row: the game's art, the faces, and the outcome.
 *
 * A pre-reader reads the row by shape and colour before anybody reads a word
 * (docs/design-language.md §2), and a face always carries its name — the log is
 * the one screen where an avatar alone is not enough, because a retired player
 * has released their face to somebody live.
 *
 * **An unfinished row has no faces**, because a play that left no result left
 * no player id either. The art and the sentence are what there is, and they are
 * what the row is for: "we started six and finished two" is the sentence the
 * two-call write path exists to make true, so these are dimmed rather than
 * hidden.
 *
 * @param {import('../shared/api.js').Play} play
 */
function logRow(play) {
  const faces = play.results.map((result) => logFace(result.player_id)).join('');
  return `<li class="play${finished(play) ? '' : ' unfinished'}">
    ${logArt(play.game)}
    <span class="log-who">${faces}</span>
    <span class="log-out">${logOutcome(play)}</span>
  </li>`;
}

/**
 * The tile: what the family has played, and what you have.
 *
 * `you:` is there only when this device has somebody picked, and it names
 * nobody else. The front page never puts the six of you in order
 * (docs/identity-and-stats.md §4.3).
 */
function recordTile() {
  const stats = state.stats;
  if (!stats) return '';

  const run = streak(stats.starts, Date.now());
  const capped = stats.starts_truncated && run === stats.starts.length;
  const parts = [`${stats.plays} game${stats.plays === 1 ? '' : 's'}`];
  if (run > 0) parts.push(`${capped ? `${run}+` : run} day${run === 1 ? '' : 's'} in a row`);

  const mine = state.me ? stats.players.find((player) => player.id === state.me) : null;
  const yours = mine
    ? `<span class="yours">you: ${mine.played} game${mine.played === 1 ? '' : 's'}, ${mine.won} win${mine.won === 1 ? '' : 's'}</span>`
    : '';

  return `<p class="tile"><span>${esc(parts.join(' \u00b7 '))}</span>${yours}</p>`;
}

/**
 * The log: today and yesterday, and nothing older.
 *
 * There is no `More`. The front page answers *what are we playing*, which is a
 * question about this evening and last — a list that keeps going is a feed, and
 * everything under the fold on a 360px phone is below the family strip. The rest
 * of the record is still there and still paged by /api/plays; it is read inside
 * each game rather than here (Session C).
 */
function recordLog() {
  const { plays, failed, loaded } = state.record;

  if (failed) return '<p class="note">The log is not answering right now. The games still work.</p>';
  if (!loaded) return '<p class="note">Looking up what we played…</p>';

  const days = byDay(recent(plays, Date.now()), Date.now());
  if (days.length === 0) {
    // "Nothing yet" and "nothing lately" are different sentences, and the tile
    // already knows which one this is.
    return state.stats && state.stats.plays > 0
      ? '<p class="note">Nothing today or yesterday. Start something.</p>'
      : '<p class="note">Nothing here yet. Play something and it appears.</p>';
  }

  return days
    .map(
      (day) => `<h3 class="log-day">${esc(day.label)}</h3>
      <ul class="log">${day.plays.map(logRow).join('')}</ul>`,
    )
    .join('');
}

/** The shelf: the games, what we played, then everybody's face. */
function shelf() {
  const me = state.players.find((player) => player.id === state.me);

  return `<header class="bar">
    <h1 class="wordmark">Gameroom</h1>
    <button class="me" type="button" id="switch">
      ${face(me ? me.avatar : '__none__')}
      <span>
        <b>${esc(me ? me.name : 'Nobody')}</b>
        <small>not you? tap</small>
      </span>
    </button>
  </header>
  <section class="games">${GAMES.map(gameTile).join('')}</section>
  <section class="record">
    ${recordTile()}
    <h2 class="section">What we played</h2>
    ${recordLog()}
  </section>
  <section class="family">
    <h2 class="section">Everybody</h2>
    <div class="strip">${state.players.map((player) => playerTile(player, player.id === state.me)).join('')}</div>
  </section>`;
}

/**
 * The editor. One name and thirty faces, and it is the same screen for a
 * profile that exists and one that does not — the only differences are the
 * heading and the word on the button.
 *
 * A face another live player holds is shown, disabled, with their name under
 * it. Hiding it would leave a grid that changes shape as the family grows, and
 * "the fox is Alex's" is the answer to why it cannot be picked; an absent tile
 * is not an answer to anything.
 */
function editor() {
  const editing = /** @type {Editing} */ (state.editing);
  const others = state.players.filter((player) => player.id !== editing.id);
  const taken = takenAvatars(others);
  const owner = new Map(others.map((player) => [player.avatar, player.name]));
  const problem = editing.problem;

  const faces = AVATARS.map((entry) => {
    const isTaken = taken.has(entry.key);
    const chosen = entry.key === editing.avatar;
    return `<button class="face-choice" type="button" data-face="${esc(entry.key)}"
      aria-pressed="${chosen}"${isTaken ? ' disabled' : ''}>
      ${face(entry.key)}
      <span>${esc(isTaken ? owner.get(entry.key) || entry.label : entry.label)}</span>
    </button>`;
  }).join('');

  return `<header class="bar">
    <h1 class="wordmark">${editing.id ? 'You' : 'Somebody new'}</h1>
    <button class="btn" type="button" id="cancel">Back</button>
  </header>

  <div class="editor">
    <div class="preview">
      ${face(editing.avatar)}
      <b>${esc(editing.name || 'No name yet')}</b>
    </div>

    <label class="field">
      <span class="section">Name</span>
      <input id="name" type="text" value="${esc(editing.name)}" maxlength="${NAME_MAX}"
             autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false"
             enterkeyhint="done" placeholder="What should we call you?">
    </label>
    ${problem && problem.field === 'name' ? `<p class="note bad">${esc(problem.message)}</p>` : ''}

    <h2 class="section">Face</h2>
    ${problem && problem.field === 'avatar' ? `<p class="note bad">${esc(problem.message)}</p>` : ''}
    <div class="faces">${faces}</div>

    <div class="actions">
      <button class="btn btn-accent" type="button" id="save"${editing.busy ? ' disabled' : ''}>
        ${editing.busy ? 'Saving…' : editing.id ? 'Save' : 'Make me'}
      </button>
    </div>
  </div>`;
}

function render() {
  const screen = state.editing ? editor() : state.me && !state.switching ? shelf() : picker();
  root.innerHTML = `<div class="shell">${screen}</div>`;
}

/** @param {string} message */
function renderProblem(message) {
  root.innerHTML = `<div class="shell">
    <h1 class="ask">Hmm.</h1>
    <p class="note bad">${esc(message)}</p>
    <div class="row"><button class="btn" type="button" id="retry">Try again</button></div>
  </div>`;
}

/**
 * Picking is optimistic: the ring moves under the thumb and the screen changes
 * before the server has answered, because a tap that does nothing for 200ms on
 * a phone reads as a tap that missed (docs/design-language.md §2). If the write
 * fails the screen goes back to the picker and says so, which is the only case
 * where the optimism costs anything.
 *
 * @param {string} id the player, or '' for nobody
 */
async function pick(id) {
  const previous = state.me;
  state.me = id || null;
  state.switching = false;
  render();

  try {
    await setWho(id || null);
  } catch (err) {
    state.me = previous;
    state.switching = true;
    if (err instanceof ApiError && err.status === 401) return;
    renderProblem(err instanceof Error ? err.message : 'That did not work.');
  }
}

/**
 * Open the editor. `id` null makes a new profile, which starts on the first
 * face nobody has — an empty grid with nothing chosen is a screen where the
 * preview has no face in it, and the preview is the whole point of the screen.
 *
 * @param {string | null} id
 */
function openEditor(id) {
  const player = id === null ? null : state.players.find((entry) => entry.id === id);
  if (id !== null && !player) return;

  const taken = takenAvatars(state.players);
  const free = AVATARS.find((entry) => !taken.has(entry.key));

  state.editing = {
    id,
    name: player ? player.name : '',
    avatar: player ? player.avatar : (free ? free.key : ''),
    problem: null,
    busy: false,
  };
  render();
}

/** Back out of the editor, to whichever screen makes sense to have come from. */
function closeEditor() {
  state.editing = null;
  render();
}

/**
 * Put a refusal on the screen and take the reader to it.
 *
 * The scroll is the point: the save button follows the screen down past eight
 * rows of faces, so a message rendered beside the name field is a message
 * nobody is looking at when they press it.
 *
 * @param {{ field: string, message: string }} problem
 */
function showProblem(problem) {
  const editing = /** @type {Editing} */ (state.editing);
  editing.problem = problem;
  editing.busy = false;
  render();
  const said = root.querySelector('.note.bad');
  if (said) said.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * Save, or create.
 *
 * The client checks first with the same module the Worker checks with, so the
 * usual refusal — an empty name, a face somebody has — is instant and costs no
 * round trip. It is a courtesy and not a guard: the Worker decides again on
 * what actually arrives.
 *
 * Nothing here is optimistic. Picking a face is a thing you can undo by picking
 * another one; a save that silently did not happen is a name you believe you
 * changed, and finding that out a day later is worse than waiting 200ms.
 */
async function save() {
  const editing = /** @type {Editing} */ (state.editing);
  if (editing.busy) return;

  const proposal = { name: normaliseName(editing.name), avatar: editing.avatar };
  const others = state.players.filter((player) => player.id !== editing.id);

  const problem = profileProblem(proposal, others);
  if (problem) {
    showProblem(problem);
    return;
  }

  editing.busy = true;
  editing.problem = null;
  render();

  try {
    if (editing.id === null) {
      const { player, me } = await createPlayer(proposal);
      state.players = [...state.players, player];
      state.me = me;
    } else {
      const { player } = await updatePlayer(editing.id, proposal);
      state.players = state.players.map((entry) => (entry.id === player.id ? player : entry));
    }
    state.editing = null;
    state.switching = false;
    render();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    showProblem({
      field: (err instanceof ApiError && err.field) || 'name',
      message: err instanceof Error ? err.message : 'That did not save.',
    });
  }
}

/**
 * Fetch the log and the tile, after the shelf has already been drawn.
 *
 * The two calls are one `Promise.all` and one redraw, because two redraws on a
 * phone are the tile appearing, the page jumping, and then the log appearing.
 * A failure in either leaves the shelf whole: §5.2 of the spec is that a stats
 * query may not stand between a 5-year-old and the tiles.
 *
 * A 401 has already navigated to the gate, and there is nothing to draw behind
 * an expired cookie anyway.
 */
async function loadRecord() {
  try {
    // One page, sized past what two days of this family can hold, because the
    // log shows two days and there is no second call to fetch.
    const [page, stats] = await Promise.all([getPlays({ limit: 100 }), getStats()]);
    state.record = {
      plays: page.plays,
      faces: facesFrom(page.players),
      failed: false,
      loaded: true,
    };
    state.stats = stats;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    state.record = { ...state.record, failed: true, loaded: true };
  }
  if (!state.editing) render();
}

/** @param {import('../shared/api.js').RecordPlayer[]} players */
function facesFrom(players) {
  return new Map(players.map((player) => [player.id, { name: player.name, avatar: player.avatar, retired: player.retired }]));
}

// One listener on the container rather than one per tile: every screen here is
// redrawn whole, and handlers attached to elements that no longer exist are the
// bug that follows from that.
root.addEventListener('click', (event) => {
  const target = /** @type {HTMLElement} */ (event.target);

  if (state.editing) {
    const chosen = target.closest('.face-choice');
    if (chosen instanceof HTMLElement) {
      state.editing.avatar = chosen.dataset.face || '';
      state.editing.problem = null;
      render();
      return;
    }
    if (target.closest('#save')) save();
    else if (target.closest('#cancel')) closeEditor();
    return;
  }

  if (target.closest('#new-player')) {
    openEditor(null);
    return;
  }

  if (target.closest('#edit-me')) {
    openEditor(state.me);
    return;
  }

  const tile = target.closest('.who');
  if (tile instanceof HTMLElement) {
    pick(tile.dataset.id || '');
    return;
  }

  if (target.closest('#switch')) {
    state.switching = true;
    render();
    return;
  }

  if (target.closest('#retry')) start();
});

// The name lives in state, not in the input: tapping a face redraws the screen,
// and a redraw that threw away what had been typed would make choosing a face
// and typing a name mutually exclusive.
root.addEventListener('input', (event) => {
  const field = /** @type {HTMLElement} */ (event.target);
  if (state.editing && field.id === 'name') {
    state.editing.name = /** @type {HTMLInputElement} */ (field).value;
  }
});

// There is no <form> here — the editor is one screen among three rather than a
// page of its own — so Enter has to be wired up by hand. An Android keyboard
// shows "done" on that key (enterkeyhint), and a key that shows "done" and then
// does nothing is worse than one that says "return".
root.addEventListener('keydown', (event) => {
  const field = /** @type {HTMLElement} */ (event.target);
  if (state.editing && field.id === 'name' && event.key === 'Enter') {
    event.preventDefault();
    save();
  }
});

async function start() {
  root.innerHTML = '<div class="shell"><p class="note">Opening the gameroom…</p></div>';
  try {
    const { players, me } = await getPlayers();
    state.players = players;
    state.me = me;
    state.switching = false;
    state.editing = null;
    render();
    // Not awaited: the shelf is on the screen and the record catches up under it.
    loadRecord();
  } catch (err) {
    // A 401 has already navigated to the gate; anything else is ours to say.
    if (err instanceof ApiError && err.status === 401) return;
    renderProblem(err instanceof Error ? err.message : 'Something went wrong.');
  }
}

start();
