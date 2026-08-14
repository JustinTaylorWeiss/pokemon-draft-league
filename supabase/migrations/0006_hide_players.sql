-- Removing a player without losing them.
--
-- Deleting somebody who has played is destructive in a way that is hard to see
-- afterwards: their matches stay behind pointing at an id that no longer
-- resolves, and the season quietly stops adding up. So removal now hides
-- instead. The row stays, the results stay, and the league stops showing them.
--
-- This also means removal is always allowed. The earlier version refused anyone
-- with a recorded match, which was the right answer while the only option was a
-- hard delete and the wrong one now that nothing is actually lost.

alter table players add column hidden boolean not null default false;

-- Standings are built from `players`, so hiding one removes their row from the
-- table. Their opponents' records are deliberately left alone: taking someone
-- out of the league should not retroactively rewrite everyone else's season.
create or replace view standings as
  select
    p.id                                                     as player_id,
    p.name,
    p.team,
    p.seed,
    count(r.match_id) filter (where r.games_won > r.games_lost)  as wins,
    count(r.match_id) filter (where r.games_won < r.games_lost)  as losses,
    coalesce(sum(r.games_won), 0)                            as games_won,
    coalesce(sum(r.games_lost), 0)                           as games_lost,
    coalesce(sum(r.games_won), 0) - coalesce(sum(r.games_lost), 0) as diff,
    count(r.match_id) filter (where r.games_won > r.games_lost)  as points
  from players p
  left join match_results r on r.player_id = p.id
  where not p.hidden
  group by p.id, p.name, p.team, p.seed;

/**
 * Checks the passphrase so the UI can unlock before showing anything.
 *
 * `check_passphrase` stays out of reach of the browser; this exposes one
 * specific yes/no answer rather than a general oracle over every key. It is
 * still guessable in principle, but the hash is bcrypt, so guessing is slow
 * enough not to be worth anybody's afternoon.
 */
create or replace function unlock(passphrase text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select check_passphrase('draft', passphrase);
$$;

/**
 * Hides a player. Always permitted — nothing is destroyed.
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
  target players;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  update players set hidden = true, edited_by = who
   where id = remove_player.player_id
  returning * into target;

  if target.id is null then
    raise exception 'No player with id %.', player_id using errcode = 'P0002';
  end if;

  return format('%s is now hidden. Their results are still on record.', target.name);
end;
$$;

/**
 * Puts a hidden player back.
 */
create or replace function restore_player(
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
  target players;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  update players set hidden = false, edited_by = who
   where id = restore_player.player_id
  returning * into target;

  if target.id is null then
    raise exception 'No player with id %.', player_id using errcode = 'P0002';
  end if;

  return format('%s is back in the league.', target.name);
end;
$$;

-- Adding a name that is only hidden brings them back rather than refusing.
-- Refusing would be technically correct and practically useless: the person
-- typing the name wants that player in the league, and the row already exists.
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
  found  players;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  name := btrim(name);
  if name = '' then
    raise exception 'A player needs a name.' using errcode = '22023';
  end if;

  slug := btrim(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '-');

  select * into found from players p where p.id = slug;

  if found.id is not null then
    if not found.hidden then
      raise exception '% is already in the league.', name using errcode = '23505';
    end if;
    update players
       set hidden = false,
           team = coalesce(nullif(btrim(coalesce(add_player.team, '')), ''), players.team),
           edited_by = who
     where id = slug
    returning * into result;
    return result;
  end if;

  place := coalesce(seed, (select coalesce(max(p.seed), 0) + 1 from players p));

  insert into players (id, seed, name, team, edited_by)
  values (slug, place, name, nullif(btrim(coalesce(add_player.team, '')), ''), who)
  returning * into result;

  return result;
end;
$$;
