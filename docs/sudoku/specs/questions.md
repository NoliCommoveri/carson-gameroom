# Open items

Three kinds.

- **Setup tasks.** Things only you can do, in a browser. Listed so they are not
  discovered halfway through a slice.
- **`D`* — Due out.** Needs a fact about your world or a decision only you can
  make. Where a due out blocks a slice, that slice does not start.
- **`Q`* — Open question.** I have a recommendation. Silence means I build the
  recommendation. Cheap to redirect before the code exists, expensive after.

Answered items are deleted from here and folded into the spec they affected.
This file is the current unknowns, not a log of resolved ones.

---

## Setup tasks

### S1 — Connect this repo to Cloudflare Workers ✅ done

The repo builds and deploys on push to `main`, serving at `games.immotus.app`.
Build command empty, deploy command the wrangler default, both correct.

The rest of the Cloudflare setup — the Worker, the D1 database, the two secrets
and the domain — is hub work and lives in `../../architecture.md` §8, not here.
All of it is done.

### S2 — Verify slice 1 on the phone and the Chromebook

Slice 1 has four acceptance criteria that no test and no agent can reach: they
need a real Android phone, a real Chromebook, and a deployed URL. They are
listed here rather than left inside the slice file so they are not discovered at
the point of trying to call slice 1 done.

Order matters — each step needs the one above it.

1. **S1 is done** and `games.immotus.app` loads. *(criterion
   2)*
2. **On the Android phone, open `/dev.html` and press "time 100 deals".** Report
   the p95 it prints. Under 250ms passes; over 1s is a hard fail and sends
   generation into a Web Worker. *(criterion 3)*
3. **On the Android phone, in portrait, solve a full 9×9** with no keyboard.
   Watch for horizontal scroll, a need to pinch-zoom, and mis-taps. *(criterion
   5)*
4. **On the Chromebook, solve a full 9×9 using only the keyboard** — no mouse,
   no trackpad, including new-game, undo, and check. *(criterion 6)*

Steps 3 and 4 are the ones that decide whether the layout survives, and they
are the urgent ones: every size added since draws through the same `board.js`,
so a layout fault found now is a fault in all three at once.

A "no" on any step is not something to work around — it is slice 1 reopening.
Say what went wrong in as much detail as you can stand; "the board felt
cramped" is usable, "it did not work" is not.

### S4 — Look at 6×6 and 4×4 on the phone

Slice 2's one criterion no test closes: box borders correct *by eye*. Its
arithmetic is asserted cell by cell in `grid.test.js`, and the classes those
flags produce are what `board.js` draws — but whether the heavy rules read as
boxes at 360px wide is a thing only a phone answers.

1. **On the Android phone, open `/dev.html` and press "Deal one of each size".**
   The 6×6 should show boxes 3 wide and 2 tall: one heavy rule down the middle,
   two across. *(criterion 2)*
2. **On `/`, switch to 6×6, enter a few digits, switch to 9×9 and back.** The
   6×6 board and its entries should still be there, and so should the 9×9 one.
   Reload: it should come back at 6×6. *(criterion 3)*

Do this with S2, not instead of it — S2 is about whether the 9×9 layout works
at all, this is about whether the other two sizes are drawn right.

### S5 — Check the three difficulties on the phone

Slice 3's one criterion no test closes: whether Easy, Medium and Hard read as
three different puzzles to the people playing them. The clue counts are asserted
exactly in `generator.test.js` and the openness floors in `openness.test.js` —
what no test can tell me is whether the easy one is actually easy for an 11 year
old.

1. **On the Android phone, open `/dev.html` and press "Deal one of each size and
   difficulty".** Read across a 9×9 row: Easy should look conspicuously fuller
   than Hard.
2. **On `/`, at 9×9, play an Easy board with both kids.** It should take
   somewhere around ten minutes and there should never be a long stretch with
   nothing findable. If the youngest gets stuck for more than a minute, the easy
   clue count is too low — say so and I will raise it, which is one number in
   `sizes.js`.
3. **Press Medium, then Easy again.** Each should come back to its own board
   with its own entries still on it, and the difficulty should survive a reload.

Answer 2 with a rough time and whether anyone got stuck, not a yes or no. It is
the only measurement in this project that a test cannot take.

### S11 — Check the board chooser and the win popup on the phone

Two sudoku changes whose whole point is how they feel in a hand, so no test
reaches either. On the Android phone, in portrait, and again on the Chromebook.

