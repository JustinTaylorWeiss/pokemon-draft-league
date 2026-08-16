-- More than one season at a time.
--
-- Everything here was built for a single season: `league_meta` was one row
-- pinned to `id = true`, `draft_state` the same, and every other table simply
-- held "the" players, "the" board, "the" matches. That was right while there
-- was one, and stops being right the moment there are two.
--
-- Existing rows all belong to the season they were imported as. They are
-- stamped 'test' by the column default, so nothing has to be moved and the
-- season already there is untouched by this.
--
-- Player ids are slugs, so two seasons can both have a `nolan`. Identity is
-- therefore (season_id, id) rather than id, and everything that pointed at a
-- player now points at both halves. `matches.side_a` and `side_b` stay bare
-- id arrays — the season comes from the match they are on.

create table seasons (
  id         text primary key,
  label      text not null,
  /** Where it sits in the picker: newest first is not always right. */
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  edited_by  text
);

insert into seasons (id, label, position, edited_by)
values ('test', 'Test Season', 0, 'migration');

-- ---------------------------------------------------------------------------
-- Scope every table
-- ---------------------------------------------------------------------------

alter table league_meta    add column season_id text not null default 'test' references seasons (id) on delete cascade;
alter table players        add column season_id text not null default 'test' references seasons (id) on delete cascade;
alter table board          add column season_id text not null default 'test' references seasons (id) on delete cascade;
alter table rosters        add column season_id text not null default 'test' references seasons (id) on delete cascade;
alter table draft_picks    add column season_id text not null default 'test' references seasons (id) on delete cascade;
alter table matches        add column season_id text not null default 'test' references seasons (id) on delete cascade;
alter table rules_sections add column season_id text not null default 'test' references seasons (id) on delete cascade;
alter table draft_state    add column season_id text not null default 'test' references seasons (id) on delete cascade;

-- `match_lines`, `games` and `game_lines` are deliberately not scoped: they
-- hang off a match by a cascading key, so the match's season is theirs. A
-- second copy of that fact could disagree with the first.

-- ---------------------------------------------------------------------------
-- Re-key what used to be single-row or globally unique
-- ---------------------------------------------------------------------------

-- One settings row and one draft state per season, not one in total.
alter table league_meta drop constraint league_meta_pkey;
alter table league_meta drop column id;
alter table league_meta add primary key (season_id);

alter table draft_state drop constraint draft_state_pkey;
alter table draft_state drop column id;
alter table draft_state add primary key (season_id);

-- Players, and everything that names one.
alter table board       drop constraint board_drafted_by_fkey;
alter table rosters     drop constraint rosters_player_id_fkey;
alter table draft_picks drop constraint draft_picks_player_id_fkey;

alter table players drop constraint players_pkey;
alter table players add primary key (season_id, id);

alter table board       drop constraint board_pkey;
alter table board       add primary key (season_id, pokemon_id);
alter table board       add constraint board_drafted_by_fkey
  foreign key (season_id, drafted_by) references players (season_id, id) on delete set null;

alter table rosters     drop constraint rosters_pkey;
alter table rosters     add primary key (season_id, player_id, pokemon_id);
alter table rosters     add constraint rosters_player_id_fkey
  foreign key (season_id, player_id) references players (season_id, id) on delete cascade;

alter table draft_picks drop constraint draft_picks_round_pick_key;
alter table draft_picks add constraint draft_picks_round_pick_key unique (season_id, round, pick);
alter table draft_picks add constraint draft_picks_player_id_fkey
  foreign key (season_id, player_id) references players (season_id, id) on delete cascade;

-- The showdown account index was globally unique; one account can play in more
-- than one season.
drop index if exists players_showdown_account_idx;
create unique index players_showdown_account_idx
  on players (season_id, lower(replace(showdown_account, ' ', '')))
  where showdown_account is not null;

create index matches_season_idx     on matches (season_id, week);
create index board_season_idx       on board (season_id);
create index rosters_season_idx     on rosters (season_id, player_id);

-- ---------------------------------------------------------------------------
-- The derived views, per season
-- ---------------------------------------------------------------------------

drop view if exists standings;
drop view if exists match_results;
drop view if exists pokemon_totals;

