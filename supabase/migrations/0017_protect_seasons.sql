-- Makes a season impossible to delete from the browser.
--
-- 0014 added `seasons` and gave it no row-level security, which left it the one
-- table in the schema anybody could write to freely. That would have been a
-- small mistake on its own. It was not, because every other table references it
-- with `on delete cascade`: a single DELETE against one row of this table took
-- 2,925 rows across eleven tables with it, which is exactly what happened on
-- 2026-08-16. 0016 put them back.
--
-- The rule this project already had — that no operation may clear a week, reset
-- a season, or empty a table — was written for the functions. It was never
-- enforced here, and a cascading foreign key is an operation like any other.
--
-- So: seasons can be read by anyone, created behind the passphrase, and deleted
-- by nobody. There is deliberately no `delete_season` in this file and there
-- should not be one in any later file. Removing a season is not a thing the
-- site does.

alter table seasons enable row level security;

drop policy if exists read_all on seasons;
create policy read_all on seasons for select using (true);

-- No insert, update or delete policy. With row-level security on, the absence
-- of a policy is the refusal — `create_season` below is the only way in, and it
-- is `security definer`, so it is not bound by this.
--
-- The grants are then narrowed to match, rather than left to whatever the
-- project hands new tables by default. Two independent things now have to be
-- wrong for this to happen again, and the table it protects is the one the
-- whole schema cascades from.
--
-- Written role by role because a plain Postgres — which is what the migrations
-- are tested against — has no `authenticated`, and naming a role that is not
-- there fails the whole file.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on seasons from %I', r);
      execute format('grant select on seasons to %I', r);
    end if;
  end loop;
end $$;

/**
 * Creates an empty season.
 *
 * Gated like every other structural change. Seeding a season's contents —
 * board, players, rules — goes through the ordinary insert policies once the
 * season exists; this only creates the thing they hang off.
 */
create or replace function create_season(
  passphrase text,
  id text,
  label text,
  -- Not `position`: that is a function in Postgres, and a parameter by that
  -- name will not parse.
  place integer default 0,
  who text default 'anonymous'
)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  result seasons;
begin
  if not check_passphrase('draft', passphrase) then
    raise exception 'That passphrase is not right.' using errcode = '28000';
  end if;

  id := btrim(regexp_replace(lower(id), '[^a-z0-9]+', '-', 'g'), '-');
  if id = '' then
    raise exception 'A season needs an id.' using errcode = '22023';
  end if;
  if exists (select 1 from seasons s where s.id = create_season.id) then
    raise exception 'There is already a season called %.', id using errcode = '23505';
  end if;

  insert into seasons (id, label, position, edited_by)
  values (id, coalesce(nullif(btrim(label), ''), id), place, who)
  returning * into result;

  return result;
end;
$$;

-- The Mega season, created here rather than by the seeding script: with the
-- table closed, the script has no way to make one, and giving it the passphrase
-- to do so would put the passphrase in a place it does not need to be. The
-- script fills this in.
insert into seasons (id, label, position, edited_by)
values ('mega-mc', 'Mega Season — Reg M-C', 1, 'migration')
on conflict (id) do nothing;
