# Supabase backend

Replaces the spreadsheet as the league's source of truth, for a future season.
**The current season still runs off the sheet, which remains read-only.**

The design in one line: editing is open to everyone with no login, and what makes
that safe is not permissions but history — every change is recorded by a database
trigger with its previous value and can be reverted.

## The project

`https://skborcymmwraaycgygga.supabase.co` — schema loaded, this season
imported as test data.

## Importing a season

```bash
node scripts/import-to-supabase.mjs                 # into an empty database
node scripts/import-to-supabase.mjs --replace       # over an existing import
```

Re-runnable. Players, the board and rosters upsert on their natural keys;
matches, picks and rules are keyed by generated ids and would duplicate, so
importing over them needs `--replace`. Without it the script stops rather than
quietly doubling a season.

Matches take their sides and series score from `schedule` and their per-Pokemon
lines from `matchStats`. Those two arrays describe the same matches in the same
order and are joined by position — checked by week and by the players' names
appearing in the stats tab's labels, 39 of 40 exactly, the fortieth being the
sheet spelling the same two people differently in each tab. They are not
interchangeable: `schedule` scores a series 2-0 where `matchStats` counts
knockouts 5-0, and standings come from the former.

## Setting it up

1. Create a free project at [supabase.com](https://supabase.com). Region closest
   to the league.
2. In the SQL editor, run the migrations in order:
   - `migrations/0001_league.sql` — tables and the derived standings views
   - `migrations/0002_history.sql` — the event log, its triggers, and revert
   - `migrations/0003_access.sql` — access rules and the draft passphrase
   - `migrations/0004_showdown.sql` — the Showdown account on each player
   - `migrations/0005_players.sql` — the gated add/remove player functions
3. Set the draft passphrase, from the SQL editor rather than the site:

   ```sql
   select set_passphrase('draft', 'whatever-you-choose');
   ```

   It answers with a confirmation line. To double-check at any point:

   ```sql
   select check_passphrase('draft', 'whatever-you-choose');  -- t
   ```

   Running it again simply replaces the passphrase; there is nothing to reset.

4. From **Project settings → API**, send over the **Project URL** and the
   **anon public** key.

### About those keys

The **anon** key belongs in the repo. It is public by design — it identifies the
project, it does not grant anything, and every table's access rules apply to it.
This is the same posture as the sheet link that already ships in the bundle.

The **service_role** key must never go in the repo or the browser. It bypasses
every access rule. Nothing here needs it.

## What exists, and what deliberately doesn't

Single-row corrections are supported everywhere and every one is revertible.

There is **no** operation that clears a week, resets a season, or empties a
table. These were considered and left out rather than gated, because an
operation that does not exist cannot be misused or mis-clicked.

Two actions sit behind the passphrase, and neither of them clears anything:

- **Starting a draft** flips a status flag, so getting it wrong costs a flag
  rather than a season.
- **Adding or removing a player** changes who is in the league, which moves the
  seeding, the schedule and the rosters with it. `players` has no insert or
  delete policy at all, so `add_player` and `remove_player` are the only routes
  in and they do the passphrase check themselves — a browser cannot bypass them
  by calling PostgREST directly.

`remove_player` refuses to remove anyone who appears in a recorded match.
`matches.side_a` and `side_b` are arrays of player ids with no foreign key
behind them, so the delete would not fail — it would quietly leave matches
pointing at somebody who no longer exists, and the standings would be wrong in
a way nobody could see.

## Things worth knowing before writing client code

**A blocked write does not raise an error.** Row-level security denies by
filtering rows, not by throwing, so a forbidden update simply affects zero rows
and reports success. Client code has to check the affected-row count rather than
trust the absence of an exception. Verified: an attempt to rewrite or delete an
event changes nothing and reports no error.

**`edited_by` is how the log learns who acted.** Every editable table carries it,
and the trigger copies it onto the event. Set it on every write or the history
says `anonymous`. It is not authentication and is not trusted — it exists so the
log reads "Nolan changed this on Tuesday" instead of "someone changed this".

**Standings are a view.** Do not write to `standings` or `pokemon_totals`; they
are computed from `match_lines` on read. The sheet stored both the log and the
totals and they drifted apart — its per-Pokémon numbers disagreed with the log
they summarised. There is now only one copy, so there is nothing to drift.

## Testing the SQL locally

These migrations were verified against real Postgres before ever reaching a
Supabase project:

```bash
docker run -d --name pdl-pgtest -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16-alpine
docker exec pdl-pgtest psql -U postgres -c "create role anon nologin;"

# Supabase keeps pgcrypto in an `extensions` schema rather than in public, and
# that difference is load-bearing — a function pinned to public alone cannot see
# crypt() or gen_salt(). Reproduce it here or the passphrase looks fine locally
# and fails on the real project.
docker exec pdl-pgtest psql -U postgres -c "create database supalike;"
docker exec pdl-pgtest psql -U postgres -d supalike -c \
  "create schema extensions; create extension pgcrypto with schema extensions;"

for f in supabase/migrations/000*.sql; do
  docker exec -i pdl-pgtest psql -U postgres -d supalike -v ON_ERROR_STOP=1 < "$f"
done
```

Confirmed there: triggers log every insert, update and delete with the actor;
standings and per-Pokémon totals derive correctly; all three revert paths work
(update restores the old value, delete puts the row back under its original id,
insert removes the row); an undo can itself be undone; the wrong passphrase is
refused and the right one starts the draft; `anon` cannot read the secrets table;
and the event log cannot be rewritten or erased by anyone, while ordinary edits
continue to work.

Remove it when finished:

```bash
docker rm -f pdl-pgtest
```
