-- Remembering who is who on Showdown.
--
-- A replay names accounts, not league players. Storing the account against the
-- player means the mapping is asked for once and never again — the second
-- report from the same person fills itself in.

alter table players add column showdown_account text;

-- Accounts are matched case- and space-insensitively, the way Showdown treats
-- them, so "Officer Guppy" and "officerguppy" find the same person.
create unique index players_showdown_account_idx
  on players (lower(replace(showdown_account, ' ', '')))
  where showdown_account is not null;

/**
 * Finds the player behind a Showdown account, or null if nobody claims it.
 */
create or replace function player_for_account(account text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from players
  where showdown_account is not null
    and lower(replace(showdown_account, ' ', '')) = lower(replace(account, ' ', ''))
  limit 1;
$$;
