// The record, read. What a win is, what a value means, and where a day ends.
//
// Both halves import this. The Worker needs WON, because what counts as a win
// is a reading decision and `outcome` is an unchecked slug on the way in
// (worker/api.js); the hub needs all of it. Nothing here touches the DOM,
// `window`, or `fetch`, so CI covers the same code the browser and the Worker
// run.
//
// **Days are the phone's days.** The Worker is in UTC and has no idea what the
// phones think midnight is — a Pit session at 9pm on Tuesday in UTC−6 is
// Wednesday in UTC — so /api/stats hands back raw timestamps and the cutting
// happens here, against the clock of the device reading it.

/** Outcomes that count as a win. A game that invents a third adds it here. */
export const WON = new Set(['won', 'solved']);

/**
 * Which direction is better, by unit rather than by game.
 *
 * Lower seconds and higher points are properties of the unit, which is what
 * `unit` is in the schema for (docs/architecture.md §3.1: *a reader needs no
 * per-game knowledge*). A third game brings a unit at most, and a game that
 * invents `tricks` shows its number in the log the day it is written and waits
 * for a line here before it has a best.
 *
 * @type {Record<string, 'lower' | 'higher'>}
 */
export const BETTER = { seconds: 'lower', points: 'higher' };

/**
 * Units whose formatting already says what they are. `6:52` needs no caption;
 * `310` needs the word `points` after it.
 */
export const SHAPED = new Set(['seconds']);

/** @typedef {{ player_id: string, rank: number | null, outcome: string, value: number | null, unit: string | null, detail: unknown }} Result */
/** @typedef {{ id: string, game: string, mode: string, config: unknown, started_at: number, ended_at: number | null, results: Result[] }} Play */

/** @param {{ outcome?: string | null }} result */
export function isWin(result) {
  return WON.has(String(result && result.outcome));
}

/**
 * Whether anybody finished.
 *
 * **Leaving a result behind is what finishing is** — not having an `ended_at`.
 * A row nobody closed (the phone was locked) and a row closed with no result
 * (the game was abandoned) are the same thing to a reader, and neither earns a
 * second style on a 360px screen.
 *
 * @param {{ results?: Result[] }} play
 */
export function finished(play) {
  return Boolean(play && play.results && play.results.length > 0);
}

/**
 * The number as a person reads it. Seconds become a clock and everything else
 * is the bare number; an unknown unit is still shown, because a value written
 * by a game this file has not heard of is a value worth seeing.
 *
 * @param {number | null | undefined} value
 * @param {string | null} [unit]
 * @returns {string}
 */
export function formatValue(value, unit = null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
  const n = Number(value);

  if (unit !== 'seconds') return String(Math.round(n * 100) / 100);

  const whole = Math.max(0, Math.round(n));
  const seconds = whole % 60;
  const minutes = Math.floor(whole / 60) % 60;
  const hours = Math.floor(whole / 3600);
  const pad = (part) => String(part).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * The best value among results carrying one unit, or null when the unit is one
 * this file has no direction for. **Null rather than a guess**: picking min for
 * an unknown unit would report a worst score as a personal best, and being
 * silent about `tricks` is the honest answer until somebody writes the line.
 *
 * @param {Result[]} results
 * @param {string} unit
 * @returns {number | null}
 */
export function bestOf(results, unit) {
  const direction = BETTER[unit];
  if (!direction) return null;

  const values = (results || [])
    .filter((result) => result && result.unit === unit && Number.isFinite(Number(result.value)))
    .map((result) => Number(result.value));
  if (values.length === 0) return null;

  return direction === 'lower' ? Math.min(...values) : Math.max(...values);
}

/**
 * The local day a timestamp falls in, as a whole number of days.
 *
 * It reads the calendar fields and rebuilds them in UTC rather than dividing
 * the timestamp, which is the difference between a correct answer and one that
 * moves an evening across the daylight-saving weekend: the clocks go back and
 * a day is 25 hours long, but it is still one day.
 *
 * @param {number} ts
 */
function localDay(ts) {
  const date = new Date(ts);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

// Written out rather than asked of Intl, which spells September two ways
// depending on how new the ICU under it is — `en-GB` gives `Sept` in one Node
// and `Sep` in another, and a heading that changes with the runtime is a
// heading nobody can write a test for. One family, one language.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The label a day carries in the log. @param {number} day @param {number} today */
function dayLabel(day, today) {
  if (day === today) return 'Today';
  if (day === today - 1) return 'Yesterday';

  // Built from a UTC midnight, so it is read back in UTC: reading it locally
  // west of Greenwich would name the day before.
  const date = new Date(day * 86400000);
  if (day > today - 7) return WEEKDAYS[date.getUTCDay()];

  const stamp = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  const thisYear = new Date(today * 86400000).getUTCFullYear();
  return date.getUTCFullYear() === thisYear ? stamp : `${stamp} ${date.getUTCFullYear()}`;
}

/**
 * Today's plays and yesterday's, and nothing older.
 *
 * **The front page is what we are playing, not everything we ever played.** Two
 * days is what fits above the family strip on a 360px phone and what somebody
 * picking up a phone in the evening actually wants to see; the record behind it
 * is not lost, it is just not the front page's job. Per-game history is a screen
 * inside each game (Session C), and /api/plays pages the whole thing for
 * anybody who asks.
 *
 * @param {Play[]} plays
 * @param {number} [now]
 * @returns {Play[]}
 */
export function recent(plays, now = Date.now()) {
  const yesterday = localDay(now) - 1;
  return (plays || []).filter((play) => localDay(play.started_at) >= yesterday);
}

/**
 * The log, cut into local days, newest first. Plays arrive newest first and
 * keep that order inside a day.
 *
 * @param {Play[]} plays
 * @param {number} [now]
 * @returns {{ day: number, label: string, plays: Play[] }[]}
 */
export function byDay(plays, now = Date.now()) {
  const today = localDay(now);
  /** @type {{ day: number, label: string, plays: Play[] }[]} */
  const days = [];

  for (const play of plays || []) {
    const day = localDay(play.started_at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.plays.push(play);
    else days.push({ day, label: dayLabel(day, today), plays: [play] });
  }

  return days;
}

/**
 * Consecutive local days ending today or yesterday, from a list of start
 * timestamps in any order.
 *
 * **Yesterday keeps it alive.** A streak that reads as broken at breakfast
 * because nobody has played yet today is a streak that punishes getting up.
 *
 * @param {number[]} starts
 * @param {number} [now]
 * @returns {number}
 */
export function streak(starts, now = Date.now()) {
  const played = new Set((starts || []).map(localDay));
  const today = localDay(now);

  let day = played.has(today) ? today : played.has(today - 1) ? today - 1 : null;
  if (day === null) return 0;

  let run = 0;
  while (played.has(day)) {
    run += 1;
    day -= 1;
  }
  return run;
}
