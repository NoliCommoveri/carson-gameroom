# Phase 3 Session A — The read API and the log

**H4**, the half that shows. The record has been written since Pit session 4 and
the only way to see a row is `/admin`'s JSON export. This session is where the
family opens the front page and sees what it played.

Two endpoints, one pure module both halves import, and the log and the overall
tile on the shelf. Nothing here writes.

## 1. What the front page is for, and what it is not

`../../identity-and-stats.md` §4.3 is settled and this session builds it:
**the log is the hero and the ranking is secondary.** The shelf gets the play
log and one small tile; per-game detail is inside each game (Session C).

The consequence that shapes every decision below: **the front page never puts
the six of you in order.** The tile shows what the family has played and what
*you* have played, and there is no row of names sorted by anything. A
leaderboard is the first thing the 12-year-old optimises and the first thing the
5-year-old loses at, and making it a screen nobody asked for is not the site
this is.

## 2. Files

```
public/shared/record.js   pure: the winning outcomes, the units, days, the streak
worker/record.js          GET /api/plays, GET /api/stats — the only D1 reads
worker/api.js             routes both; nothing else changes
public/shared/api.js      gains getPlays and getStats
public/hub/hub.js         the log and the tile, on the shelf
public/hub/hub.css        their layout
test/record.test.js       the pure half
test/plays-read.test.js   the two routes, against a D1 stub
```

`record.js` sits under `public/shared/` for the reason `profile.js` does: it
holds rules both halves need and the dependency between the trees only ever
points from `worker/` into `public/`. `worker/record.js` is split from `api.js`
because `api.js` is about who you are and this is about what happened; they
share only the `json()` helper and the gate, and a single 900-line file is the
thing this repo has avoided everywhere else.

## 3. Two endpoints

```
GET /api/plays?game=&limit=&before=  → 200 { plays, players, next }
GET /api/stats                       → 200 { plays, finished, players, starts, starts_truncated }
```

Both are behind the gate like everything under `/api/`, both are `no-store`, and
both are `GET` — a 405 with `allow: GET` otherwise, the way the existing routes
refuse.

### 3.1 `GET /api/plays` — the log, and everything derived from it

```js
{
  plays: [{
    id, game, mode, config,        // config is parsed JSON, or null
    started_at, ended_at,          // ended_at null on a game nobody closed
    results: [{ player_id, rank, outcome, value, unit, detail }],
  }],
  players: [{ id, name, avatar, retired }],
  next: "1757260800000.9f3c…" | null,
}
```

- **Newest first**, `ORDER BY started_at DESC, id DESC`, which is what
  `plays_recent` and `plays_by_game` are indexed for.
- **`config` and `detail` are parsed and handed through uninterpreted.** The
  Worker does not know what is in them and must not learn: `config_json` is
  sudoku's size and tier and Pit's table as dealt, and a Worker that read either
  would be a third game touching two files instead of one (H2). Text that does
  not parse comes back as `null` rather than throwing — a row written by a
  version that is gone is still a row worth seeing in the log.
- **`limit`** defaults to 30 and is capped at 500. 30 is a screenful and a bit
  on the phone; 500 is what Session C's per-game views ask for in one page.
- **`before` is a compound cursor**, `<started_at>.<id>`, and the page is rows
  strictly older than it:
  `WHERE started_at < ?1 OR (started_at = ?1 AND id < ?2)`. Compound because two
  phones can open a play in the same millisecond, and a bare timestamp cursor
  would silently drop one of them.
- **`next`** is the cursor built from the last row returned, or `null` when the
  page came back shorter than `limit`.
- **`game`** filters on the slug and is validated with the same
  `/^[a-z][a-z0-9-]{0,31}$/` the write path uses. An unknown game is an empty
  page, not a 404: a game removed from `games.js` still has rows, and the record
  outliving the shelf is the point of keeping it game-agnostic.
- **Three statements, one `batch()`, never N+1.** The page of plays; then
  `SELECT … FROM play_results WHERE play_id IN (…)`; then the players those
  results name. A per-row query for results would be thirty round trips to draw
  one screen.

**`players` is part of the answer, not a second call.** `GET /api/players`
returns live profiles only, and a result outlives the profile that made it —
`retired_at` is a soft delete precisely so results keep their author
(`../../identity-and-stats.md` §3). So this response carries every player id it
mentions, live or retired, with the name and face to draw it. §5 is what the log
does with a retired one.

### 3.2 `GET /api/stats` — the tile's numbers

```js
{
  plays: 412,                                  // rows in plays
  finished: 388,                               // plays with at least one result
  players: [{ id, played: 96, won: 41 }],      // one entry per player with results
  starts: [1757260800000, …],                  // up to 400, newest first
  starts_truncated: false,
}
```

- **`finished` counts plays with at least one `play_results` row**, not plays
  with an `ended_at`. §4.1's sentence is *we started six and finished two*, and
  finishing is leaving a result behind.
