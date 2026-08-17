-- Prices the picks that were made before there were prices.
--
-- `rosters.points` is what was paid at the time, and these were drafted while
-- the column did not exist, so they hold null and count as free — a team of
-- five reading 0/100. There is no earlier price to recover, so the board's
-- current one is the honest answer: it is what they would have cost had the
-- season been on points when they were taken.
--
-- Only where nothing was paid. A pick made after this has a real price on it
-- and re-pricing the board must not reach back and change what it cost.

update rosters r
   set points = b.points,
       edited_by = 'migration'
  from board b
 where b.season_id = r.season_id
   and b.pokemon_id = r.pokemon_id
   and r.points is null
   and b.points is not null;
