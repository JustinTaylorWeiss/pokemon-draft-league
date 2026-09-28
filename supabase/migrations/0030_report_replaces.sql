-- Reporting a match twice replaces it instead of adding a second row.
--
-- 0028 taught `report_match` to fill a blank scheduled fixture, and that
-- works. What it did not cover is the report landing on a week that has
-- already been reported: the fixture is no longer blank, so the lookup
-- skipped it and inserted, which is the same duplicate by another route.
--
-- It happened within the day. Hunter reported Lennart / Pr3dixtion vs
-- Sean SWJF at 16:12 and it filled the Week 1 fixture correctly. Sean
-- reported the same series at 16:49, found nothing blank to fill, and got
-- a second row at the end of the table.
--
-- Two coaches play one series in a week, so a second report of the same
-- pairing in the same week is that series again, not another one. It now
-- goes into the row that is already there — which is also the only way to
-- fix a report, there being no other edit path: you report it again.
--
-- What it costs: a report can overwrite one somebody else entered. That is
-- the same trade the rest of the site makes — the event log has the old
-- row with its score and its games and can put it back — and the report
-- screen asks first when it can see a result already there.

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
