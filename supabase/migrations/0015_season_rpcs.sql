-- Every action now says which season it acts on.
--
-- These all assumed there was only one. Adding a player, claiming a Pokemon,
-- opening a draft, recording a match — each of them wrote to "the" table, and
-- with two seasons in it that is no longer a well-formed instruction.
--
-- The passphrase stays league-wide. It gates who may do structural things at
-- all, not which season they may do them to.

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------

drop function if exists add_player(text, text, text, integer, text);
drop function if exists remove_player(text, text, text);
drop function if exists restore_player(text, text, text);
drop function if exists player_for_account(text);

create or replace function add_player(
  passphrase text,
  season text,
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
  select * into found from players p where p.id = slug and p.season_id = season;

  if found.id is not null then
    if not found.hidden then
      raise exception '% is already in the league.', name using errcode = '23505';
    end if;
    update players
       set hidden = false,
           team = coalesce(nullif(btrim(coalesce(add_player.team, '')), ''), players.team),
           edited_by = who
     where id = slug and season_id = season
    returning * into result;
    return result;
  end if;

  place := coalesce(seed, (select coalesce(max(p.seed), 0) + 1 from players p where p.season_id = season));

  insert into players (season_id, id, seed, name, team, edited_by)
  values (season, slug, place, name, nullif(btrim(coalesce(add_player.team, '')), ''), who)
  returning * into result;

  return result;
end;
$$;

create or replace function remove_player(
  passphrase text, season text, player_id text, who text default 'anonymous'
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
   where id = remove_player.player_id and season_id = season
  returning * into target;

  if target.id is null then
    raise exception 'No player with id % in that season.', player_id using errcode = 'P0002';
  end if;
  return format('%s is now hidden. Their results are still on record.', target.name);
end;
$$;

create or replace function restore_player(
  passphrase text, season text, player_id text, who text default 'anonymous'
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
   where id = restore_player.player_id and season_id = season
  returning * into target;

  if target.id is null then
    raise exception 'No player with id % in that season.', player_id using errcode = 'P0002';
  end if;
  return format('%s is back in the league.', target.name);
end;
$$;

-- ---------------------------------------------------------------------------
-- The draft
-- ---------------------------------------------------------------------------

drop function if exists start_draft(text, text);
drop function if exists end_draft(text, text);
drop function if exists claim_pokemon(text, text, text);
drop function if exists release_pokemon(text, text, text);

create or replace function start_draft(passphrase text, season text, who text default 'anonymous')
returns draft_state
language plpgsql
security definer
set search_path = public
as $$
declare
  result draft_state;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  insert into draft_state (season_id, status, current_round, current_pick, started_at, edited_by)
  values (season, 'active', 1, 1, now(), who)
  on conflict (season_id) do update
    set status = 'active', current_round = 1, current_pick = 1,
        started_at = now(), edited_by = who
  returning * into result;

  return result;
end;
$$;

create or replace function end_draft(passphrase text, season text, who text default 'anonymous')
returns draft_state
language plpgsql
security definer
set search_path = public
as $$
declare
  result draft_state;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  insert into draft_state (season_id, status, edited_by)
  values (season, 'complete', who)
  on conflict (season_id) do update set status = 'complete', edited_by = who
  returning * into result;

  return result;
end;
$$;

create or replace function claim_pokemon(
  season text, player_id text, pokemon_id text, who text default 'anonymous'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  taken text;
  tier  text;
begin
  select b.drafted_by, b.tier into taken, tier
  from board b
  where b.pokemon_id = claim_pokemon.pokemon_id and b.season_id = season
  for update;

  if not found then
    raise exception 'There is no % on the board.', pokemon_id using errcode = 'P0002';
  end if;
  if tier = 'Banned' then
    raise exception 'That Pokémon is banned.' using errcode = '22023';
  end if;
  if taken is not null and taken <> claim_pokemon.player_id then
    raise exception 'Already drafted by %.',
      (select name from players where id = taken and season_id = season) using errcode = '23505';
  end if;

  insert into rosters (season_id, player_id, pokemon_id, tier, edited_by)
  values (season, claim_pokemon.player_id, claim_pokemon.pokemon_id, tier, who)
  on conflict on constraint rosters_pkey do nothing;

  update board set drafted_by = claim_pokemon.player_id, edited_by = who
  where board.pokemon_id = claim_pokemon.pokemon_id and board.season_id = season;

  return format('%s drafted.',
    (select name from board where board.pokemon_id = claim_pokemon.pokemon_id and board.season_id = season));
end;
$$;

create or replace function release_pokemon(
  season text, player_id text, pokemon_id text, who text default 'anonymous'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  gone integer;
begin
  delete from rosters r
  where r.player_id = release_pokemon.player_id
    and r.pokemon_id = release_pokemon.pokemon_id
    and r.season_id = season;
  get diagnostics gone = row_count;

  if gone = 0 then
    raise exception 'That is not on their roster.' using errcode = 'P0002';
  end if;

  update board set drafted_by = null, edited_by = who
  where board.pokemon_id = release_pokemon.pokemon_id
    and board.season_id = season
    and board.drafted_by = release_pokemon.player_id;

  return format('%s released.',
    (select name from board where board.pokemon_id = release_pokemon.pokemon_id and board.season_id = season));
end;
$$;

-- ---------------------------------------------------------------------------
-- Matches
-- ---------------------------------------------------------------------------

drop function if exists report_match(integer, text[], text[], text, jsonb, jsonb, text);
drop function if exists schedule_match(text, integer, text[], text[], text);
drop function if exists remove_week(text, integer, text);

create or replace function report_match(
  season text,
  week integer,
  side_a text[],
  side_b text[],
  label text,
  games jsonb,
  lines jsonb,
  who text default 'anonymous'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_match bigint;
  new_game  bigint;
  g         jsonb;
  l         jsonb;
  won_a     integer;
  won_b     integer;
begin
  if jsonb_typeof(games) <> 'array' or jsonb_array_length(games) = 0 then
    raise exception 'A match needs at least one game.' using errcode = '22023';
  end if;
  if coalesce(array_length(side_a, 1), 0) = 0 or coalesce(array_length(side_b, 1), 0) = 0 then
    raise exception 'A match needs a player on each side.' using errcode = '22023';
  end if;

  select
    count(*) filter (where x->>'winner' = 'a'),
    count(*) filter (where x->>'winner' = 'b')
  into won_a, won_b
  from jsonb_array_elements(games) x;

  insert into matches (season_id, week, label, side_a, side_b, score_a, score_b, edited_by)
  values (season, week, label, side_a, side_b, won_a, won_b, who)
  returning id into new_match;

  for l in select * from jsonb_array_elements(lines) loop
    insert into match_lines (match_id, side, pokemon_id, kills, deaths, edited_by)
    values (new_match, l->>'side', l->>'pokemon_id',
            coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0), who);
  end loop;

  for g in select * from jsonb_array_elements(games) loop
    insert into games (match_id, number, winner, replay_url, survivors, edited_by)
    values (new_match, (g->>'number')::integer, g->>'winner', g->>'replay_url',
            (g->>'survivors')::integer, who)
    returning id into new_game;

    for l in select * from jsonb_array_elements(coalesce(g->'a', '[]'::jsonb)) loop
      insert into game_lines (game_id, side, pokemon_id, kills, deaths, brought, edited_by)
      values (new_game, 'a', l->>'pokemon_id',
              coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0),
              coalesce((l->>'brought')::boolean, false), who);
    end loop;

    for l in select * from jsonb_array_elements(coalesce(g->'b', '[]'::jsonb)) loop
      insert into game_lines (game_id, side, pokemon_id, kills, deaths, brought, edited_by)
      values (new_game, 'b', l->>'pokemon_id',
              coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0),
              coalesce((l->>'brought')::boolean, false), who);
    end loop;
  end loop;

  return new_match;
end;
$$;

create or replace function schedule_match(
  passphrase text, season text, week integer, side_a text[], side_b text[],
  who text default 'anonymous'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
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

  insert into matches (season_id, week, label, side_a, side_b, score_a, score_b, edited_by)
  values (
    season, week,
    (select string_agg(p.name, ' + ' order by x.ord)
       from unnest(side_a) with ordinality as x(id, ord)
       join players p on p.id = x.id and p.season_id = season)
    || ' vs ' ||
    (select string_agg(p.name, ' + ' order by y.ord)
       from unnest(side_b) with ordinality as y(id, ord)
       join players p on p.id = y.id and p.season_id = season),
    side_a, side_b, null, null, who
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function remove_week(
  passphrase text, season text, week integer, who text default 'anonymous'
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

  update matches m set edited_by = who where m.week = remove_week.week and m.season_id = season;
  delete from matches m where m.week = remove_week.week and m.season_id = season;
  get diagnostics gone = row_count;
  return gone;
end;
$$;

-- `unschedule_match` and `revert_event` are keyed by a row id, which already
-- says which season it is in. They are unchanged.

/**
 * Finds the player behind a Showdown account, within one season.
 */
create or replace function player_for_account(season text, account text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from players
  where season_id = season
    and showdown_account is not null
    and lower(replace(showdown_account, ' ', '')) = lower(replace(account, ' ', ''))
  limit 1;
$$;
