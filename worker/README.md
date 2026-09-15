The Worker. Bundled by wrangler on Cloudflare's build machine, never served —
nothing here is under `public/` and nothing under `public/` imports from here.

```
index.js        fetch(): /admin, /gate and /api/* handled here, everything else back to assets
admin.js        the database admin page and its seven routes
auth.js         pure: HMAC signing, the gate and who cookies, safeNext
gate.js         the passphrase page, and the check every /api/* call passes
api.js          /api/players and /api/who, read and write; opening and closing a play
record.js       reading the record: /api/plays and /api/stats, the only D1 reads
db/
  plan.js       pure: the statement splitter, checksums, applied/pending/drifted
  backup.js     pure: the export document, its fingerprint, the import plan
  migrations.js the only module that imports .sql; MIGRATIONS and SEEDS, no logic
  apply.js      everything that touches D1
  sql/
    001_schema.sql
    seed_players.sql
```

The routes, and which of them change anything:

| Route | | |
|---|---|---|
| `GET /admin` | reads | the page |
| `GET /admin/export` | reads | the backup, and the cookie the erase confirmation requires |
| `POST /admin/apply` | writes | pending migrations, one `batch()` per file |
| `POST /admin/seed` | writes | every seed file, whole |
| `POST /admin/erase` | reads | the confirmation page |
| `POST /admin/erase/confirm` | **drops** | every table, the ledger included |
| `POST /admin/import` | writes | a backup, `INSERT OR IGNORE` |

There is no login on any of them, and the gate does not cover them. `/admin`
has to render before a passphrase exists, and the passphrase is a Worker secret
rather than a row — a gated `/admin` is a database that can never be brought up.
The three destructive routes stay guarded the way Session B guarded them: the
erase confirmation demands a fresh backup receipt, and anybody who can reach
`/admin` could already erase.

The other two surfaces:

| Route | | |
|---|---|---|
| `GET /gate` | reads | the passphrase page |
| `POST /gate` | sets | the `gate` cookie, then 303s back to where you were |
| `GET /api/players` | reads | every live profile, and which one this device is |
| `POST /api/players` | writes | a new profile, and picks it if the device had nobody |
| `PATCH /api/players/:id` | writes | a screen name, a face, or both |
| `POST /api/who` | sets | the `who` cookie, or clears it |
| `GET /api/plays` | reads | a page of the log, with its results and the players they name |
| `POST /api/plays` | writes | a row, when a game is dealt |
| `POST /api/plays/:id/end` | writes | the ending, with a result or without one |
| `GET /api/stats` | reads | the tile's counts, and raw start timestamps |

`record.js` is split from `api.js` along the line the two are about: `api.js` is
who you are, `record.js` is what happened. They share the gate, the shape of a
refusal, and four lines of `json()`.

`plan.js` is split from `migrations.js` because `node --test` cannot import a
`.sql` file — a text import is a bundler feature and there is no bundler in CI.
Everything with a decision in it takes strings as arguments and is tested;
`migrations.js` turns files into strings and holds nothing worth testing.

`gate.js` imports `public/shared/avatars.js`, `api.js` imports
`public/shared/profile.js`, and `record.js` imports `public/shared/record.js`
for `WON` — what counts as a win is a reading decision, and the Worker holding
its own copy would make the schema a second list of game vocabulary. Those are
the imports that cross from here into `public/`, and all three modules are pure
— no DOM, no window — so wrangler bundles them like any other file: the gate
page gets real faces on it, the editor and the Worker refuse a taken name by the
same rule, and the log and the tile agree about what they are counting. The
arrow only ever points this way.

Tests may still *read* the `.sql` files with `node:fs`; reading is not
importing. Two naming conventions make that work without importing
`migrations.js`: migrations are `NNN_*.sql`, seeds are `seed_*.sql`.
