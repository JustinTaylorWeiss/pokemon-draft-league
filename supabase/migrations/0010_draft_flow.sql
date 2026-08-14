-- Running a draft.
--
-- Two things happen here: the draft opens and closes, and Pokemon get claimed
-- and released while it is open.
--
-- Opening and closing are gated, like starting one always was. Claiming is not
-- — the whole point is that twenty people do it themselves — but it is
-- transactional, because a claim touches two tables and half a claim is worse
-- than none.
--
-- Nothing here clears a roster or resets a draft. Closing sets a flag.

/**
 * Closes the draft. Clears nothing — the rosters are the season.
 */
create or replace function end_draft(passphrase text, who text default 'anonymous')
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

  update draft_state
     set status = 'complete', edited_by = who
   where id = true
  returning * into result;

  return result;
end;
$$;

/**
 * Claims a Pokemon for a player.
 *
 * The roster row and the board's claim are one fact written in two places, so
 * they are written together. Refuses a Pokemon somebody else already holds —
 * that check and the write have to be in the same transaction or two people
 * picking at once can both pass it.
 */
create or replace function claim_pokemon(
  player_id text,
  pokemon_id text,
  who text default 'anonymous'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  taken text;
  tier  text;
begin
  -- Locks the row for the rest of this transaction, so a simultaneous claim
  -- waits here rather than reading the same "free" and both proceeding.
  select b.drafted_by, b.tier into taken, tier
  from board b where b.pokemon_id = claim_pokemon.pokemon_id
  for update;

  if not found then
    raise exception 'There is no % on the board.', pokemon_id using errcode = 'P0002';
  end if;
  if tier = 'Banned' then
    raise exception 'That Pokémon is banned.' using errcode = '22023';
  end if;
  if taken is not null and taken <> claim_pokemon.player_id then
    raise exception 'Already drafted by %.',
      (select name from players where id = taken) using errcode = '23505';
  end if;

  -- Named by constraint rather than by columns: the parameters are called
  -- player_id and pokemon_id too, and an `on conflict (player_id, ...)` clause
  -- cannot be qualified, so Postgres cannot tell which one is meant.
  insert into rosters (player_id, pokemon_id, tier, edited_by)
  values (claim_pokemon.player_id, claim_pokemon.pokemon_id, tier, who)
  on conflict on constraint rosters_pkey do nothing;

  update board set drafted_by = claim_pokemon.player_id, edited_by = who
  where board.pokemon_id = claim_pokemon.pokemon_id;

  return format('%s drafted.', (select name from board where board.pokemon_id = claim_pokemon.pokemon_id));
end;
$$;

/**
 * Gives a Pokemon back. Only ever releases that player's own claim.
 */
create or replace function release_pokemon(
  player_id text,
  pokemon_id text,
  who text default 'anonymous'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  gone integer;
begin
  delete from rosters r
  where r.player_id = release_pokemon.player_id
    and r.pokemon_id = release_pokemon.pokemon_id;
  get diagnostics gone = row_count;

  if gone = 0 then
    raise exception 'That is not on their roster.' using errcode = 'P0002';
  end if;

  update board set drafted_by = null, edited_by = who
  where board.pokemon_id = release_pokemon.pokemon_id
    and board.drafted_by = release_pokemon.player_id;

  return format('%s released.', (select name from board where board.pokemon_id = release_pokemon.pokemon_id));
end;
$$;
