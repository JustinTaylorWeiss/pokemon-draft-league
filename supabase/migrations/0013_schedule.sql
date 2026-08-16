-- Editing the schedule.
--
-- Adding a fixture is harmless: a match with no result changes nothing until
-- somebody plays it. Removing one is not — a played match takes its games, its
-- lines and its contribution to the standings with it — so deletion goes behind
-- the passphrase and the open delete policy comes off.
--
-- Inserts stay open on purpose. `scripts/import-to-supabase.mjs` seeds a season
-- by inserting matches directly, and closing that would break seeding to gate
-- something that cannot hurt anyone.

drop policy drop_row on matches;

/**
 * Adds an unplayed fixture.
 *
 * Gated for symmetry with removal rather than from need — the same screen does
 * both, and a gate that covers half of it would be confusing.
 */
create or replace function schedule_match(
  passphrase text,
  week integer,
  side_a text[],
  side_b text[],
  who text default 'anonymous'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
  label  text;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;
  if coalesce(array_length(side_a, 1), 0) = 0 or coalesce(array_length(side_b, 1), 0) = 0 then
    raise exception 'A match needs a player on each side.' using errcode = '22023';
  end if;
  if side_a && side_b then
    raise exception 'The same player cannot be on both sides.' using errcode = '22023';
  end if;

  select string_agg(p.name, ' + ' order by x.ord) into label
  from unnest(side_a) with ordinality as x(id, ord) join players p on p.id = x.id;

  insert into matches (week, label, side_a, side_b, score_a, score_b, edited_by)
  values (
    week,
    label || ' vs ' || (
      select string_agg(p.name, ' + ' order by y.ord)
      from unnest(side_b) with ordinality as y(id, ord) join players p on p.id = y.id
    ),
    side_a, side_b, null, null, who
  )
  returning id into new_id;

  return new_id;
end;
$$;

/**
 * Removes a fixture, and everything recorded under it.
 *
 * Games, game lines and match lines are cascaded by their foreign keys. The
 * history keeps every one of those deletions, so this is recoverable even
 * though it is not reversible in one step.
 */
create or replace function unschedule_match(
  passphrase text,
  match_id bigint,
  who text default 'anonymous'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  gone matches;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  -- Stamped first so the delete trigger records who did it.
  update matches set edited_by = who where id = unschedule_match.match_id;
  delete from matches where id = unschedule_match.match_id returning * into gone;

  if gone.id is null then
    raise exception 'No match with id %.', match_id using errcode = 'P0002';
  end if;
  return format('Removed %s.', coalesce(gone.label, 'that match'));
end;
$$;

/**
 * Removes a whole week of fixtures.
 */
create or replace function remove_week(
  passphrase text,
  week integer,
  who text default 'anonymous'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  gone integer;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  update matches m set edited_by = who where m.week = remove_week.week;
  delete from matches m where m.week = remove_week.week;
  get diagnostics gone = row_count;
  return gone;
end;
$$;
