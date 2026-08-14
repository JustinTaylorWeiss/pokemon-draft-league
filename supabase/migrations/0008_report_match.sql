-- Reporting a match in one piece.
--
-- Saving a report used to be four round trips: the match, its series lines,
-- then a row per game and a row per Pokemon in each game. PostgREST gives each
-- request its own transaction, so a failure part-way through left the earlier
-- writes standing — a match with no games under it, and an error message that
-- made it look as though nothing had been saved at all.
--
-- That is not hypothetical: two matches were reported before the `games` table
-- existed and are still in the database without it. They are correct as far as
-- they go, which is exactly what makes the failure mode nasty — nothing looks
-- broken.
--
-- A function body is a single transaction, so this either records the whole
-- report or none of it.

/**
 * Records a match, its games, and every Pokemon line, atomically.
 *
 * The series score is counted here from the games rather than accepted from the
 * caller. It is the same fact told twice otherwise, and the two could disagree.
 *
 * `games` is [{ number, winner, replay_url, survivors,
 *               a: [{ pokemon_id, kills, deaths }], b: [...] }]
 * `lines` is the series totals: [{ side, pokemon_id, kills, deaths }]
 */
create or replace function report_match(
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

  insert into matches (week, label, side_a, side_b, score_a, score_b, edited_by)
  values (week, label, side_a, side_b, won_a, won_b, who)
  returning id into new_match;

  for l in select * from jsonb_array_elements(lines) loop
    insert into match_lines (match_id, side, pokemon_id, kills, deaths, edited_by)
    values (
      new_match,
      l->>'side',
      l->>'pokemon_id',
      coalesce((l->>'kills')::integer, 0),
      coalesce((l->>'deaths')::integer, 0),
      who
    );
  end loop;

  for g in select * from jsonb_array_elements(games) loop
    insert into games (match_id, number, winner, replay_url, survivors, edited_by)
    values (
      new_match,
      (g->>'number')::integer,
      g->>'winner',
      g->>'replay_url',
      (g->>'survivors')::integer,
      who
    )
    returning id into new_game;

    for l in select * from jsonb_array_elements(coalesce(g->'a', '[]'::jsonb)) loop
      insert into game_lines (game_id, side, pokemon_id, kills, deaths, edited_by)
      values (new_game, 'a', l->>'pokemon_id',
              coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0), who);
    end loop;

    for l in select * from jsonb_array_elements(coalesce(g->'b', '[]'::jsonb)) loop
      insert into game_lines (game_id, side, pokemon_id, kills, deaths, edited_by)
      values (new_game, 'b', l->>'pokemon_id',
              coalesce((l->>'kills')::integer, 0), coalesce((l->>'deaths')::integer, 0), who);
    end loop;
  end loop;

  return new_match;
end;
$$;
