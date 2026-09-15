# Carson Family Gameroom — Roadmap

One site at `games.immotus.app` holding several games, shared player profiles,
and a record of what the family has played.

Players are 4, 5, 11 and 12, plus two adults. Everything below is sized for six
people who know each other, not for the public internet.

## What exists today

A sudoku at `/sudoku/`, deployed and playable, behind a hub that knows who you
are:

- Grid model, seeded generator, and clue-count difficulty tiers at 4×4, 6×6 and
  9×9 — `public/sudoku/core/`, about 600 lines, zero dependencies.
- Solo play with undo, redo, a check button, a board chooser in the top bar and
  a win popup with confetti — `public/sudoku/ui/`.
- In-progress boards saved per size and tier in `localStorage`.
- The hub at `public/index.html`: a passphrase gate, the picker, the profile
  editor and the shelf the games sit on, drawing from `public/shared/` — the
  tokens, the thirty avatars, the profile rules, and the six calls the client
  makes.
- Pit at `/pit/`, on the shelf beside sudoku: the rules core, the bots, the
  local driver, the table, the round-end reveal and the record — `public/pit/`.
  One person picks how many bots sit down and plays rounds against them on a
  phone, and the whole of it has been played on the phone it was written for.
  A seat left alone is taken over by a bot sixty seconds later and
  reclaimed by a tap. A corner opens the reveal — the card in full art, every
  seat's final hand and the counts it offered — and reaching the target draws
  the standings and says whether the session was written down.
- 360 tests under `test/`, run by GitHub Actions on every push.
- A Worker, `carson-gameroom`, serving `public/` at `games.immotus.app`, built
  by Cloudflare's GitHub integration on push to `main`.
- A D1 database, `gameroom`, holding the schema in `docs/architecture.md` §3.1,
  and the admin page at `/admin` that applies it, seeds it, backs it up, erases
  it and restores it — `worker/`.
- Identity: the gate at `/gate`, two signed cookies, and the six calls behind
  them — `worker/auth.js`, `worker/gate.js`, `worker/api.js`.
- The record, both ways. `POST /api/plays` opens a row when a game is dealt and
  `POST /api/plays/:id/end` closes it, with a result or without one;
  `GET /api/plays` pages the log back out with the players it names, and
  `GET /api/stats` carries the tile's counts. All four are game-agnostic —
  `config_json` and `detail_json` are handed through unread — and Pit is the
  only caller so far.
- The log on the shelf, under the games: today's games and yesterday's — who
  played, on which face, and how it went — cut into the phone's own days, with
  one small tile above it and no ordering of the family anywhere on the page.
  Older games are in the record and read from `/api/plays`; the front page is
  what we are playing rather than everything we ever played.
  `public/shared/record.js` is the pure half both the browser and the Worker
  read it by.

No Durable Object. Profiles are made, renamed and re-faced from the hub. A
finished Pit session writes a `plays` row and one `play_results` row for the
human seat, and an abandoned one writes the row with no result; all three shapes
are on the front page, where an unfinished game reads as one rather than being
hidden.

## The five things this is for

Stated as requirements so a slice can be checked against them.

- **H1 — One door.** Every game reachable from one address, one profile, one
  place that remembers you.
- **H2 — Several games.** Sudoku and a Pit-style trading game first. Adding a
  third must not require touching the first two.
- **H3 — Real players.** Profiles the family defines, with avatars and screen
  names each player changes whenever they like.
- **H4 — A record.** What was played, when, by whom, and how it went — per game
  and across all of them.
- **H5 — Kids want to open it.** The 4-year-old can find themselves and start
  something without reading. The 12-year-old is not embarrassed by it.

H5 is not a phase. It is a constraint on every phase that renders anything.

## Phases

Each phase leaves `main` deployed and playable. No phase depends on a later one.

### Phase 0 — Regroup ✅

This document, `docs/architecture.md`, `docs/identity-and-stats.md`,
`docs/design-language.md`. Design docs nested under `docs/`. No code moved.

### Phase 1 — Restructure ✅

The sudoku moved into the hub layout — `public/src/` → `public/sudoku/` —
behind a placeholder front page linking to it. No features, no behaviour
change, no bindings. The 46 tests passing on the moved tree are the proof the
move was clean.

