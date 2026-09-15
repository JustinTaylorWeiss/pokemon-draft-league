-- No cap on Megas.
--
-- 0020 gave Season 5 a limit of two, reasoning that being a Mega is a second
-- thing about a Pokémon and worth capping the way the Top tier was. 0022 then
-- took the tier limits away and put a hundred points in their place, and the
-- Mega cap stayed behind as the last count-based rule on a season that no longer
-- has any others.
--
-- It goes now. The league has priced the Megas itself, and the prices are the
-- cap: the dearest is 21 of a 100-point budget and a Mega-heavy team pays for it
-- in what it cannot afford elsewhere. A separate rule on top of that is a second
-- answer to a question the budget already answers.
--
-- Removing the key rather than setting it to zero or to some large number.
-- `tier_limits` means "what this season caps", and the site reads an absent
-- entry as no limit — a Mega row appears in My Team only where there is a cap to
-- show, so dropping the key takes the row with it.

update league_meta
   set tier_limits = coalesce(tier_limits, '{}'::jsonb) - 'Mega',
       edited_by = 'migration'
 where season_id = 'mega-mc';
