-- A match won by disqualification, where no games were played.
--
-- The league had no forfeit of any kind: a result was a score, and the only
-- way to record "they did not play" was to invent a 2-0 and hope nobody read
-- it as a sweep. This makes it its own thing — the win counts, the games do
-- not, and the Matches tab can say DQ rather than a score nobody played.
--
-- Games are left out rather than zeroed because that is what happened. It
-- also keeps the standings honest in a way a phantom 2-0 could not: the
-- game-win columns are a tiebreaker, and two game wins nobody played would
-- put a coach above somebody who won a real series 2-1.

alter table matches add column if not exists forfeit boolean not null default false;

comment on column matches.forfeit is
  'Won by disqualification. The score says who won; no games were played.';

-- The three views, in dependency order. `create or replace` cannot add a
-- column to a view, and `match_results` is gaining one, so they come down
-- and go back up — standings reads the other two, player_mon_diff reads
-- match_results.
drop view if exists standings;
drop view if exists player_mon_diff;
drop view if exists match_results;

create view match_results as
  select
    m.season_id,
    m.id                                            as match_id,
    m.week,
    unnest(m.side_a)                                as player_id,
    m.score_a                                       as games_won,
    m.score_b                                       as games_lost,
    m.forfeit,
    'a'::char(1)                                    as side
  from matches m
  where m.score_a is not null and m.score_b is not null
  union all
  select
    m.season_id, m.id, m.week, unnest(m.side_b), m.score_b, m.score_a, m.forfeit, 'b'::char(1)
  from matches m
  where m.score_a is not null and m.score_b is not null;

-- Unchanged in substance: a forfeit has no games, so the inner join drops it
-- without being asked and no Pokémon differential is credited either way.
create view player_mon_diff as
  select
    r.season_id,
    r.player_id,
    coalesce(sum(
      case when g.winner = r.side::text then g.survivors else -g.survivors end
    ), 0) as mon_diff
  from match_results r
  join games g on g.match_id = r.match_id
  where g.survivors is not null
    and g.winner in ('a', 'b')
  group by r.season_id, r.player_id;

create view standings as
  select
    p.season_id,
    p.id                                                     as player_id,
    p.name,
    p.team,
    p.seed,
    -- The win and the loss are counted from the score, forfeit or not: a
    -- disqualification is a result, and the table has to show it as one.
    count(r.match_id) filter (where r.games_won > r.games_lost)  as wins,
    count(r.match_id) filter (where r.games_won < r.games_lost)  as losses,
    -- The games are not. Nothing was played, so nothing is added to the
    -- columns that count what was.
    coalesce(sum(r.games_won) filter (where not r.forfeit), 0)   as games_won,
    coalesce(sum(r.games_lost) filter (where not r.forfeit), 0)  as games_lost,
    coalesce(d.mon_diff, 0)                                  as diff,
    count(r.match_id) filter (where r.games_won > r.games_lost)  as points
  from players p
  left join match_results r
    on r.player_id = p.id and r.season_id = p.season_id
  left join player_mon_diff d
    on d.player_id = p.id and d.season_id = p.season_id
  where not p.hidden
  group by p.season_id, p.id, p.name, p.team, p.seed, d.mon_diff;

