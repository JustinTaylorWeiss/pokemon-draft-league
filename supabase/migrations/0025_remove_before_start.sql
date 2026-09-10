-- Removing a player from a season that has not started deletes them.
--
-- Hiding was the right answer for a player with results: their matches stay,
-- the standings keep adding up, and undoing it is a click. Before the first
-- match there is nothing of theirs to keep — no fixture names them, no result
-- counts them — and hiding only leaves a row behind that has to be explained
-- every time the list is opened. So a season with no matches on record, played
-- or scheduled, removes for real.
--
-- "Started" is having a match. A fixture refers to its players by id with no
-- foreign key behind it, so from the moment one exists a deleted player would
-- leave it pointing at nobody; that is exactly the case hiding was made for,
-- and it stays that way. Draft picks are not results: a player removed before
-- the season takes their picks with them — rosters cascade, and the board's
-- claim is released — which is what removing them before the season means.
--
-- Nothing changes for a season that has started. Removal hides, as before.

-- The board's claim is a composite foreign key, and SET NULL on a composite
-- key nulls every column in it — the season id included, which is not
-- nullable. So deleting any player who held a claim has failed since 0014,
-- which nothing noticed because nothing deleted players. Narrowed to the one
-- column that should go. (`set null (column)` needs Postgres 15 or later.)
alter table board drop constraint board_drafted_by_fkey;
alter table board add constraint board_drafted_by_fkey
  foreign key (season_id, drafted_by) references players (season_id, id)
  on delete set null (drafted_by);

create or replace function remove_player(
  passphrase text, season text, player_id text, who text default 'anonymous'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target  players;
  started boolean;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  select exists (select 1 from matches m where m.season_id = season) into started;

  if started then
    update players set hidden = true, edited_by = who
     where id = remove_player.player_id and season_id = season
    returning * into target;

    if target.id is null then
      raise exception 'No player with id % in that season.', player_id using errcode = 'P0002';
    end if;
    return format('%s is now hidden. Their results are still on record.', target.name);
  end if;

  -- Their claims go back on the board first, stamped, so the board's own log
  -- says who released them rather than leaving it to the foreign key.
  update board set drafted_by = null, edited_by = who
   where season_id = season and drafted_by = remove_player.player_id;

  -- Stamped before the delete so the history records who did it: the delete
  -- trigger reads `edited_by` off the row on its way out.
  update players set edited_by = who
   where id = remove_player.player_id and season_id = season;

  delete from players p
   where p.id = remove_player.player_id and p.season_id = season
  returning * into target;

  if target.id is null then
    raise exception 'No player with id % in that season.', player_id using errcode = 'P0002';
  end if;
  return format('%s removed. Nothing had been recorded for them.', target.name);
end;
$$;
