-- Puts the Test Season back.
--
-- On 2026-08-16 a DELETE was sent to `seasons` for id 'test'. Every table added
-- in 0014 references that row with `on delete cascade`, so one request removed
-- 2,925 rows across eleven tables: the whole season, its board, its matches and
-- everything recorded under them.
--
-- Nothing was lost, because every one of those deletes went through `log_event`
-- first and each event carries the entire row in `before`. This reads them back
-- out and re-inserts them, in the order the foreign keys require.
--
-- Two things are deliberate:
--
--   * The restore runs with the log triggers off. Left on it would write 2,925
--     insert events attributed to whoever originally wrote each row, which is
--     not what happened. One row at the end records the repair instead.
--   * Every insert is `on conflict do nothing`, so running this against a
--     database that already has the season — or a fresh one, which has no
--     events to read — changes nothing.
--
-- The hole this exposed is closed in 0017. This file only repairs.

do $$
declare
  wiped_at constant timestamptz := '2026-08-16 21:25:34.892571+00';
  -- Restored in this order: a row cannot land before what it points at.
  ordered  constant text[] := array[
    'league_meta', 'players', 'rules_sections', 'draft_state',
    'board', 'rosters', 'draft_picks',
    'matches', 'match_lines', 'games', 'game_lines'
  ];
  t        text;
  seq      text;
  override text;
  put_back integer;
  total    integer := 0;
begin
  if not exists (select 1 from events where action = 'delete' and at = wiped_at) then
    raise notice 'No such deletion in the log. Nothing to restore.';
    return;
  end if;

  -- `seasons` carries no trigger, so it left no event. Its contents are known:
  -- it is the row every other table was cascading from.
  insert into seasons (id, label, position, edited_by)
  values ('test', 'Test Season', 0, 'restore')
  on conflict (id) do nothing;

  foreach t in array ordered loop
    execute format('alter table %I disable trigger user', t);
  end loop;

  foreach t in array ordered loop
    -- Rows go back under the ids they had, and those ids are `generated always`,
    -- which refuses a supplied value without this. Keeping them matters: every
    -- game line names its game by id, and a match its games.
    select case when exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t
         and c.is_identity = 'YES' and c.identity_generation = 'ALWAYS'
    ) then 'overriding system value' else '' end into override;

    execute format(
      'insert into %1$I %2$s
         select (jsonb_populate_record(null::%1$I, e.before)).*
           from events e
          where e.action = ''delete'' and e.at = $1 and e.table_name = $2
          on conflict do nothing',
      t, override
    ) using wiped_at, t;

    get diagnostics put_back = row_count;
    total := total + put_back;
    raise notice '% : % rows', t, put_back;
  end loop;

  foreach t in array ordered loop
    execute format('alter table %I enable trigger user', t);

    -- Rows went back with the ids they had, which leaves every sequence behind
    -- where it was. The next insert would collide with a restored row.
    --
    -- Asked about a table with no `id` at all this raises rather than returning
    -- null, and `league_meta` has not had one since 0014 re-keyed it, so the
    -- column is checked for before the sequence is.
    seq := case when exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t and c.column_name = 'id'
    ) then pg_get_serial_sequence(t, 'id') end;

    if seq is not null then
      execute format(
        'select setval(%L, coalesce((select max(id) from %I), 0) + 1, false)', seq, t
      );
    end if;
  end loop;

  insert into events (actor, action, table_name, row_key, before, after, season_id)
  values (
    'restore', 'update', 'seasons', jsonb_build_object('id', 'test'),
    null,
    jsonb_build_object(
      'restored_rows', total,
      'from_deletion_at', wiped_at,
      'note', 'Test Season rebuilt from the event log after an accidental cascade delete.'
    ),
    'test'
  );

  raise notice 'Restored % rows.', total;
end $$;
