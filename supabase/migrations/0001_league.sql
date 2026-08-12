-- Draft league schema.
--
-- Editing is open: there are no accounts and no login. What makes that safe is
-- not permissions but history — every change to every table is recorded by a
-- trigger, with the previous value, and can be reverted. See 0002_history.sql.
--
-- Deliberately absent: any operation that clears a week, resets a season, or
-- empties a table. Single-row corrections are supported and revertible; bulk
-- destruction is not offered at all, because an operation that does not exist
-- cannot be misused.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

-- One row, enforced by a primary key that can only ever hold `true`.
create table league_meta (
  id               boolean primary key default true check (id),
  name             text,
  regulation       text,
  format           text,
  weeks            integer,
  picks_per_player integer,
  series_length    text,
  tier_limits      jsonb not null default '{}'::jsonb,
  edited_by        text
);

create table players (
  id        text primary key,
  seed      integer not null,
  name      text not null,
  team      text,
  edited_by text
);

-- The draftable pool. `drafted_by` is the live claim; draft_picks is the record
-- of how it was claimed, and the two are kept in step by the app rather than by
-- a constraint, so a correction to one does not cascade into rewriting history.
create table board (
  pokemon_id text primary key,
  name       text not null,
  tier       text not null check (tier in ('Banned', 'Top', 'High', 'Mid', 'Low')),
  note       text,
  drafted_by text references players (id) on delete set null,
  base_stats jsonb,
  bst        integer,
  edited_by  text
);

create table rosters (
  player_id  text not null references players (id) on delete cascade,
  pokemon_id text not null,
  tier       text not null,
  edited_by  text,
  primary key (player_id, pokemon_id)
);

create table draft_picks (
  id         bigint generated always as identity primary key,
  round      integer not null,
  pick       integer not null,
  player_id  text not null references players (id) on delete cascade,
  pokemon_id text not null,
  tier       text not null,
  edited_by  text,
  unique (round, pick)
);

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------

-- A side is a list of player ids because this league plays 2v2 partners; a
-- single-player format is just an array of one.
create table matches (
  id        bigint generated always as identity primary key,
  week      integer not null,
  label     text,
  side_a    text[] not null default '{}',
  side_b    text[] not null default '{}',
  score_a   integer,
  score_b   integer,
  edited_by text
);

create index matches_week_idx on matches (week);

-- What each Pokemon did in a match. This is the complete record: standings and
-- per-Pokemon totals are derived from it rather than stored alongside it.
create table match_lines (
  id         bigint generated always as identity primary key,
  match_id   bigint not null references matches (id) on delete cascade,
  side       char(1) not null check (side in ('a', 'b')),
  pokemon_id text not null,
  kills      integer not null default 0 check (kills >= 0),
  deaths     integer not null default 0 check (deaths >= 0),
  edited_by  text
);

create index match_lines_match_idx on match_lines (match_id);
create index match_lines_pokemon_idx on match_lines (pokemon_id);

create table rules_sections (
  id        bigint generated always as identity primary key,
  position  integer not null,
  heading   text not null,
  items     jsonb not null default '[]'::jsonb,
  notes     text[] not null default '{}',
  edited_by text
);

-- ---------------------------------------------------------------------------
-- Draft state
-- ---------------------------------------------------------------------------

-- Starting a draft is the one action behind a passphrase, so it is a state flag
-- rather than anything that clears data. See 0003_gated.sql.
create table draft_state (
  id           boolean primary key default true check (id),
  status       text not null default 'not_started'
                 check (status in ('not_started', 'active', 'complete')),
  current_round integer,
  current_pick  integer,
  started_at    timestamptz,
  edited_by     text
);

insert into draft_state (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Derived standings
-- ---------------------------------------------------------------------------
--
-- Views, not tables. The spreadsheet stored standings next to the match log and
-- the two drifted apart — its per-Pokemon totals disagreed with the log it was
-- supposedly summarising. Deriving them means there is no second copy to drift,
-- nobody has to remember to update anything after entering a result, and the
-- two cannot disagree because there is only one of them.

-- One row per player per match, so both partners on a side get credited.
create view match_results as
  select
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
    m.id, m.week, unnest(m.side_b), m.score_b, m.score_a, 'b'::char(1)
  from matches m
  where m.score_a is not null and m.score_b is not null;

create view standings as
  select
    p.id                                                     as player_id,
    p.name,
    p.team,
    p.seed,
    count(r.match_id) filter (where r.games_won > r.games_lost)  as wins,
    count(r.match_id) filter (where r.games_won < r.games_lost)  as losses,
    coalesce(sum(r.games_won), 0)                            as games_won,
    coalesce(sum(r.games_lost), 0)                           as games_lost,
    coalesce(sum(r.games_won), 0) - coalesce(sum(r.games_lost), 0) as diff,
    -- A win is a point, which is how the league has always scored it.
    count(r.match_id) filter (where r.games_won > r.games_lost)  as points
  from players p
  left join match_results r on r.player_id = p.id
  group by p.id, p.name, p.team, p.seed;

create view pokemon_totals as
  select
    l.pokemon_id,
    count(distinct l.match_id)                      as games_played,
    sum(l.kills)                                    as kills,
    sum(l.deaths)                                   as deaths,
    sum(l.kills) - sum(l.deaths)                    as diff,
    round(sum(l.kills)::numeric / nullif(count(distinct l.match_id), 0), 2)
                                                    as kills_per_game
  from match_lines l
  group by l.pokemon_id;
