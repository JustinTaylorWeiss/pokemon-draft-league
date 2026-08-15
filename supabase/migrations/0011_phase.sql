-- Telling a draft pick from a trade.
--
-- They are the same write: a roster row appears or disappears and the board's
-- claim moves. What separates them is when it happened — during the draft, or
-- after somebody closed it. That is a fact about the moment, not about the row,
-- so it has to be recorded as the change is made. Working it out later would
-- mean reconstructing the draft's status from its own history and hoping the
-- clocks line up.
--
-- Rows written before this column existed keep a null phase. That is honest:
-- nobody was tracking it then, and guessing would put picks and trades in
-- whichever bucket happened to look right.

alter table events add column phase text;

/**
 * Logs a change, stamping what the league was doing at the time.
 *
 * Unchanged from 0002 apart from `phase`. The draft's status is read inside the
 * same transaction as the write it describes, so a pick made in the instant
 * before someone ends the draft is recorded as a pick.
 */
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
  stage    text;
begin
  row_data := to_jsonb(coalesce(new, old));

  foreach key_col in array tg_argv loop
    key_data := key_data || jsonb_build_object(key_col, row_data -> key_col);
  end loop;

  who := coalesce(nullif(row_data ->> 'edited_by', ''), 'anonymous');
  select status into stage from draft_state where id = true;

  if tg_op = 'INSERT' then
    insert into events (actor, action, table_name, row_key, before, after, phase)
    values (who, 'insert', tg_table_name, key_data, null, to_jsonb(new), stage);
    return new;

  elsif tg_op = 'UPDATE' then
    -- An update that changed nothing but `edited_by` is not worth a row.
    if to_jsonb(new) - 'edited_by' = to_jsonb(old) - 'edited_by' then
      return new;
    end if;
    insert into events (actor, action, table_name, row_key, before, after, phase)
    values (who, 'update', tg_table_name, key_data, to_jsonb(old), to_jsonb(new), stage);
    return new;

  else
    insert into events (actor, action, table_name, row_key, before, after, phase)
    values (coalesce(nullif(old.edited_by, ''), 'anonymous'),
            'delete', tg_table_name, key_data, to_jsonb(old), null, stage);
    return old;
  end if;
end;
$$;
