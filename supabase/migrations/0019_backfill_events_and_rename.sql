-- Gives the old log a season, and names the Mega season.
--
-- 0014 added `events.season_id` but only filled it going forward, so every
-- event written before the split — 13,164 of them — has none. They are all the
-- Test Season's: it was the only season that existed when they were written.
-- Left null they would vanish from the History tab the moment it filters by
-- season, which is a season's whole record disappearing to fix a duplicate.
--
-- The rename is a label change only. The id stays `mega-mc`: it is internal,
-- it appears nowhere on screen, and every other table points at it through a
-- foreign key that cascades on delete. Re-keying it to spell a nicer word is
-- not worth going anywhere near that.

update events set season_id = 'test' where season_id is null;

update seasons
   set label = 'Season 5', edited_by = 'migration'
 where id = 'mega-mc';

update league_meta
   set name = 'Season 5', edited_by = 'migration'
 where season_id = 'mega-mc';