1. **Open `/sudoku/` and look without scrolling.** The whole grid and every
   keypad key, including **New game**, have to be on the screen at once. If
   anything is below the fold, say which phone and how tall its viewport is —
   `index.html`'s `--reserve` is the number that is wrong.
2. **Play half a puzzle without opening the chooser.** The question is whether
   the top-bar button gets pressed by accident now. It should not; if it does,
   it is too close to the board.
3. **Open the chooser and change size, then difficulty.** It should cover the
   board rather than move it, close on the choice, and close on a tap anywhere
   else. Each board you left should still be where you left it when you go
   back.
4. **Finish a 4×4 easy and watch the 5-year-old's face.** That is the criterion.
   Then ask whether they can get out of the popup on their own — two buttons,
   and a tap on the dark ground also works, but only one of those is
   discoverable.
5. **Finish three more and read the lines.** They should not repeat back to
   back, and the 12-year-old should not find any of them babyish. If one of
   them lands badly, `celebrate.js`'s `LINES` is a list to edit.
6. **Turn on reduced motion** (Android: Settings → Accessibility) and finish
   one. The dialog and the words stay, the confetti and the pop go. If the
   celebration stops reading as a celebration, the words are doing too little
   work.
7. **On the Chromebook, finish one with the keyboard only.** Focus should land
   in the dialog, Escape should close it, and focus should come back to the
   board.

### S12 — Check the play log and the tile on the front page

Phase 3 Session A puts the record on the shelf, and none of what matters about
it is reachable by a test: whether the log reads as the family's memory, and
whether a pre-reader can read a row. On the Android phone, in portrait, with at
least one Pit session and one abandoned game already written.

1. **Open the front page and look without scrolling.** The games have to still
   be the first thing there, with the log starting below them. If the tiles have
   been pushed off the top, the log is too tall before it is too interesting.
   The log is today and yesterday only; there is no way to page further back
   from here, and the question is whether anybody goes looking for one.
2. **Ask the 5-year-old what the top row says.** Do not name the games. They
   should get *Pit* or *sudoku* from the art and whose face is on it. Where they
   hesitate is the finding, and it is probably the art at 32px.
3. **Find the abandoned row.** It should read as unfinished at a glance and not
   as an error, and nobody should ask what went wrong with it.
4. **Open it on a morning when nobody has played yet.** Yesterday's games should
   be there on their own, under *Yesterday*, and the sentence where today would
   be should not read as an error.
5. **Read the tile aloud.** *417 games, 6 days in a row, you: 96 games.* The
   question is whether the 12-year-old reads it as a score to beat. It should
   read as the house's, not theirs.
6. **Watch for a week: does anybody mention the streak?** If the streak becomes
   a thing to protect rather than a thing to notice, it is doing the job a
   leaderboard was kept off this page to avoid, and it comes off the tile.
7. **Turn the wifi off and reload.** The games and the faces have to be there,
   with one sentence where the log would be. A front page that fails whole
   because a stats query did is the failure this is checked for.

### S13 — Check sudoku's timer on the phone

Phase 3 Session B puts a clock in the sudoku bar, which is the first change to
that screen since S11 and can undo S11 step 1 on its own.

1. **Open `/sudoku/` and look without scrolling.** The whole grid and every
   keypad key still have to be on the screen at once, with the readout in the
   bar. If anything has gone below the fold, `index.html`'s `--reserve` is the
   number that is wrong.
2. **Play for a minute and watch the readout.** It should not jitter or shift
   the board name as the digits change.
3. **Lock the phone for two minutes, then come back.** The clock must have not
   moved while the screen was off.
4. **Leave a board half done, come back tomorrow, finish it.** The time written
   down has to be the minutes actually spent, not the hours since.
5. **Finish one and check the front page.** The row should be there with the
   time, on today.
6. **Start a new board over an unfinished one, then look at the log.** The
   abandoned board should be in it, unfinished.
7. **Tap Nobody in the picker, then finish a 4×4.** The confetti and the popup
   should be exactly as they were, with a small line saying it was not saved.
8. **Watch the 5-year-old play one with the clock there.** If they start hurrying
   or ask about the numbers, the timer should be showing only after the first
   solve, or not at all on 4×4. That is the finding this check exists for.

### S3 — Nothing else, for sudoku

Sudoku itself needs no secret, no environment variable and no binding. The
hub's four setup tasks are in `../../architecture.md` §8.