### Phase 2 — The hub: door, profiles, database ✅

The first phase with a server in it. Delivers **H1** and **H3**.

All four sessions are built, all four setup tasks in `docs/architecture.md` §8
are done, and the site is up at `games.immotus.app` with the schema applied, the
six players seeded and the gate answering. Every browser check it owed —
the admin page, the erase and re-import path, the gate and picker, and the
profile editor — has been run on the deployment.

This absorbs the old `slice-07-storage-foundation.md` and its erase/export
sibling, both rewritten for D1. Four sessions, because the erase/export sibling,
the avatar set, and editing a profile are each a piece of work rather than a
detail of one.

**Session A — database and admin.** Medium, ~50k. ✅ Built. `wrangler.jsonc`
gains `main`, the D1 binding and the `Text` rule for `**/*.sql`.
`worker/index.js` routes `/admin` and `/api/*` and lets everything else fall
through to assets. `worker/db/plan.js` is the pure half — quote-aware splitter,
checksums, applied/pending/drifted — and is the only part CI can reach, because
`node --test` cannot import a `.sql` file. `worker/db/migrations.js` is the only
module that imports SQL and holds no logic. `001_schema.sql` carries `players`,
`plays` and `play_results`; `seed_players.sql` carries placeholders. The admin
page renders before login and before any table exists, and puts the failing
statement and its error on the page. The deployed database has the schema
applied and the six placeholders in it.

**Session B — erase, export, re-import.** Medium, ~45k. ✅ Built.
[`docs/hub/specs/phase-2-session-b-erase-export.md`](docs/hub/specs/phase-2-session-b-erase-export.md)
is the design. `worker/db/backup.js` is the pure half — the export document, its
fingerprint, and the import plan — and `apply.js` gained the three D1 halves.
The export download sets a ten-minute cookie holding the fingerprint of the
snapshot it served, and the erase confirmation refuses without it, refuses when
the database has changed since, and refuses until the word `erase` is typed:
that is how the backup is unskippable with no client JavaScript and no secret.
Erase drops one table per statement, retrying until a pass drops nothing new,
because a batch that fails whole never makes progress against a foreign key.
Import is tolerant of a schema that moved, which is the case that actually
happens, and is `INSERT OR IGNORE` throughout. The whole path, refusals
included, was driven on the deployment.

**Session C — gate, picker, shelf.** Medium–Large, ~60k. ✅ Built.
[`docs/hub/specs/phase-2-session-c-gate-picker-shelf.md`](docs/hub/specs/phase-2-session-c-gate-picker-shelf.md)
is the design. `worker/auth.js` is the pure half — the HMAC, the two cookies,
and the check that keeps the gate's redirect on this site — and `gate.js` and
`api.js` are the halves that touch requests. The gate covers `/api/*` and
nothing else: the shell is a static file served before the Worker runs, so it
renders a spinner and no data until `/api/players` answers, and `/admin` stays
exempt because a gated `/admin` is a database that can never be brought up.
`public/shared/` gains the tokens, the thirty avatars, the game list and the
client's two calls; `public/hub/` is the picker and the shelf. Checked on the
phone: the gate, the picker, the shelf and the passphrase change all do what
§9's table says.

**Session D — editing a profile.** Small–Medium, ~30k. ✅ Built.
[`docs/hub/specs/phase-2-session-d-editing-a-profile.md`](docs/hub/specs/phase-2-session-d-editing-a-profile.md)
is the design. `public/shared/profile.js` is the pure half — what a name and a
face have to pass — and it sits under `public/` rather than `worker/` so the
editor and the Worker check the same rules without the dependency between the
trees turning round. `worker/api.js` gained `POST /api/players` and
`PATCH /api/players/:id`; a refusal names the field it is about, so the editor
can put the sentence beside the control that is wrong. Creating a profile picks
it only when the device had nobody, which is the difference between somebody
making themselves and a parent making one for a child. The editor is the hub's
third screen and both ways into it are on the picker — the front page stays the
games and the faces. Checked on the phone, down to the 11-year-old finding the
editor without being shown.

**Why C and D split.** C was at the top of its band before any of D was in it,
and the line between them is the one Phase 3 cares about: **Phase 3 needs
picking, not editing.** A `play_results` row needs a `player_id`, which the
`who` cookie answers; nothing in the record depends on a name being editable.

