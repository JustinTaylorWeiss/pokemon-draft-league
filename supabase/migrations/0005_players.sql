-- Adding and removing players, behind the passphrase.
--
-- Editing stays open everywhere else: fixing a score or a team name is the kind
-- of thing the league should be able to do without ceremony. Changing who is IN
-- the league is not — it moves the seeding, the schedule and the rosters — so
-- it goes through the same gate the draft does.
--
-- The gate is real rather than cosmetic. Checking a passphrase in the browser
-- would be theatre, since anyone can read the bundle and call the endpoint
-- directly, so the insert and delete policies come off the table entirely and
-- the only remaining route is a function that does the check itself.

drop policy write_all on players;   -- insert
drop policy drop_row  on players;   -- delete
-- `edit_all` (update) stays: renaming a team is not a structural change.

/**
 * Adds a player.
 *
 * The id is derived rather than accepted, so it is always the slug of the name
 * and never something that disagrees with it. A seed of null puts them last.
 */
create or replace function add_player(
  passphrase text,
  name text,
  team text default null,
  seed integer default null,
  who text default 'anonymous'
)
returns players
language plpgsql
security definer
set search_path = public
as $$
declare
  result players;
  slug   text;
  place  integer;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  name := btrim(name);
  if name = '' then
    raise exception 'A player needs a name.' using errcode = '22023';
  end if;

  -- Matches the ids the spreadsheet importer produces, so a database season and
  -- an imported one refer to people the same way.
  slug := regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g');
  slug := btrim(slug, '-');

  if exists (select 1 from players p where p.id = slug) then
    raise exception '% is already in the league.', name using errcode = '23505';
  end if;

  place := coalesce(seed, (select coalesce(max(p.seed), 0) + 1 from players p));

  insert into players (id, seed, name, team, edited_by)
  values (slug, place, name, nullif(btrim(coalesce(team, '')), ''), who)
  returning * into result;

  return result;
end;
$$;

/**
 * Removes a player.
 *
 * Refuses if they have played. `matches.side_a` and `side_b` are arrays of ids
 * with no foreign key behind them, so deleting someone who appears in a result
 * would not fail — it would quietly leave matches pointing at a player who no
 * longer exists, and the standings would be wrong in a way nobody could see.
 * Better to say no and let a human decide what the results should say.
 *
 * Rosters and draft picks do have foreign keys and are cascaded, which is the
 * intended behaviour for someone who dropped before playing.
 */
create or replace function remove_player(
  passphrase text,
  player_id text,
  who text default 'anonymous'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  played integer;
  gone   players;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  select count(*) into played
  from matches m
  where player_id = any (m.side_a) or player_id = any (m.side_b);

  if played > 0 then
    raise exception
      'That player appears in % recorded %. Remove or reassign those matches first.',
      played, case when played = 1 then 'match' else 'matches' end
      using errcode = '23503';
  end if;

  -- Stamped before the delete so the history records who did it: the delete
  -- trigger reads edited_by off the row on its way out.
  update players set edited_by = who where id = player_id;

  delete from players where id = player_id returning * into gone;
  if gone.id is null then
    raise exception 'No player with id %.', player_id using errcode = 'P0002';
  end if;

  return format('Removed %s.', gone.name);
end;
$$;
