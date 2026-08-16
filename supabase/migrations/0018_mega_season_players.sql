-- Puts the league into the Mega season.
--
-- `players` and `draft_state` are the two tables with no insert policy at all:
-- a player may only arrive through `add_player`, behind the passphrase, and a
-- draft may only open through `start_draft`. That is deliberate and stays.
--
-- It does mean the seeding script cannot copy the league across, since it holds
-- only the browser's key. Copying it here keeps the passphrase out of a script
-- that has no other need for it.
--
-- Everything else about the season — its board, its rules, its settings — goes
-- in through the ordinary policies, and `scripts/seed-mega-season.mjs` does it.

insert into players (season_id, id, seed, name, team, showdown_account, hidden, edited_by)
select 'mega-mc', p.id, p.seed, p.name, p.team, p.showdown_account, false, 'migration'
  from players p
 where p.season_id = 'test'
   and not p.hidden
on conflict (season_id, id) do nothing;

-- Not started: the board is provisional until the league has priced the Megas,
-- and a draft that opens before then would be drafting from a guess.
insert into draft_state (season_id, status, current_round, current_pick, edited_by)
values ('mega-mc', 'not_started', null, null, 'migration')
on conflict (season_id) do nothing;
