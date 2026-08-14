-- Which Pokemon were actually brought to a game.
--
-- Six are previewed and four are played, and the difference is not derivable
-- from the numbers already stored: a Pokemon that came in and neither scored
-- nor fainted reads 0/0, exactly like one that never left the bench. The replay
-- says which is which — it names every switch-in — so the parser records it and
-- this keeps it.
--
-- Not always four. A game that ends early can have three sent out, which is a
-- true statement about that game rather than missing data.

alter table game_lines add column brought boolean not null default false;

-- Rows written before this column existed get the best answer available from
-- what they do hold: anything that scored or fainted was certainly on the
-- field. This under-counts a Pokemon that was brought and did nothing, which
-- cannot be recovered without re-reading the replay.
update game_lines set brought = true where kills > 0 or deaths > 0;

/**
 * Records a match, its games, and every Pokemon line, atomically.
 *
 * Replaces the 0008 version to carry `brought` through. Everything else is
 * unchanged: the series score is still counted here from the games rather than
 * accepted from the caller, and the whole report still lands in one
 * transaction or not at all.
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
      new_match, l->>'side', l->>'pokemon_id',
      coalesce((l->>'kills')::integer, 0),
      coalesce((l->>'deaths')::integer, 0),
      who
    );
  end loop;

  for g in select * from jsonb_array_elements(games) loop
    insert into games (match_id, number, winner, replay_url, survivors, edited_by)
    values (
      new_match, (g->>'number')::integer, g->>'winner', g->>'replay_url',
      (g->>'survivors')::integer, who
    )
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
