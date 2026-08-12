-- Change history.
--
-- Written by triggers rather than by the app. If the app were responsible for
-- recording its own changes then any path that forgot to — a bug, a feature
-- added later, someone calling the API directly — would be invisible here,
-- which is exactly the case the log exists for. A trigger fires on every insert,
-- update and delete regardless of who made it or how, so the log is complete by
-- construction rather than by everyone remembering.

create table events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  -- Whoever the browser said they were. Not authenticated and not trusted —
  -- it exists so history reads "Nolan changed this on Tuesday" rather than
  -- "someone changed this", which is the difference between a log you can act
  -- on and one you can only stare at.
  actor      text not null default 'anonymous',
  action     text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  row_key    jsonb,
  -- The affected row only, never the whole league: a snapshot per event would
  -- be 180kB and would exhaust the storage budget within one season, where a
  -- delta is around 600 bytes.
  before     jsonb,
  after      jsonb,
  -- Set when this event undoes another. Reverting is a forward operation: the
  -- original event is never deleted or amended, so an undo can itself be undone
  -- and nobody can quietly erase what they did.
  reverts    bigint references events (id)
);

create index events_at_idx on events (at desc);
create index events_table_idx on events (table_name, at desc);

-- Periodic snapshots, so "show me the league as of week 3" is a lookup rather
-- than a replay from the beginning. Cheap at roughly one a week.
create table checkpoints (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  label    text,
  snapshot jsonb not null
);

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------

-- TG_ARGV holds the key column names for the table being logged, so row_key
-- identifies the row without this function needing to know each schema.
create or replace function log_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  key_data jsonb := '{}'::jsonb;
  key_col  text;
  who      text;
begin
  row_data := to_jsonb(coalesce(new, old));

  foreach key_col in array tg_argv loop
    key_data := key_data || jsonb_build_object(key_col, row_data -> key_col);
  end loop;

  who := coalesce(nullif(row_data ->> 'edited_by', ''), 'anonymous');

  if tg_op = 'INSERT' then
    insert into events (actor, action, table_name, row_key, before, after)
    values (who, 'insert', tg_table_name, key_data, null, to_jsonb(new));
    return new;

  elsif tg_op = 'UPDATE' then
    -- An update that changed nothing but `edited_by` is not worth a row.
    if to_jsonb(new) - 'edited_by' = to_jsonb(old) - 'edited_by' then
      return new;
    end if;
    insert into events (actor, action, table_name, row_key, before, after)
    values (who, 'update', tg_table_name, key_data, to_jsonb(old), to_jsonb(new));
    return new;

  else
    insert into events (actor, action, table_name, row_key, before, after)
    values (coalesce(nullif(old.edited_by, ''), 'anonymous'),
            'delete', tg_table_name, key_data, to_jsonb(old), null);
    return old;
  end if;
end;
$$;

create trigger log_league_meta after insert or update or delete on league_meta
  for each row execute function log_event('id');
create trigger log_players after insert or update or delete on players
  for each row execute function log_event('id');
create trigger log_board after insert or update or delete on board
  for each row execute function log_event('pokemon_id');
create trigger log_rosters after insert or update or delete on rosters
  for each row execute function log_event('player_id', 'pokemon_id');
create trigger log_draft_picks after insert or update or delete on draft_picks
  for each row execute function log_event('id');
create trigger log_matches after insert or update or delete on matches
  for each row execute function log_event('id');
create trigger log_match_lines after insert or update or delete on match_lines
  for each row execute function log_event('id');
create trigger log_rules_sections after insert or update or delete on rules_sections
  for each row execute function log_event('id');
create trigger log_draft_state after insert or update or delete on draft_state
  for each row execute function log_event('id');

-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------

-- Puts a row back the way it was before one event, and records that it did so.
-- The restore is itself logged by the triggers above, so the history shows both
-- the original change and its undo.
create or replace function revert_event(event_id bigint, who text default 'anonymous')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  e         events;
  where_sql text;
  set_cols  text;
  new_id    bigint;
begin
  select * into e from events where id = event_id;
  if not found then
    raise exception 'No event %', event_id;
  end if;

  select string_agg(format('%I = %L', k, e.row_key ->> k), ' and ')
    into where_sql
  from jsonb_object_keys(e.row_key) as k;

  if e.action = 'insert' then
    -- It was created, so undoing it removes it again.
    execute format('delete from %I where %s', e.table_name, where_sql);

  elsif e.action = 'delete' then
    -- Put the old row back exactly as it was, original key included:
    -- reinserting under a fresh id would orphan anything referencing it, so
    -- the identity column is overridden rather than regenerated.
    execute format(
      'insert into %I overriding system value select * from jsonb_populate_record(null::%I, %L)',
      e.table_name, e.table_name, e.before);

  else
    -- Restore every column except the key. The key identifies the row in the
    -- WHERE clause and does not need setting — and an identity column cannot
    -- be assigned at all, which is what a naive "set every column" hits.
    select string_agg(quote_ident(k), ', ')
      into set_cols
    from jsonb_object_keys(e.before) k
    where not e.row_key ? k;

    if set_cols is null then
      raise exception 'Event % changed nothing outside the key', event_id;
    end if;

    execute format(
      'update %I set (%s) = (select %s from jsonb_populate_record(null::%I, %L)) where %s',
      e.table_name, set_cols, set_cols, e.table_name, e.before, where_sql);
  end if;

  -- Stamp the undo onto the event the triggers just wrote.
  select id into new_id from events order by id desc limit 1;
  update events set reverts = event_id, actor = who where id = new_id;
  return new_id;
end;
$$;