- **`won` uses `WON` from `public/shared/record.js`**, imported by the Worker.
  `outcome` is an unchecked slug on the write path on purpose, and what counts
  as a win is a reading decision; putting the set in the Worker would make it a
  second list of game vocabulary. §4 has it.
- **`starts` is raw timestamps, because a day is a local day.** The Worker runs
  in UTC and has no idea what the phones think midnight is: a Pit session at
  9pm on Tuesday in UTC−6 is Wednesday in UTC, and a log grouped server-side
  would file half the evening's games under tomorrow. So **nothing here groups
  by day** — the Worker hands back numbers and `record.js` cuts them where the
  browser's clock says.
- **400 timestamps is the streak's window**, about 3KB, and longer than a year
  of playing every day. When it is exhausted `starts_truncated` is true and the
  tile says `400+ days`, which is a floor rather than a lie.

## 4. `public/shared/record.js` — the pure half

Nothing in it touches the DOM, `window`, or `fetch`, so CI covers the same code
the browser and the Worker run.

```js
WON                          // Set: 'won', 'solved'
BETTER                       // { seconds: 'lower', points: 'higher' }
SHAPED                       // Set: units whose format already says what they are
isWin(result)                // outcome ∈ WON
finished(play)               // play.results.length > 0
formatValue(value, unit)     // 412 s → "6:52"; 310 points → "310"
bestOf(results, unit)        // min or max by BETTER; null on an unknown unit
recent(plays, now)           // today's and yesterday's, and nothing older
byDay(plays, now)            // [{ day, label, plays }], newest first, local days
streak(starts, now)          // consecutive local days ending today or yesterday
```

- **`BETTER` is keyed by unit, not by game.** Lower seconds and higher points
  are properties of the unit, which is what `unit` was put in the schema for
  (`../../architecture.md` §3.1: *a reader needs no per-game knowledge*). A
  third game brings a unit at most.
- **An unknown unit renders as the bare number and sorts by nothing.** A game
  that invents `'tricks'` shows its value in the log the day it is written and
  waits for a line in this file before it has a best.
- **`SHAPED` is what stops the log writing `6:52 seconds`.** `formatValue` is
  the numeral and the unit's word follows it, unless the shape has already said
  it. It is a set rather than a check on the string, because a format is a
  decision this file makes and the log should not be reading it back.
- **`label`** is `Today`, `Yesterday`, the weekday inside a week, then `3 Sep`,
  then `3 Sep 2026` outside this year. The shelf only ever shows the first two —
  the rest are for Session C's per-game screens, which do show a history. `now`
  is an argument so the tests can stand anywhere.
- **`recent` is what keeps the front page short.** It is in this file rather
  than in the hub because it is the same local-day question `byDay` and `streak`
  answer, and a second definition of *yesterday* is how the three of them come
  to disagree.
- **`streak` counts yesterday as alive.** A streak that reads as broken at
  breakfast because nobody has played yet today is a streak that punishes
  getting up.
- **`finished(play)` is the only distinction the log draws.** A row with no
  `ended_at` (the phone was locked) and a row closed with `result: null` (the
  game was abandoned) render identically, because nobody cares which kind of
  not-finishing it was. Both shapes stay distinguishable in the data for anyone
  querying it; neither earns a second style on a 360px screen.

## 5. The log on the shelf

It goes **between the games and the family strip**. Below the strip it is a
second scroll on the phone, and the thing you have to scroll to is not the hero.
`../../design-language.md` §3 has the order.

```
Today
  [sudoku]  Ada                6:52          ①
  [pit]     Ada                310 points    ①
  [pit]                        didn't finish
Yesterday
  [sudoku]  Sam                4:31          ①
```

- **A row is the game's art, the faces, and the outcome.** The art is `games.js`'s
  `art` at 32px in the game's accent, so a pre-reader reads the row by shape and
  colour before anybody reads a word (`../../design-language.md` §2). A face
  always carries its name — the log is the one screen where an avatar alone is
  not enough, because §5's retired players can share one.
- **The value is `formatValue`, and rank 1 gets a pip.** No ranking beyond that
  and no per-row detail; `detail_json` is Session C's.
- **Unfinished rows are dimmed, carry no face, and say `didn't finish`.** They
  are not hidden. "We started six and finished two" is the sentence the two-call
  write path exists to make true, and a log that quietly dropped them would undo
  it. They have no face because a play that left no result left no `player_id`
  either: who was holding the phone is in `config_json`, which this session does
  not read (§10) and the Worker does not either. The art and the sentence are
  what the row is, and that is enough for the row's whole job — being counted.
- **A row's faces are its results**, so a Pit session against bots is one face
  until Phase 7 seats more than one human in a play.