---

## Due outs

### D1 — Moved

The players' names are now the hub's business, not sudoku's, and there is no
family code any more — one Durable Object per family code was replaced by a
shared D1 (`../../architecture.md` §3). What is still needed from you is the
family passphrase, tracked in `../../identity-and-stats.md` §5; the screen names
are no longer a due out, because the site changes them now. It does not block
anything.

---

## Open questions

### Q2 — How do tests run, given no CLI?

**Rec: two mechanisms, different jobs.**

- **Unit tests in CI.** `test/*.test.js` using node's built-in `node:test` and
  `node:assert`, run by a GitHub Actions workflow on every push. No npm install
  — there are no dependencies. You see a green or red check on the commit in the
  GitHub web UI, which is the only place you can see anything without a CLI.
- **A `/dev` page in the browser.** Not unit tests. Generator timing on the
  actual phone, and a visual dump of generated puzzles for spot-checking. Some
  things — is 9×9 fast enough on the Android, does the 6×6 box border read right
  — cannot be answered by an assertion.

The cost of being wrong here is low; I raise it because it decides whether core
modules may use `node:` imports (they may not — the `/dev` page loads them too).

### Q3 — Wrong-entry feedback

Interacts with §7.2's no-guess lock, so worth a deliberate answer rather than a
default.

- **Immediate.** Cell turns red the moment a wrong digit lands.
- **On demand.** A "check" button marks current mistakes.
- **On completion only.** Silence until the board is full.

**Rec: on demand, plus automatic detection at completion.** Immediate feedback
turns the puzzle into a guessing game — nine taps brute-forces any cell — which
is exactly the failure §7.2 is worried about. On-completion-only is punishing
for a beginner who went wrong forty moves back. The check button puts the cost
of guessing on the player's own decision to press it.

Check presses are counted as an assist and written into the result's `detail`
(`../../hub/specs/phase-3-session-b-sudoku-timer-and-its-row.md` §5). What the
bests screen then does with them — footnote or exclusion — is Phase 3
Session C's, and it is a display decision now that the number is recorded.

### Q4 — Pencil marks in slice 1?

**Rec: no, defer to slice 4.** No puzzle this project deals requires them:
difficulty is clue count (§4.3), and at every tier the board is finishable by
singles. They earn their place as a comfort on a 9×9 hard board and as the way
a naked pair becomes visible when slice 6 teaches one — neither of which is
slice 1's problem.

*Cost of the deferral:* the board component's cell rendering and input handling
both change in slice 4. Small, and better paid there than guessed at now.

### Q6 — Symmetric clue removal

Classic sudoku puzzles remove clues in rotationally symmetric pairs, purely for
looks.

**Rec: no.** Symmetry constrains which clue sets are reachable, which fights
§4.3 twice over: a removal would have to take its mirror with it, so a tier's
clue count could only be hit within two, and an added clue would have to bring
its mirror past the openness floor. Aesthetics are not worth a difficulty that
means less than it says.

### Q7 — What persists locally, and what does not

Sudoku had no server before the hub. Something still needs to survive a closed tab, and still does — an in-progress board is not worth a round trip.

**Rec:** `localStorage` holds the in-progress board and UI preferences only.
Explicitly **not** best times or win counts, even though slice 1 could trivially
write them. Those are `plays` / `play_results` rows in D1 (`../../architecture.md` §3.1), and writing
them to `localStorage` first means slice 9 opens with a data migration and a
"which copy is authoritative" question for no gain. Timing does not exist until
slice 9.

*Consequence:* R4 and R5 depend on the hub's database, so the timer phase sits
after the storage foundation rather than before it. That ordering is the price
of having exactly one authoritative copy of the only data here that cannot be
regenerated — and it paid off at the hub pivot, which arrived with no results
data anywhere and therefore no migration to perform.

### Q8 — Custom domain? ✅ settled

`games.immotus.app`, the hub's address. The zone is already on Cloudflare, so
adding it to the Worker is a dashboard action with no code impact
(`../../architecture.md` §8, A4). Sudoku sits at `/sudoku/` under it.

### Q9 — PWA icons

Slice 11 needs real icon files at 192px and 512px, plus a maskable variant.

**Rec:** I generate a plain glyph — a 3×3 box with a few filled cells — and
commit the PNGs. Replace them whenever; they are two files and one manifest
entry. Say so if one of the kids would rather draw it, which is a better answer
than mine.
