# Supabase backend

Replaces the spreadsheet as the league's source of truth, for a future season.
**The current season still runs off the sheet, which remains read-only.**

The design in one line: editing is open to everyone with no login, and what makes
that safe is not permissions but history — every change is recorded by a database
trigger with its previous value and can be reverted.

## Setting it up

1. Create a free project at [supabase.com](https://supabase.com). Region closest
   to the league.
2. In the SQL editor, run the migrations in order:
   - `migrations/0001_league.sql` — tables and the derived standings views
   - `migrations/0002_history.sql` — the event log, its triggers, and revert
   - `migrations/0003_access.sql` — access rules and the draft passphrase
3. Set the draft passphrase, from the SQL editor rather than the site:

   ```sql
   select set_passphrase('draft', 'whatever-you-choose');
   ```

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

Starting a draft is the one action behind the passphrase. Note that it clears
nothing — it flips a status flag — so getting it wrong costs a flag, not a
season.

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
for f in supabase/migrations/000*.sql; do docker exec -i pdl-pgtest psql -U postgres -v ON_ERROR_STOP=1 < "$f"; done
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
