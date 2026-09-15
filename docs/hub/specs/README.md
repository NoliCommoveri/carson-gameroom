# Hub spec files

Implementation specs for the phases in [`../../../ROADMAP.md`](../../../ROADMAP.md)
that build the hub itself. One file per session. A session is spec'd only when
it is next or nearly next; the rest live as a row in the table below and nothing
more, because a spec written three sessions ahead is written against a tree that
does not exist yet.

| Phase | Session | Spec | Cost | State |
|---|---|---|---|---|
| 2 | A — database and admin | — | Medium | ✅ Built |
| 2 | B — erase, export, re-import | [`phase-2-session-b-erase-export.md`](phase-2-session-b-erase-export.md) | Medium | ✅ Built |
| 2 | C — gate, picker, shelf | [`phase-2-session-c-gate-picker-shelf.md`](phase-2-session-c-gate-picker-shelf.md) | Medium–Large | ✅ Built |
| 2 | D — editing a profile | [`phase-2-session-d-editing-a-profile.md`](phase-2-session-d-editing-a-profile.md) | Small–Medium | ✅ Built |
| 3 | A — the read API and the log | [`phase-3-session-a-the-read-api-and-the-log.md`](phase-3-session-a-the-read-api-and-the-log.md) | Medium | ✅ Built |
| 3 | B — sudoku's timer and its row | [`phase-3-session-b-sudoku-timer-and-its-row.md`](phase-3-session-b-sudoku-timer-and-its-row.md) | Small–Medium | Spec'd, not started |
| 3 | C — the per-game views | — | Medium | Not spec'd |

Session A is built, so B and C can each start from it. They are independent of
each other: B is sudoku writing a row, C is reading one per game.

**Session C, in one paragraph, so its shape is not a surprise.** Sudoku's bests
by size and tier, and Pit's points and corners, each on a screen inside its own
game rather than on the hub — `../../identity-and-stats.md` §4.3. Both read
`GET /api/plays?game=…` and do their own grouping, because what `config_json`
and `detail_json` mean is per-game knowledge and the Worker holds none of it.
Neither needs a new endpoint, which is why it is spec'd last rather than first.

## Conventions these specs assume

The same ones the game specs assume, and for the same reason — they follow from
`CLAUDE.md` rather than from taste:

- **No build step, no runtime dependencies.** `public/` is plain ES modules the
  browser loads directly.
- **The dependency between the trees points one way.** `worker/` may import from
  `public/shared/`; nothing under `public/` imports from `worker/`
  (`../../../worker/README.md`). A rule both halves have to agree on therefore
  lives in `public/shared/`, which is where `profile.js` already is.
- **Anything a session cannot verify on its own is an `S`* item** in
  [`../../sudoku/specs/questions.md`](../../sudoku/specs/questions.md), named
  with the person and the device, not a line in that session's acceptance
  criteria. `../../design-language.md` §5 says why.
