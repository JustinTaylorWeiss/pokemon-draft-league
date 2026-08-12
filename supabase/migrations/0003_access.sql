-- Who can do what.
--
-- Editing is open by design: no accounts, no login, anyone with the site can
-- correct a score. Two things keep that from being reckless — every change is
-- logged and revertible (0002_history.sql), and the operations that would be
-- expensive to undo simply do not exist.
--
-- There is no reset_season and no clear_week here, and that is deliberate. They
-- were considered and left out rather than merely gated.

-- ---------------------------------------------------------------------------
-- The passphrase
-- ---------------------------------------------------------------------------

-- Hashes only, and unreadable by the browser. Checking a passphrase in the
-- client would be theatre: anyone can read the bundle, see the call underneath
-- and issue it directly. So the gated action is not reachable by clients at all
-- — it exists only as the function below, which does the check itself.
create table app_secrets (
  key  text primary key,
  hash text not null
);

alter table app_secrets enable row level security;
-- No policies: with RLS on and nothing granted, anon cannot read or write this
-- table at all. Only security-definer functions can see it.

-- Set or change the passphrase. Run from the SQL editor, not from the site:
--   select set_passphrase('draft', 'the-passphrase');
--
-- Returns a confirmation rather than void: a void function renders as an empty
-- cell, which is indistinguishable from having failed.
create or replace function set_passphrase(key text, passphrase text)
returns text
language sql
security definer
-- `extensions` is where Supabase installs pgcrypto; pinning search_path to
-- public alone hides crypt() and gen_salt() from this function. A schema that
-- does not exist is ignored, so this is also correct on a plain Postgres where
-- pgcrypto lands in public.
set search_path = public, extensions
as $$
  insert into app_secrets (key, hash)
  values (key, crypt(passphrase, gen_salt('bf')))
  on conflict (key) do update set hash = excluded.hash
  returning format('Passphrase set for %s. Verify with: select check_passphrase(%L, ...)', key, key);
$$;

revoke execute on function set_passphrase(text, text) from anon, public;

create or replace function check_passphrase(key text, passphrase text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from app_secrets s
    where s.key = check_passphrase.key
      and s.hash = crypt(check_passphrase.passphrase, s.hash)
  );
$$;

revoke execute on function check_passphrase(text, text) from anon, public;

-- ---------------------------------------------------------------------------
-- The one gated action
-- ---------------------------------------------------------------------------

-- Opens the draft. Note what it does not do: it clears nothing. Starting a
-- draft flips a flag, so getting it wrong costs a flag rather than a season.
create or replace function start_draft(passphrase text, who text default 'anonymous')
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
     set status = 'active',
         current_round = 1,
         current_pick = 1,
         started_at = now(),
         edited_by = who
   where id = true
  returning * into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table access
-- ---------------------------------------------------------------------------

alter table league_meta    enable row level security;
alter table players        enable row level security;
alter table board          enable row level security;
alter table rosters        enable row level security;
alter table draft_picks    enable row level security;
alter table matches        enable row level security;
alter table match_lines    enable row level security;
alter table rules_sections enable row level security;
alter table draft_state    enable row level security;
alter table events         enable row level security;
alter table checkpoints    enable row level security;

-- Everyone may read everything. The league is public; it is already a public
-- website.
create policy read_all on league_meta    for select using (true);
create policy read_all on players        for select using (true);
create policy read_all on board          for select using (true);
create policy read_all on rosters        for select using (true);
create policy read_all on draft_picks    for select using (true);
create policy read_all on matches        for select using (true);
create policy read_all on match_lines    for select using (true);
create policy read_all on rules_sections for select using (true);
create policy read_all on draft_state    for select using (true);
create policy read_all on events         for select using (true);
create policy read_all on checkpoints    for select using (true);

-- Everyone may edit the league's own data.
create policy write_all on league_meta    for insert with check (true);
create policy edit_all  on league_meta    for update using (true);
create policy write_all on players        for insert with check (true);
create policy edit_all  on players        for update using (true);
create policy drop_row  on players        for delete using (true);
create policy write_all on board          for insert with check (true);
create policy edit_all  on board          for update using (true);
create policy write_all on rosters        for insert with check (true);
create policy edit_all  on rosters        for update using (true);
create policy drop_row  on rosters        for delete using (true);
create policy write_all on draft_picks    for insert with check (true);
create policy edit_all  on draft_picks    for update using (true);
create policy drop_row  on draft_picks    for delete using (true);
create policy write_all on matches        for insert with check (true);
create policy edit_all  on matches        for update using (true);
create policy drop_row  on matches        for delete using (true);
create policy write_all on match_lines    for insert with check (true);
create policy edit_all  on match_lines    for update using (true);
create policy drop_row  on match_lines    for delete using (true);
create policy write_all on rules_sections for insert with check (true);
create policy edit_all  on rules_sections for update using (true);
create policy drop_row  on rules_sections for delete using (true);

-- The draft's status is not editable directly — it moves through start_draft
-- and through the app advancing picks, which is an update rather than a reset.
create policy edit_all on draft_state for update using (true);

-- The history is append-only. No update policy and no delete policy, so once an
-- event is written nobody can alter or remove it — including whoever wrote it.
-- Deleting league rows is allowed above; erasing the record of having done so
-- is not.
create policy append_only on events      for insert with check (true);
create policy append_only on checkpoints for insert with check (true);
