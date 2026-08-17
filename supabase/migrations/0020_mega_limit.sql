-- Two Megas to a team.
--
-- Season 5 drafts Megas apart from the Pokémon they evolve from, so a Mega
-- takes a pick like anything else and carries its own tier. Being a Mega is a
-- second thing about it, though, and the league caps that separately — the same
-- way it allows only two from the Top tier.
--
-- Stored beside the tier limits rather than in code, so a season that has no
-- Megas has no Mega limit and the site simply does not show the row. `Mega` is
-- not a tier and never appears in `board.tier`; it only ever names a cap.

update league_meta
   set tier_limits = coalesce(tier_limits, '{}'::jsonb) || '{"Mega": 2}'::jsonb,
       edited_by = 'migration'
 where season_id = 'mega-mc';
