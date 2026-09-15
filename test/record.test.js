// The pure half of reading the record: what a win is, what a value reads as,
// and where a day ends.
//
// The ones that pay for the file are the days. `byDay` and `streak` are the
// reason /api/stats hands back raw timestamps instead of grouping server-side,
// and a bug in either is a game filed under tomorrow — which is exactly what a
// UTC Worker would have done to every evening.

// The clock this file stands at. Nothing here reads a Date until a test runs,
// so setting it in the module body is early enough — and it has to be set,
// because the decisions here are about local days and a suite running in UTC
// would agree with a UTC Worker about everything, including the two things that
// are wrong. Denver is UTC-6/-7 and changes in November, which is both cases at
// once.
process.env.TZ = 'America/Denver';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BETTER,
  SHAPED,
  WON,
  bestOf,
  byDay,
  finished,
  formatValue,
  isWin,
  recent,
  streak,
} from '../public/shared/record.js';

/**
 * A timestamp from local calendar fields, which is the only way to write these
 * tests: the whole point of the module is that a day is the reader's day.
 *
 * @param {number} y @param {number} m @param {number} d
 * @param {number} [h] @param {number} [min]
 */
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

/** @param {number} started_at @param {object[]} [results] */
const play = (started_at, results = []) => ({
  id: `p${started_at}`,
  game: 'pit',
  mode: 'bots',
  config: null,
  started_at,
  ended_at: results.length ? started_at + 1000 : null,
  results,
});

test('a win is an outcome in WON and nothing else', () => {
  assert.ok(isWin({ outcome: 'won' }));
  assert.ok(isWin({ outcome: 'solved' }));
  assert.ok(!isWin({ outcome: 'lost' }));
  assert.ok(!isWin({ outcome: 'abandoned' }));
  // The set is the vocabulary, and the Worker imports the same one.
  assert.deepEqual([...WON].sort(), ['solved', 'won']);
});

test('finishing is leaving a result behind, not having an ending', () => {
  assert.ok(finished(play(at(2026, 9, 3), [{ outcome: 'won' }])));
  // A phone that was locked, and a game walked away from. Neither finished.
  assert.ok(!finished(play(at(2026, 9, 3))));
  assert.ok(!finished({ ...play(at(2026, 9, 3)), ended_at: at(2026, 9, 3) + 5000 }));
});

test('seconds read as a clock, and keep reading as one past an hour', () => {
  assert.equal(formatValue(412, 'seconds'), '6:52');
  assert.equal(formatValue(9, 'seconds'), '0:09');
  assert.equal(formatValue(60, 'seconds'), '1:00');
  assert.equal(formatValue(3600, 'seconds'), '1:00:00');
  assert.equal(formatValue(3723, 'seconds'), '1:02:03');
  assert.equal(formatValue(86399, 'seconds'), '23:59:59');
});

test('everything else is the bare number, including a unit nobody has written down', () => {
  assert.equal(formatValue(310, 'points'), '310');
  assert.equal(formatValue(7, 'tricks'), '7');
  assert.equal(formatValue(310, null), '310');
  assert.equal(formatValue(null, 'points'), '');
  assert.equal(formatValue(undefined, 'seconds'), '');
  // The unit's word follows the number unless the shape already says it.
  assert.ok(SHAPED.has('seconds'));
  assert.ok(!SHAPED.has('points'));
});

test('the best depends on the unit, and an unknown unit has no best at all', () => {
  const results = [
    { player_id: 'a', unit: 'seconds', value: 412 },
    { player_id: 'b', unit: 'seconds', value: 271 },
    { player_id: 'c', unit: 'points', value: 310 },
    { player_id: 'd', unit: 'points', value: 480 },
    { player_id: 'e', unit: 'tricks', value: 3 },
    { player_id: 'f', unit: 'tricks', value: 9 },
  ];

  assert.equal(BETTER.seconds, 'lower');
  assert.equal(BETTER.points, 'higher');
  assert.equal(bestOf(results, 'seconds'), 271);
  assert.equal(bestOf(results, 'points'), 480);

  // Not 3, and not 9. Guessing a direction would report a worst score as a best.
  assert.equal(bestOf(results, 'tricks'), null);
  assert.equal(bestOf(results, 'points'.toUpperCase()), null);
  assert.equal(bestOf([], 'points'), null);
});