create view match_results as
  select
    m.season_id,
    m.id                                            as match_id,
    m.week,
    unnest(m.side_a)                                as player_id,
    m.score_a                                       as games_won,
    m.score_b                                       as games_lost,
    'a'::char(1)                                    as side
  from matches m
  where m.score_a is not null and m.score_b is not null
  union all
  select
    m.season_id, m.id, m.week, unnest(m.side_b), m.score_b, m.score_a, 'b'::char(1)
  from matches m
  where m.score_a is not null and m.score_b is not null;

create view standings as
  select
    p.season_id,
    p.id                                                     as player_id,
    p.name,
    p.team,
    p.seed,
    count(r.match_id) filter (where r.games_won > r.games_lost)  as wins,
    count(r.match_id) filter (where r.games_won < r.games_lost)  as losses,
    coalesce(sum(r.games_won), 0)                            as games_won,
    coalesce(sum(r.games_lost), 0)                           as games_lost,
    coalesce(sum(r.games_won), 0) - coalesce(sum(r.games_lost), 0) as diff,
    count(r.match_id) filter (where r.games_won > r.games_lost)  as points
  from players p
  left join match_results r
    on r.player_id = p.id and r.season_id = p.season_id
  where not p.hidden
  group by p.season_id, p.id, p.name, p.team, p.seed;

create view pokemon_totals as
  select
    m.season_id,
    l.pokemon_id,
    count(distinct l.match_id)                      as games_played,
    sum(l.kills)                                    as kills,
    sum(l.deaths)                                   as deaths,
    sum(l.kills) - sum(l.deaths)                    as diff,
    round(sum(l.kills)::numeric / nullif(count(distinct l.match_id), 0), 2)
                                                    as kills_per_game
  from match_lines l
  join matches m on m.id = l.match_id
  group by m.season_id, l.pokemon_id;

-- ---------------------------------------------------------------------------
-- The log follows the season too
-- ---------------------------------------------------------------------------

alter table events add column season_id text;

/**
 * Logs a change, stamping the season it belongs to and what that season was
 * doing at the time.
 *
 * `draft_state` is per season now, so the old lookup — one row pinned to
 * `id = true` — no longer resolves, and every write through a trigger would
 * fail on it. The season comes off the row being written; the tables that have
 * none (`match_lines`, `games`, `game_lines`) hang off a match and take their
 * season from it rather than carrying a second copy.
 */
create or replace function log_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  key_data jsonb := '{}'::jsonb;
  key_col  text;
  who      text;
  stage    text;
  season   text;
begin
  row_data := to_jsonb(coalesce(new, old));

  foreach key_col in array tg_argv loop
    key_data := key_data || jsonb_build_object(key_col, row_data -> key_col);
  end loop;

  who := coalesce(nullif(row_data ->> 'edited_by', ''), 'anonymous');
  season := row_data ->> 'season_id';

  -- Rows that hang off a match take that match's season.
  if season is null and (row_data ? 'match_id') then
    select m.season_id into season from matches m where m.id = (row_data ->> 'match_id')::bigint;
  elsif season is null and (row_data ? 'game_id') then
    select m.season_id into season
    from games g join matches m on m.id = g.match_id
    where g.id = (row_data ->> 'game_id')::bigint;
  end if;

  if season is not null then
    select d.status into stage from draft_state d where d.season_id = season;
  end if;

  if tg_op = 'INSERT' then
    insert into events (actor, action, table_name, row_key, before, after, phase, season_id)
    values (who, 'insert', tg_table_name, key_data, null, to_jsonb(new), stage, season);
    return new;

  elsif tg_op = 'UPDATE' then
    -- An update that changed nothing but `edited_by` is not worth a row.
    if to_jsonb(new) - 'edited_by' = to_jsonb(old) - 'edited_by' then
      return new;
    end if;
    insert into events (actor, action, table_name, row_key, before, after, phase, season_id)
    values (who, 'update', tg_table_name, key_data, to_jsonb(old), to_jsonb(new), stage, season);
    return new;

  else
    insert into events (actor, action, table_name, row_key, before, after, phase, season_id)
    values (coalesce(nullif(old.edited_by, ''), 'anonymous'),
            'delete', tg_table_name, key_data, to_jsonb(old), null, stage, season);
    return old;
  end if;
end;
$$;
