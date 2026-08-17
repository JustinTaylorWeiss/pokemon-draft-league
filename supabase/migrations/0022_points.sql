-- Season 5 is drafted on a budget, not on tier counts.
--
-- The tier stays and is still what colours a row, but it stops deciding what a
-- team may hold: a Pokémon costs points, a coach has a hundred of them, and
-- that is the whole constraint. Nothing is dropped, because the old rule was
-- never enforced anywhere — `tier_limits` is read by one panel that turns a
-- number red, and the database has never refused a pick over it.
--
-- `rosters.points` is the price paid, kept beside `rosters.tier`, which already
-- works this way for the same reason: re-pricing the board later is a decision
-- about future picks, not a rewrite of teams already drafted.
--
-- Points are per season. A season with none — every season before this one —
-- has a null budget and null costs, and the site shows tier limits there as it
-- always has.

alter table board   add column points integer;
alter table rosters add column points integer;
alter table league_meta add column points_budget integer;

comment on column board.points is
  'What this Pokemon costs to draft. Null where the season is not on points.';
comment on column rosters.points is
  'What was paid, at the time it was drafted. Not re-read from the board.';
comment on column league_meta.points_budget is
  'What a coach may spend in total. Null where the season is not on points.';

update league_meta
   set points_budget = 100,
       picks_per_player = 8,
       edited_by = 'migration'
 where season_id = 'mega-mc';

/**
 * Claims a Pokémon, now recording what it cost.
 *
 * The price is read from the board inside the same transaction as the claim, so
 * a cost cannot change between being shown and being charged.
 */
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
  cost  integer;
begin
  select b.drafted_by, b.tier, b.points into taken, tier, cost
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

  insert into rosters (season_id, player_id, pokemon_id, tier, points, edited_by)
  values (season, claim_pokemon.player_id, claim_pokemon.pokemon_id, tier, cost, who)
  on conflict on constraint rosters_pkey do nothing;

  update board set drafted_by = claim_pokemon.player_id, edited_by = who
  where board.pokemon_id = claim_pokemon.pokemon_id and board.season_id = season;

  return format('%s drafted.',
    (select name from board where board.pokemon_id = claim_pokemon.pokemon_id and board.season_id = season));
end;
$$;

/**
 * Sets what a Pokémon costs.
 *
 * Gated, because a price is a league decision and changing one mid-draft
 * changes what everybody can still afford. Teams already drafted keep what they
 * paid — `rosters.points` is not touched here.
 */
create or replace function set_points(
  passphrase text,
  season text,
  pokemon_id text,
  points integer,
  who text default 'anonymous'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target board;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;
  if points is not null and points < 0 then
    raise exception 'A cost cannot be negative.' using errcode = '22023';
  end if;

  update board set points = set_points.points, edited_by = who
   where board.pokemon_id = set_points.pokemon_id and board.season_id = season
  returning * into target;

  if target.pokemon_id is null then
    raise exception 'There is no % on the board.', pokemon_id using errcode = 'P0002';
  end if;
  return format('%s costs %s.', target.name, coalesce(points::text, 'nothing'));
end;
$$;