### Phase 3 — The record

Delivers **H4**. The play log and a small overall tile on the front page, sudoku
writing a row when a board is finished, and per-game views inside each game.
This is the first phase where the site does something the standalone sudoku
could not.

**The write path landed earlier, in Pit session 4**, and the reading landed in
Session A. What is left is sudoku's elapsed time, which does not exist yet, and
the per-game views.

`docs/identity-and-stats.md` §4.3 settles what the front page shows: the log is
the hero, the tile is small, and the page never puts the six of you in order.
Detailed stats live inside each game, because what `config_json` and
`detail_json` mean is per-game knowledge the Worker deliberately does not hold.

Three sessions, tabled in
[`docs/hub/specs/README.md`](docs/hub/specs/README.md). Absorbs the old
sudoku slice 9.

**Session A — the read API and the log.** Medium. ✅ Built.
[`docs/hub/specs/phase-3-session-a-the-read-api-and-the-log.md`](docs/hub/specs/phase-3-session-a-the-read-api-and-the-log.md)
is the design. `GET /api/plays` and `GET /api/stats` are `worker/record.js`,
three statements in one `batch()` and no query per row; the pure half is
`public/shared/record.js`, and the log and the tile are on the shelf between the
games and the family strip. The Worker hands `config_json` and `detail_json`
back unread and never groups by day — a day is the phone's day, and a UTC Worker
would file half of every evening under tomorrow, which is why `/api/stats`
returns raw timestamps and `record.js` cuts them. The log and the tile are
fetched after first paint, so a stats query that is slow or broken leaves the
games and the faces whole and puts one sentence where the log would be. Checked
in headless Chromium at 360px in both themes; **S12** is what it cannot close.

**Session B — sudoku's timer and its row.** Small–Medium.
[`docs/hub/specs/phase-3-session-b-sudoku-timer-and-its-row.md`](docs/hub/specs/phase-3-session-b-sudoku-timer-and-its-row.md).
The `POST` is two lines; the number it posts is the session. Elapsed play time
accumulated across sittings, because a board resumed the next morning would
otherwise record a fourteen-hour best.

**Session C — the per-game views.** Medium. Not spec'd until A is built.
Sudoku's bests by size and tier, Pit's points and corners, each inside its own
game over `GET /api/plays?game=…`. No new endpoint.

### Phase 4 — Finish sudoku

Pencil marks, the reduced logical solver, the technique library and hint
button. Three existing specs, all pure client work with no server in them.

`docs/sudoku/specs/slice-04` (unwritten), `slice-05-solver.md`,
`slice-06-technique-library-hints.md`. Small, Small–Medium, Medium.

### Phase 5 — Pit, on one device ✅

The whole game with no server under it: rules core, bots, the local driver, the
table, scoring and the result row. All four sessions are built and checked on
the phone. Four sessions — three Medium and one Large — tabled in
[`docs/pit/specs/README.md`](docs/pit/specs/README.md); the design is
[`docs/pit/design.md`](docs/pit/design.md).

Only multiplayer needs the Durable Object. The rules module is pure, the bots
are a pure function of a view, and the client renders a view and sends actions,
so all three run in a browser tab and the family can play against bots while the
room is still unwritten. Phase 6 is then written against a rules module that
exists rather than against `docs/gameroom.md` alone.

**Sessions 1, 2 and 3.** `public/pit/core/` holds the deal, the offer
board, the blind swap, the corner, the scoring and the confidentiality boundary;
`core/bot.js` holds the three levels, the target invariant and the latency that
cannot see the board; `tick` gates the bots, one per tick, because the gate is a
field of `State` and `State` is opaque to a room. `public/pit/room/local.js` is
the driver the client talks to and Phase 7 replaces with a socket.

`docs/pit/design.md` §2.6 is in the rules module: pause, resume, abandon,
`present`, a per-seat idle clock, and a bot that takes over a seat sixty seconds
after its player stops and forfeits that seat's round. Without it a four-seat
round hangs the moment somebody puts their phone down, which is what the
5-year-old does.

