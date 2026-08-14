-- The individual games inside a match.
--
-- A match is a best-of-three and until now only its series score was kept: 2-1,
-- with one set of per-Pokemon totals covering all three games. That is enough
-- for standings and nothing else. Anyone asking "what actually happened in game
-- two" had to open the replay, if they still had the link.
--
-- Replays already carry this — the reporting form parses each game separately
-- and then adds them up. These tables keep what it was throwing away.
--
-- `match_lines` stays as it is. It holds the series total, it is what
-- `pokemon_totals` and the stats tab read, and a season imported from the
-- spreadsheet has it without having any replays to break down. For a match
-- reported from replays the series totals are the sum of the game lines; for an
-- imported one there are no game lines at all, and both are valid states.

create table games (
  id         bigint generated always as identity primary key,
  match_id   bigint not null references matches (id) on delete cascade,
  -- 1, 2, 3 — the order they were played, not the order they were pasted.
  number     integer not null check (number > 0),
  -- Which side of the *match* won, so it reads the same way as score_a/score_b
  -- even though Showdown seats the players either way round between games.
  winner     char(1) check (winner in ('a', 'b')),
  replay_url text,
  -- How many Pokemon the winner still had standing.
  survivors  integer,
  edited_by  text,
  unique (match_id, number)
);

create table game_lines (
  id         bigint generated always as identity primary key,
  game_id    bigint not null references games (id) on delete cascade,
  side       char(1) not null check (side in ('a', 'b')),
  pokemon_id text not null,
  kills      integer not null default 0,
  deaths     integer not null default 0,
  edited_by  text,
  unique (game_id, side, pokemon_id)
);

create index game_lines_game_idx on game_lines (game_id);
create index games_match_idx on games (match_id);

-- Same history treatment as everything else: every change logged, revertible.
create trigger log_games after insert or update or delete on games
  for each row execute function log_event('id');
create trigger log_game_lines after insert or update or delete on game_lines
  for each row execute function log_event('id');

alter table games      enable row level security;
alter table game_lines enable row level security;

create policy read_all on games      for select using (true);
create policy read_all on game_lines for select using (true);
create policy write_all on games      for insert with check (true);
create policy edit_all  on games      for update using (true);
create policy drop_row  on games      for delete using (true);
create policy write_all on game_lines for insert with check (true);
create policy edit_all  on game_lines for update using (true);
create policy drop_row  on game_lines for delete using (true);
