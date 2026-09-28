-- Diff in the standings is the Pokémon differential the rules describe.
--
-- The view has been subtracting games lost from games won since 0001, under
-- a column the site labels "Pokémon remaining differential" and reads into a
-- field called `monDiff`. Three names for one number and none of them was
-- what the number was.
--
-- Section 5 of the league's own rules:
--
--   If standings are tied, the tiebreaker is Pokémon Differential: total
--   Pokémon remaining alive on your team's winning games minus the
--   opponent's remaining Pokémon on their winning games, summed across
--   the season.
--
-- Which is what `games.survivors` has been recording all along — the Mons
-- Left of whoever won that game — and nothing was reading. Every game this
-- season has it. Season 4 is frozen in league.json with the sheet's own
-- differential, which was always the real one; this brings Season 5 into
-- line with it rather than changing what the column means.
--
-- It is a tiebreaker, so the order of the table changes with it: four
-- coaches move from +1/+2 to +3, and Nolan and Bargus from ±1 to level.

-- One row per coach per season: a game they won pays them its survivors,
-- and a game they lost pays their opponent the same.
--
-- Aggregated apart from `standings` rather than joined into it, because
-- `match_results` is already one row per coach per match — joining games
-- onto that and then summing would count each match's games once per
-- coach per row and quietly double every total in a doubles pairing.
create or replace view player_mon_diff as
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

-- Replaced, not dropped and rebuilt: the column list is unchanged, so
-- anything selecting from it keeps working and nothing has to be granted
-- again.
create or replace view standings as
  select
    p.season_id,
    p.id                                                     as player_id,
    p.name,
    p.team,
    p.seed,
    count(r.match_id) filter (where r.games_won > r.games_lost)  as wins,
    count(r.match_id) filter (where r.games_won < r.games_lost)  as losses,
    coalesce(sum(r.games_won), 0)                            as games_won,
    coalesce(sum(r.games_lost), 0)                           as games_lost,
    coalesce(d.mon_diff, 0)                                  as diff,
    count(r.match_id) filter (where r.games_won > r.games_lost)  as points
  from players p
  left join match_results r
    on r.player_id = p.id and r.season_id = p.season_id
  left join player_mon_diff d
    on d.player_id = p.id and d.season_id = p.season_id
  where not p.hidden
  group by p.season_id, p.id, p.name, p.team, p.seed, d.mon_diff;
