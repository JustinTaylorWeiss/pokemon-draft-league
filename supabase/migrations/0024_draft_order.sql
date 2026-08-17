-- A randomised snake order, drawn when the draft opens.
--
-- Separate from `seed`, which is the league's own ordering of its players and
-- comes from the spreadsheet. This is the order they pick in, and it is drawn
-- fresh each time a draft opens rather than being an opinion anybody holds.
--
-- It orders and nothing more. Nobody is locked out of editing while it is not
-- their turn — whose turn it is is worth showing, not worth enforcing, and a
-- league that trades and re-picks between rounds would be fighting a lock.

alter table players add column draft_order integer;

comment on column players.draft_order is
  'Position in the snake draft, drawn at random when the draft opened. Null before then.';

/**
 * Opens the draft, and draws the order.
 *
 * Redrawn every time, so reopening a draft reshuffles rather than quietly
 * keeping an order somebody has already seen. Hidden players are left out — a
 * player who is not in the league does not pick — and left null rather than
 * numbered, so restoring one mid-draft does not silently insert them.
 */
create or replace function start_draft(passphrase text, season text, who text default 'anonymous')
returns draft_state
language plpgsql
security definer
set search_path = public
as $$
declare
  result draft_state;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  update players p
     set draft_order = drawn.position,
         edited_by = who
    from (
      select id, row_number() over (order by random()) as position
        from players
       where season_id = season and not hidden
    ) as drawn
   where p.id = drawn.id and p.season_id = season;

  insert into draft_state (season_id, status, current_round, current_pick, started_at, edited_by)
  values (season, 'active', 1, 1, now(), who)
  on conflict (season_id) do update
    set status = 'active', current_round = 1, current_pick = 1,
        started_at = now(), edited_by = who
  returning * into result;

  return result;
end;
$$;