The screen is `public/pit/ui/`. `present.js` is the pure half — a View and one
object of local intent in, a `Screen` out — and holds every decision the table
makes, which is what keeps `table.js` down to creating elements and reporting
taps. Offering and accepting are the same two-tap mechanism against the hand,
because the hand is the only place a commodity is ever named.

**Session 4** is
[`docs/pit/specs/session-4-round-end-and-the-record.md`](docs/pit/specs/session-4-round-end-and-the-record.md).
The reveal, the ending and what the rules module owed them — §2, §3 and §4 — are
the full card art, every seat's final hand and the counts it offered, the
standings with ranks and corners, `state.corners` as a session total, and
`onComplete` as the driver's seventh method, which is how the client gets ranks
without importing the rules module.

The record — §5 and §6 — is `worker/api.js`'s two endpoints and the two calls in
`public/shared/api.js` that reach them. They are the only calls in that file that
do not send a 401 to the gate: a cookie that expired mid-session must not throw
away the round in progress, so the failure reaches the ending screen as a
sentence instead. A row opens at the deal carrying the table as it was dealt, and
closes when the session ends — with the human seat's result, or with none, which
is what an abandoned game looks like. Pit's tile is on the shelf and the front
page links to it. All three shapes a session can leave were read back out of
`/admin`'s JSON export on the phone, which is the only way to see a written row
until Phase 3.

### Phase 6 — GameRoom

The Durable Object: seats, sockets, hibernation, reconnect, tick, per-player
views. No game logic in it. [`docs/gameroom.md`](docs/gameroom.md). Medium.

### Phase 7 — Pit on the room

The local driver is replaced by a socket to `GameRoom` and the same client plays
against the family. The rules module does not change; the result row moves from
the client to the room. Medium.

### Phase 8 — Sudoku race

Same puzzle, per-player difficulty, on the now-proven room. The generator
already supports this — see `docs/architecture.md` §7. Medium.

### Phase 9 — Little-kid mode

Pit with no text, pip counts, 5-card corners. Its own mode, not a slider.
`docs/pit/design.md` §6. Medium.

### Phase 10 — PWA

Manifest, service worker, install to homescreen. Last by choice, not by
dependency. Small.

## Order, and why this one

**Hub plumbing before the Durable Object.** Phases 2 and 3 exercise every piece
that is easy to get wrong and painful to debug later — subpath routing, the
identity cookie, D1 migrations without a CLI, the custom domain — and they do it
against a game that already works. The alternative, building `GameRoom` first,
means debugging the hardest component before the pipeline that deploys it has
ever carried anything.

**The kids get something in Phase 2, not Phase 5.** Profiles with avatars are
the part a 5-year-old cares about, and they land before any new game does. A
shelf with one game on it and everyone's face on the front page is a real thing
to show them; a half-built trading game is not.

**The game before the room.** Pit's rules, bots and client are client-side
work, so building them first means a playable game four sessions in and a rules
bug debugged in a tab rather than through a socket. The cost is that the room
contract is validated against a local driver before the real room exists, and
the session that writes `GameRoom` will find the gaps — one session's friction,
paid once. `docs/pit/specs/README.md` states it in full.

**Sudoku finishes late, on purpose.** Pencil marks and the technique library are
genuinely wanted, but they improve a game that is already playable. The hub does
not exist at all until Phase 2.

## Open items

`docs/sudoku/specs/questions.md` holds the browser checks. Four are open and
about the board — **S2**, **S4**, **S5** and **S11**. **S12**, the front page's
play log and tile, is now runnable and is what Phase 3 Session A owes: whether
the log reads as the family's memory, whether a pre-reader can read a row, and
whether the streak becomes a thing to protect. **S13**, sudoku's clock, waits on
Session B.

S2 and **S11** are worth running in one sitting: S11 step 1 is whether the whole
board and keypad fit above the fold, which is the same question S2 asks and the
one the top bar moved. Neither needs the gate or the database, and Phase 4 is
the phase that would act on what they say. S13 asks step 1 again, because a
readout in that bar is the next thing that can push the keypad off the screen.

Hub-level open items are in the documents that own them: identity and stats in
[`docs/identity-and-stats.md`](docs/identity-and-stats.md), the visual system in
[`docs/design-language.md`](docs/design-language.md), the Cloudflare setup tasks
in [`docs/architecture.md`](docs/architecture.md) §8.
