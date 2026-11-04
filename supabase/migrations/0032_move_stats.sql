-- What each Pokemon clicked, and what came of it.
--
-- The reader has always thrown the moves away: it walked the log for
-- knockouts and nothing else, so 2300 `|move|` lines across this season went
-- unread and a match could say who fainted but not what did it.
--
-- Held as JSON on the game line rather than as a table of its own. It is
-- four numbers per move and never queried across matches — the match view
-- reads a game's lines and renders what is there — so a column keeps it
-- beside the Pokemon it belongs to and spares the join. Shape:
--
--   [{ "name": "Heat Wave", "used": 2, "kos": 2, "damage": 142 }, ...]
--
-- `damage` is percentage points of the targets' health, which is how the
-- log reports it. It adds across targets, so a spread move that takes half
-- off each of two reads 100, and only the other side counts.
--
-- Empty for every row already stored. Re-reporting a match fills it in, and
-- the match view says so rather than drawing an empty table.

alter table game_lines add column if not exists moves jsonb not null default '[]'::jsonb;

comment on column game_lines.moves is
  'Moves this Pokemon used in this game: [{name, used, kos, damage}]. Damage is percentage points.';

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
      insert into game_lines (game_id, side, pokemon_id, kills, deaths, brought, revived, moves, edited_by)
      values (new_game, 'a', l->>'pokemon_id',
              coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0),
              coalesce((l->>'brought')::boolean, false),
              coalesce((l->>'revived')::integer, 0),
              coalesce(l->'moves', '[]'::jsonb), who);
    end loop;

    for l in select * from jsonb_array_elements(coalesce(g->'b', '[]'::jsonb)) loop
      insert into game_lines (game_id, side, pokemon_id, kills, deaths, brought, revived, moves, edited_by)
      values (new_game, 'b', l->>'pokemon_id',
              coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0),
              coalesce((l->>'brought')::boolean, false),
              coalesce((l->>'revived')::integer, 0),
              coalesce(l->'moves', '[]'::jsonb), who);
    end loop;
  end loop;

  return new_match;
end;
$$;
