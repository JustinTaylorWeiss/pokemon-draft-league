-- A Pokemon that was never revealed was never counted as surviving.
--
-- `games.survivors` is the Mons Left the rules' Pokemon Differential is
-- summed from, and the reader worked it out as "how many came out, less how
-- many fainted". A side that won a game having only ever shown two of the
-- four it brought therefore read as two left standing when it had four: the
-- two that never came out had never fainted either, and were simply missing
-- from the count.
--
-- Twenty-one of this season's 228 games are short by one or two that way,
-- which moves the tiebreaker the standings are ordered on.
--
-- The reader is fixed to count off the bring — every replay this season
-- opens with `|teampreview|4`, which is the only place the bring is stated —
-- and this brings the games already stored into line without re-reporting
-- them, which would delete and re-create every game and every line under it.
--
-- The bring is worked out from the lines rather than assumed to be four: a
-- game ends when one side has nothing left standing, so the number of the
-- losing side that are down IS what both sides brought. Where a game ended
-- some other way and the loser was not wiped, the winner's own revealed
-- count stands in, which is what the reader used to use and can only be an
-- undercount rather than a guess.

-- What would change. Run this first; it writes nothing.
--
--   select g.id, g.number, g.survivors as stored, b.bring - b.down as fixed,
--          g.replay_url
--   from games g
--   join lateral (
--     select
--       greatest(
--         count(*) filter (
--           where l.side <> g.winner and l.deaths > l.revived),
--         count(*) filter (
--           where l.side = g.winner and (coalesce(l.brought, false) or l.deaths > 0))
--       ) as bring,
--       count(*) filter (where l.side = g.winner and l.deaths > l.revived) as down
--     from game_lines l where l.game_id = g.id
--   ) b on true
--   where g.winner in ('a', 'b')
--     and g.survivors is distinct from b.bring - b.down
--   order by g.id;

update games g
set survivors = greatest(0, b.bring - b.down)
from (
  select
    l.game_id,
    greatest(
      count(*) filter (where l.side <> gg.winner and l.deaths > l.revived),
      count(*) filter (
        where l.side = gg.winner and (coalesce(l.brought, false) or l.deaths > 0))
    ) as bring,
    count(*) filter (where l.side = gg.winner and l.deaths > l.revived) as down
  from game_lines l
  join games gg on gg.id = l.game_id
  where gg.winner in ('a', 'b')
  -- `gg.winner` is read inside the filters, so it is grouped by as well:
  -- grouping on `l.game_id` alone leaves it neither grouped nor aggregated.
  group by l.game_id, gg.winner
) b
where b.game_id = g.id
  and g.winner in ('a', 'b')
  and g.survivors is distinct from greatest(0, b.bring - b.down);

-- Nothing else to change: `player_mon_diff` reads `games.survivors` and the
-- standings read that, so both pick this up on the next query.
