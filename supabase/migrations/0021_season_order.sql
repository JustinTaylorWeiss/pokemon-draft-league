-- Season 5 before the Test Season in the picker.
--
-- The test season is scaffolding — it exists to have something to build
-- against — so it belongs at the end rather than between the real ones.
-- `position` is what orders them; Season 4 is not here because it is read from
-- the spreadsheet and has no row.

update seasons set position = 1, edited_by = 'migration' where id = 'mega-mc';
update seasons set position = 2, edited_by = 'migration' where id = 'test';
