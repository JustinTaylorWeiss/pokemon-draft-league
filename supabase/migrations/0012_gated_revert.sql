-- Undoing a change needs the passphrase.
--
-- Everything else here is open on purpose: editing is the point, and the log
-- makes it safe. Reverting is the one edit that reaches backwards through
-- somebody else's work, so it goes behind the same gate as opening a draft or
-- changing who is in the league.
--
-- The ungated version is dropped rather than left alongside. A gate with a way
-- round it is decoration, and the old signature was callable by anyone.

drop function if exists revert_event(bigint, text);

/**
 * Puts a row back the way it was before one event, and records the undo.
 *
 * The undo is itself an event, stamped with the id it reverses, so undoing is
 * as visible as doing and can be undone in turn. Nothing is erased.
 */
create or replace function revert_event(
  passphrase text,
  event_id bigint,
  who text default 'anonymous'
)
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
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

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
  if new_id = event_id then
    raise exception 'That change did not undo — the row may already be gone.'
      using errcode = 'P0002';
  end if;
  update events set reverts = event_id, actor = who where id = new_id;
  return new_id;
end;
$$;