- **Today and yesterday, and nothing older. There is no `More`.** The front page
  answers *what are we playing*, which is a question about this evening and last.
  Anything below the log is below the family strip on a 360px phone, and a list
  that keeps going is a feed. The rest of the record is not lost — `/api/plays`
  pages all of it, and Session C's per-game screens are where a history is read.
- **One call, `limit=100`.** Two days of this family is a dozen rows; the margin
  is there so the log never needs a second call to be complete.
- **Empty is a sentence pointing at the games**, not an empty box, and there are
  two of them: *nothing here yet* on a record with nothing in it, and *nothing
  today or yesterday* on one that has older rows. The tile is what knows which.

### 5.1 The tile

One line above the log's heading, and small:

```
417 games · 6 days in a row          you: 96 games, 41 wins
```

`you:` is present only when the device has somebody picked, and it names nobody
else. That is I1's decision made concrete rather than decorative
(`../../identity-and-stats.md` §4.3).

### 5.2 The shelf must render without either call

The games and the family strip come from `/api/players`, which the shelf already
awaits. **The log and the tile are fetched after first paint**, and a failure in
either leaves the shelf whole and puts one sentence where the log would be. The
front page's job is getting a 5-year-old into a game; a stats query that is slow
or broken may not stand between them and the tiles.

Both calls go through `shared/api.js`'s `call()` with the gate behaviour left on
— a 401 here is a device that needs the passphrase again, and the shelf has
nothing to show anyway.

## 6. Retired players, and faces that come back

A retired player releases their avatar, so a live player may hold the face a
retired one's rows still carry. The log draws a retired player with their name
and a desaturated disc, and the name under every face is what disambiguates —
which is why §5 makes the caption unconditional rather than an option.

Nothing retires a profile yet (Session D's §8), so this path has no traffic. It
is built now because it is four lines here and a schema question later.

## 7. Cost, and when this stops working

The log is paged and does not care how large the table is. `/api/stats` is three
aggregates and a 400-row scan of an index. At this family's rate — single-digit
rows a day — the whole record is a few thousand rows for years, well inside D1's
5M reads a day (`../../architecture.md` §6).

**Where it would first hurt is Session C**, which pulls a game's whole history to
group it in the browser. If that ever gets slow, the fix is an aggregate endpoint
beside these two, and `record.js` is the file whose functions it would have to
agree with. Nothing here needs designing around it now.

## 8. Tests

`node --test`, and everything with a decision in it is reachable from CI.

- **`test/record.test.js`** — the pure half. The ones that pay for the file:
  `byDay` across a daylight-saving boundary with `TZ` set, which is the bug the
  timestamps-not-days decision exists to prevent; `streak` accepting yesterday
  and refusing the day before; `formatValue` past an hour; `bestOf` returning
  null on a unit it does not know rather than guessing a direction.
- **`test/plays-read.test.js`** — both routes, driven with real `Request`s
  through the gate, against a D1 stub that holds rows and applies the statements
  `worker/record.js` issues. What it has to cover: paging with the compound
  cursor across two rows sharing a millisecond; a play with no results; a
  retired player appearing in `players`; malformed `config_json` coming back as
  `null` rather than throwing; `limit` above the cap being clamped; an unknown
  `game` returning an empty page.

The shelf is rendered in headless Chromium at 360px in both themes with a stub
server, which says the layout holds and the calls land. It does not say the log
reads as the site's memory — that is S12.

## 9. Acceptance criteria

| # | Criterion | Closed by |
|---|---|---|
| 1 | `node --test` passes, including the two new files. | CI |
| 2 | `GET /api/plays` returns plays newest first with their results and the players they name, and pages with `next` until it runs out. | CI |
| 3 | A play with no `ended_at` and a play closed with no result both come back, and both render as `didn't finish`. | CI + phone |
| 4 | Days are the phone's days: an evening game does not move to tomorrow. | CI |
| 5 | The shelf renders its games and faces when `/api/plays` fails, with one sentence where the log would be. | CI |
| 6 | The front page shows today's and yesterday's games under the tiles, with faces, names and results, and nothing older. | Phone (S12) |
| 7 | The tile shows the family's total, the streak, and the picked player's own counts, and no ordering of the family. | Phone (S12) |
| 8 | The 5-year-old points at a row and says what it was. | Phone (S12) |

## 10. Explicitly not in this session

- **Per-game views.** Session C. Nothing here reads `config_json` or
  `detail_json`.
- **Sudoku writing a row.** Session B. Until it lands the log is Pit only, which
  is a real state and looks like one.
- **Head-to-head.** Two `play_results` rows sharing a `play_id`
  (`../../identity-and-stats.md` §4) needs Phase 7, where a play has more than
  one human in it.
- **Filters, search, a date picker, or any way to page back.** The log is two
  days. A history is Session C's, inside the game it is about.
- **Deleting or editing a play.** `/admin` is the escape hatch and there is no
  second one.
- **Any screen that ranks the family.** §1.
