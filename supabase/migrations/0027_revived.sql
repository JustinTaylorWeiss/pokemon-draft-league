-- How many times a Pokemon was brought back after fainting.
--
-- Revival Blessing is the only thing that does it, and only Rabsca and Pawmot
-- learn it, so this column is 0 on almost every row that will ever exist. It
-- is here because the alternative is worse: a Pokemon that fainted, came back
-- and fainted again is stored as one death, which is the truth about the
-- season, and the game itself is then unreadable — its icon row would show a
-- team of four losing five Pokemon, or the same Pokemon knocked out once when
-- the replay knocked it out twice.
--
-- The parser already takes the undone knockout off both records: the death
-- comes off the Pokemon and the KO comes off whoever was credited with it, on
-- the grounds that a knockout that did not stick is not a knockout. This
-- keeps the count of how often that happened, so the match view can draw the
-- Pokemon once per life.

alter table game_lines add column revived integer not null default 0;

-- Nothing to backfill. Rows written before this column existed cannot say
-- whether a revive happened — the numbers a revive produces are the numbers a
-- game without one produces, which is the whole reason for the column — and
-- no row in the season has deaths above 1, so no revive has been recorded
-- wrongly either. 0 is both the default and the best available answer.

/**
 * Records a match, its games, and every Pokemon line, atomically.
 *
 * Replaces the 0015 version to carry `revived` through. Everything else is
 * unchanged: the series score is still counted here from the games rather
 * than accepted from the caller, and the whole report still lands in one
 * transaction or not at all.
 */
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