test('the log is cut into local days, newest first, in order inside a day', () => {
  const now = at(2026, 9, 15, 9);
  const plays = [
    play(at(2026, 9, 15, 8)),
    play(at(2026, 9, 15, 7)),
    play(at(2026, 9, 14, 20)),
    play(at(2026, 9, 11, 18)),
    play(at(2026, 9, 3, 19)),
  ];

  // A weekday inside the last week, then the date, and today and yesterday have
  // names of their own.
  const days = byDay(plays, now);
  assert.deepEqual(days.map((day) => day.label), ['Today', 'Yesterday', 'Friday', '3 Sep']);
  assert.deepEqual(days.map((day) => day.plays.length), [2, 1, 1, 1]);
  assert.equal(days[0].plays[0].started_at, at(2026, 9, 15, 8));
});

test('a day older than this year carries its year', () => {
  const days = byDay([play(at(2025, 9, 3, 19))], at(2026, 9, 15, 9));
  assert.equal(days[0].label, '3 Sep 2025');
});

test('an empty log has no days in it', () => {
  assert.deepEqual(byDay([], at(2026, 9, 15)), []);
});

// The bug the timestamps-not-days decision exists to prevent. On the night the
// clocks go back the local day is 25 hours long, and anything that divides a
// timestamp by 86400000 files the evening under the wrong date.
test('a day is still one day across a daylight-saving boundary', () => {
  const sunday = at(2026, 11, 1, 23, 30); // after the clocks went back
  const sundayMorning = at(2026, 11, 1, 1, 30); // before they did
  const saturday = at(2026, 10, 31, 22);

  const days = byDay([play(sunday), play(sundayMorning), play(saturday)], at(2026, 11, 2, 9));
  assert.deepEqual(days.map((day) => day.label), ['Yesterday', 'Saturday']);
  assert.equal(days[0].plays.length, 2);

  assert.equal(streak([sunday, sundayMorning, saturday], at(2026, 11, 2, 9)), 2);
});

// An evening game in the west is tomorrow in UTC. This is the whole argument
// for the Worker handing back numbers.
test('an evening game does not move to tomorrow', () => {
  const tuesdayEvening = at(2026, 9, 15, 21); // 03:00 Wednesday, UTC
  assert.equal(new Date(tuesdayEvening).getUTCDate(), 16);

  const days = byDay([play(tuesdayEvening)], at(2026, 9, 15, 22));
  assert.equal(days[0].label, 'Today');
});

test('the front page is today and yesterday, and nothing older', () => {
  const now = at(2026, 9, 15, 9);
  const plays = [
    play(at(2026, 9, 15, 8)),
    play(at(2026, 9, 14, 23, 50)),
    play(at(2026, 9, 14, 0, 5)), // still yesterday, five minutes past midnight
    play(at(2026, 9, 13, 23, 55)), // the day before, and off the page
    play(at(2026, 9, 3, 19)),
  ];

  const kept = recent(plays, now);
  assert.equal(kept.length, 3);
  assert.deepEqual(byDay(kept, now).map((day) => day.label), ['Today', 'Yesterday']);
});

test('nothing lately is an empty list rather than the last thing played', () => {
  const now = at(2026, 9, 15, 9);
  assert.deepEqual(recent([play(at(2026, 9, 13, 20))], now), []);
  assert.deepEqual(recent([], now), []);
});

test('a day is a local day here too, so an evening game is still today', () => {
  const tuesdayEvening = at(2026, 9, 15, 21); // 03:00 Wednesday, UTC
  assert.equal(recent([play(tuesdayEvening)], at(2026, 9, 15, 22)).length, 1);
});

test('a streak counts back from today', () => {
  const now = at(2026, 9, 15, 9);
  const starts = [at(2026, 9, 15, 8), at(2026, 9, 14, 20), at(2026, 9, 13, 11), at(2026, 9, 11, 11)];
  assert.equal(streak(starts, now), 3);
});

test('yesterday keeps a streak alive; the day before does not', () => {
  const now = at(2026, 9, 15, 8);
  // Nobody has played yet today. A streak that broke at breakfast would punish
  // getting up.
  assert.equal(streak([at(2026, 9, 14, 20), at(2026, 9, 13, 20)], now), 2);
  assert.equal(streak([at(2026, 9, 13, 20), at(2026, 9, 12, 20)], now), 0);
  assert.equal(streak([], now), 0);
});

test('several games in one day are one day of the streak', () => {
  const now = at(2026, 9, 15, 21);
  const starts = [at(2026, 9, 15, 20), at(2026, 9, 15, 19), at(2026, 9, 15, 18)];
  assert.equal(streak(starts, now), 1);
});

test('a streak does not care what order the timestamps arrive in', () => {
  const now = at(2026, 9, 15, 9);
  const starts = [at(2026, 9, 13, 11), at(2026, 9, 15, 8), at(2026, 9, 14, 20)];
  assert.equal(streak(starts, now), 3);
});