-- Recording one.
--
-- Its own function rather than a flag on `report_match`, because the two are
-- not the same shape: that one is built around replays, per-game lines and
-- per-Pokémon totals, and insists on at least one game. A forfeit has none of
-- those. Sharing the entry point would mean loosening the check that keeps an
-- empty result from being filed as a real one.
--
-- `side_a` won; `side_b` was disqualified. The score is 1-0 because something
-- has to say who won and the standings read it — the games it implies are not
-- counted anywhere, and the Matches tab prints DQ rather than the number.
create or replace function report_forfeit(
  season text,
  week integer,
  side_a text[],
  side_b text[],
  label text,
  who text default 'anonymous'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_match bigint;
begin
  if coalesce(array_length(side_a, 1), 0) = 0 or coalesce(array_length(side_b, 1), 0) = 0 then
    raise exception 'A match needs a player on each side.' using errcode = '22023';
  end if;
  if sorted_ids(side_a) && sorted_ids(side_b) then
    raise exception 'A coach cannot be disqualified against themselves.' using errcode = '22023';
  end if;

  -- The fixture this is the result of, the same way `report_match` finds it:
  -- same season and week, same two sides either way round, and a result
  -- already on it is no reason to skip — a second report of the same pairing
  -- in the same week is that match again.
  select m.id into new_match
  from matches m
  where m.season_id = season
    and m.week = report_forfeit.week
    and (
      (sorted_ids(m.side_a) = sorted_ids(report_forfeit.side_a)
        and sorted_ids(m.side_b) = sorted_ids(report_forfeit.side_b))
      or
      (sorted_ids(m.side_a) = sorted_ids(report_forfeit.side_b)
        and sorted_ids(m.side_b) = sorted_ids(report_forfeit.side_a))
    )
  order by (m.score_a is null), m.id
  limit 1;

  if new_match is null then
    insert into matches (season_id, week, label, side_a, side_b, score_a, score_b, forfeit, edited_by)
    values (season, week, label, side_a, side_b, 1, 0, true, who)
    returning id into new_match;
  else
    update matches m
    set label = report_forfeit.label,
        side_a = report_forfeit.side_a,
        side_b = report_forfeit.side_b,
        score_a = 1,
        score_b = 0,
        forfeit = true,
        edited_by = who
    where m.id = new_match;
    -- Whatever was played before is gone with the result it belonged to.
    delete from match_lines where match_id = new_match;
    delete from games where match_id = new_match;
  end if;

  return new_match;
end;
$$;

-- And the other direction: a real result filed over a forfeit clears the
-- flag. `report_match` already replaces the score, the games and the lines
-- where a row is there to replace; the forfeit mark was the one thing it
-- left behind, so a DQ later played out properly kept its games out of the
-- standings.
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

  -- The match this is the result of. Either way round: whoever reports it
  -- may not name the sides as the schedule did.
  --
  -- A result on it already is not a reason to skip it. These two played
  -- once in this week, so a second report of them is the same match again
  -- — someone correcting it, or someone who did not know it was in — and
  -- the row it belongs in is the one that is already there.
  --
  -- An existing result is preferred over a blank fixture, in the case
  -- where both somehow exist: that is the row people have been looking at
  -- and the one carrying the games.
  select m.id into new_match
  from matches m
  where m.season_id = season
    and m.week = report_match.week
    and (
      (sorted_ids(m.side_a) = sorted_ids(report_match.side_a)
        and sorted_ids(m.side_b) = sorted_ids(report_match.side_b))
      or
      (sorted_ids(m.side_a) = sorted_ids(report_match.side_b)
        and sorted_ids(m.side_b) = sorted_ids(report_match.side_a))
    )
  order by (m.score_a is null), m.id
  limit 1;

  if new_match is null then
    insert into matches (season_id, week, label, side_a, side_b, score_a, score_b, edited_by)
    values (season, week, label, side_a, side_b, won_a, won_b, who)
    returning id into new_match;
  else
    -- The report's own sides and label, so the score reads the way it was
    -- entered rather than the way the fixture happened to be written.
    -- The games and lines go with it: a correction that left the old
    -- games behind would be a match whose score and replays disagree.
    update matches m
    set label = report_match.label,
        side_a = report_match.side_a,
        side_b = report_match.side_b,
        score_a = won_a,
        score_b = won_b,
        -- A played match is not a forfeit, whatever the row said before.
        -- Without this, a result filed over a DQ kept the flag and its games
        -- stayed out of the standings — the score changed and the table did
        -- not move.
        forfeit = false,
        edited_by = who
    where m.id = new_match;
    delete from match_lines where match_id = new_match;
    delete from games where match_id = new_match;
  end if;

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
      insert into game_lines (game_id, side, pokemon_id, kills, deaths, brought, revived, edited_by)
      values (new_game, 'a', l->>'pokemon_id',
              coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0),
              coalesce((l->>'brought')::boolean, false),
              coalesce((l->>'revived')::integer, 0), who);
    end loop;

    for l in select * from jsonb_array_elements(coalesce(g->'b', '[]'::jsonb)) loop
      insert into game_lines (game_id, side, pokemon_id, kills, deaths, brought, revived, edited_by)
      values (new_game, 'b', l->>'pokemon_id',
              coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0),
              coalesce((l->>'brought')::boolean, false),
              coalesce((l->>'revived')::integer, 0), who);
    end loop;
  end loop;

  return new_match;
end;
$$;
