-- Reporting a match fills the fixture that was already on the schedule.
--
-- `report_match` always inserted. So a week scheduled in advance ended up
-- with two rows for every game played: the blank fixture nobody could now
-- remove, and the reported match sitting on top of it. Week 1 of Mega M-C
-- had five such pairs and the Matches tab counted thirteen matches where
-- eight were played.
--
-- Now it looks first. A fixture in the same season and week, between the
-- same two sides, with no result on it, is the row this result belongs in.
-- Where there is none — an unscheduled match, or a rematch in a week whose
-- fixture is already filled — it inserts as before.
--
-- The five pairs already made were cleared by hand before this ran, so
-- there is nothing here to clean up: this only changes what happens next.

-- Sides are stored in the order they were entered, and a report can name
-- them the other way round from the schedule. Compared as sets.
create or replace function sorted_ids(ids text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(x order by x), '{}'::text[]) from unnest(ids) as x;
$$;

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

  -- The fixture this is the result of, if it was scheduled. Either way
  -- round: whoever reports it may not name the sides as the schedule did.
  select m.id into new_match
  from matches m
  where m.season_id = season
    and m.week = report_match.week
    and m.score_a is null
    and m.score_b is null
    and not exists (select 1 from games gg where gg.match_id = m.id)
    and (
      (sorted_ids(m.side_a) = sorted_ids(report_match.side_a)
        and sorted_ids(m.side_b) = sorted_ids(report_match.side_b))
      or
      (sorted_ids(m.side_a) = sorted_ids(report_match.side_b)
        and sorted_ids(m.side_b) = sorted_ids(report_match.side_a))
    )
  order by m.id
  limit 1;

  if new_match is null then
    insert into matches (season_id, week, label, side_a, side_b, score_a, score_b, edited_by)
    values (season, week, label, side_a, side_b, won_a, won_b, who)
    returning id into new_match;
  else
    -- The report's own sides and label, so the score reads the way it was
    -- entered rather than the way the fixture happened to be written.
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
