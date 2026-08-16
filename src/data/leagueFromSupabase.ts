import { currentSeasonId, db } from './supabase'
import type { Game, League, Match, MatchStat, Player, Standing } from './league'

/**
 * Assembles a League from the database.
 *
 * Deliberately returns the same shape the spreadsheet importer produces, so
 * every view renders a database-backed season without knowing one exists. The
 * seams are here and nowhere else.
 */

interface BoardRow {
  pokemon_id: string
  name: string
  tier: string
  note: string | null
  drafted_by: string | null
  base_stats: Record<string, number> | null
  bst: number | null
}

interface MatchRow {
  id: number
  week: number
  label: string | null
  side_a: string[]
  side_b: string[]
  score_a: number | null
  score_b: number | null
}

interface LineRow {
  match_id: number
  side: 'a' | 'b'
  pokemon_id: string
  kills: number
  deaths: number
}

interface GameRow {
  id: number
  match_id: number
  number: number
  winner: 'a' | 'b' | null
  replay_url: string | null
  survivors: number | null
}

interface GameLineRow {
  game_id: number
  side: 'a' | 'b'
  pokemon_id: string
  kills: number
  deaths: number
  brought: boolean
}

interface StandingRow {
  player_id: string
  name: string
  team: string | null
  wins: number
  losses: number
  games_won: number
  games_lost: number
  diff: number
  points: number
}

/**
 * PostgREST answers a plain select with at most a thousand rows, and says so
 * only in a header nobody reads. Past that it simply stops, so a league quietly
 * loses its newest games rather than failing — which is how `game_lines` came
 * to be missing everything after row 1000 while every query looked fine.
 *
 * `limit` does not lift it and neither does a Range header; the cap is set on
 * the server. Paging is the only way to read a table whole.
 */
const PAGE = 1000

/** Reads one season's worth of a table, whole. */
async function readAll(table: string, ...order: string[]) {
  return readWhere(table, { eq: ['season_id', currentSeasonId()] }, order)
}

/**
 * Reads rows belonging to a set of parent ids.
 *
 * `match_lines`, `games` and `game_lines` carry no season of their own — they
 * hang off a match, and that match's season is theirs. So they are fetched by
 * the ids of the matches this season actually has, rather than by a column.
 *
 * The ids are sent in batches because they travel in the URL, and a long season
 * would otherwise build a query string longer than the server will accept.
 */
const IDS_PER_QUERY = 300

async function readBy(table: string, column: string, ids: number[], ...order: string[]) {
  if (!ids.length) return { data: [] as unknown[], error: null }
  const rows: unknown[] = []
  for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
    const batch = ids.slice(i, i + IDS_PER_QUERY)
    const got = await readWhere(table, { in: [column, batch] }, order)
    if (got.error) return { data: rows, error: got.error }
    rows.push(...got.data)
  }
  return { data: rows, error: null }
}

/**
 * The one condition a read is narrowed by, as data rather than as a callback:
 * the query builder's type is not nameable here without generated database
 * types, and a function taking one cannot be written down.
 */
type Where = { eq: [string, string] } | { in: [string, number[]] }

async function readWhere(table: string, where: Where, order: string[]) {
  const rows: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const base = db.from(table).select('*')
    let query = ('eq' in where ? base.eq(...where.eq) : base.in(...where.in))
      .range(from, from + PAGE - 1)
    for (const col of order) query = query.order(col)
    const { data, error } = await query
    if (error) return { data: rows, error }
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE) return { data: rows, error: null }
  }
}

/** Every table in one round trip each, in parallel. */
export async function loadLeagueFromSupabase(): Promise<League> {
  const season = currentSeasonId()

  const [meta, players, board, rosters, matches, standings, rules] =
    await Promise.all([
      db.from('league_meta').select('*').eq('season_id', season).maybeSingle(),
      readAll('players', 'seed'),
      readAll('board'),
      readAll('rosters'),
      readAll('matches', 'week', 'id'),
      readAll('standings'),
      readAll('rules_sections', 'position'),
    ])

  const firstError = [meta, players, board, rosters, matches, standings, rules]
    .find((r) => r.error)?.error
  if (firstError) throw firstError

  // Only now is it known which matches are this season's, and everything below
  // a match is found through them.
  const matchIds = ((matches.data ?? []) as { id: number }[]).map((m) => m.id)
  const [lines, games] = await Promise.all([
    readBy('match_lines', 'match_id', matchIds, 'id'),
    readBy('games', 'match_id', matchIds, 'match_id', 'number'),
  ])
  const gameLines = await readBy(
    'game_lines', 'game_id', ((games.data ?? []) as { id: number }[]).map((g) => g.id), 'id',
  )

  const belowError = [lines, games, gameLines].find((r) => r.error)?.error
  if (belowError) throw belowError

  // Hidden players are removed from the league, not from the record. They stay
  // in this list so their name still resolves in matches they already played —
  // a past result should read "beat Nolan", not "beat nolan" — but they are
  // kept out of everything the site presents as the current league.
  const allPlayers = (players.data ?? []) as (Player & { hidden?: boolean })[]
  const playerRows = allPlayers.filter((p) => !p.hidden)
  // The board and the stats tab name people; the database references them by id.
  const nameById = new Map(allPlayers.map((p) => [p.id, p.name]))
  const visible = new Set(playerRows.map((p) => p.id))

  const boardRows = (board.data ?? []) as BoardRow[]
  const matchRows = (matches.data ?? []) as MatchRow[]
  const lineRows = (lines.data ?? []) as LineRow[]

  const linesByMatch = new Map<number, LineRow[]>()
  for (const l of lineRows) {
    const list = linesByMatch.get(l.match_id)
    if (list) list.push(l)
    else linesByMatch.set(l.match_id, [l])
  }

  const sideLabel = (ids: string[]) =>
    ids.map((id) => nameById.get(id) ?? id).join(' / ')

  // Games are only there for matches reported from replays; older and imported
  // matches simply have none, which the views treat as "no breakdown", not as
  // a match with zero games.
  const gameRows = (games.data ?? []) as GameRow[]
  const gameLineRows = (gameLines.data ?? []) as GameLineRow[]

  const linesByGame = new Map<number, GameLineRow[]>()
  for (const l of gameLineRows) {
    const list = linesByGame.get(l.game_id)
    if (list) list.push(l)
    else linesByGame.set(l.game_id, [l])
  }

  const gamesByMatch = new Map<number, Game[]>()
  for (const g of gameRows) {
    const own = linesByGame.get(g.id) ?? []
    const side = (s: 'a' | 'b') => own
      .filter((l) => l.side === s)
      .map((l) => ({
        pokemon: l.pokemon_id, kills: l.kills, deaths: l.deaths, brought: l.brought ?? false,
      }))
    const list = gamesByMatch.get(g.match_id) ?? []
    list.push({
      number: g.number,
      winner: g.winner,
      replayUrl: g.replay_url,
      survivors: g.survivors,
      a: side('a'),
      b: side('b'),
    })
    gamesByMatch.set(g.match_id, list)
  }

  const schedule: Match[] = matchRows.map((m, i) => ({
    id: m.id,
    week: m.week,
    match: i + 1,
    a: m.side_a,
    b: m.side_b,
    scoreA: m.score_a,
    scoreB: m.score_b,
    ...(gamesByMatch.has(m.id) ? { games: gamesByMatch.get(m.id) } : {}),
  }))

  // Rebuilt rather than stored: the per-Pokemon lines plus the sides they were
  // played on is all the stats views need.
  const matchStats: MatchStat[] = matchRows.map((m) => {
    const forSide = (side: 'a' | 'b') => {
      const own = (linesByMatch.get(m.id) ?? []).filter((l) => l.side === side)
      const score = side === 'a' ? m.score_a : m.score_b
      const other = side === 'a' ? m.score_b : m.score_a
      return {
        team: sideLabel(side === 'a' ? m.side_a : m.side_b),
        result: score === null || other === null ? null : score > other ? 'W' : score < other ? 'L' : 'T',
        score,
        lines: own.map((l) => ({ pokemon: l.pokemon_id, kills: l.kills, deaths: l.deaths })),
      }
    }
    return { week: m.week, a: forSide('a'), b: forSide('b') }
  })

  // The view has no opinion about order; ranking is a presentation decision.
  // Points first, then fewer losses — which is what puts a 6-0 record above a
  // 6-2 one, as the league's own table does — then differential.
  const ranked = ([...(standings.data ?? [])] as StandingRow[]).sort(
    (a, b) => b.points - a.points
      || a.losses - b.losses
      || b.diff - a.diff
      || a.name.localeCompare(b.name),
  )

  return {
    meta: {
      name: meta.data?.name ?? null,
      regulation: meta.data?.regulation ?? null,
      format: meta.data?.format ?? null,
      weeks: meta.data?.weeks ?? null,
      picksPerPlayer: meta.data?.picks_per_player ?? null,
      seriesLength: meta.data?.series_length ?? null,
      tierLimits: meta.data?.tier_limits ?? {},
    },
    players: playerRows,
    board: Object.fromEntries(boardRows.map((b) => [b.pokemon_id, {
      name: b.name,
      tier: b.tier as never,
      note: b.note,
      draftedBy: b.drafted_by ? nameById.get(b.drafted_by) ?? b.drafted_by : null,
      ...(b.base_stats ? { baseStats: b.base_stats as never } : {}),
      bst: b.bst,
    }])) as League['board'],
    rosters: (rosters.data ?? []).reduce<League['rosters']>((acc, r) => {
      const row = r as { player_id: string; pokemon_id: string; tier: string }
      if (!visible.has(row.player_id)) return acc
      ;(acc[row.player_id] ??= []).push({ pokemon: row.pokemon_id, tier: row.tier as never })
      return acc
    }, {}),
    draft: [],
    schedule,
    standings: ranked.map((s, i): Standing => ({
      rank: i + 1,
      player: s.player_id,
      name: s.name,
      team: s.team,
      wins: s.wins,
      losses: s.losses,
      gamesWon: s.games_won,
      gamesLost: s.games_lost,
      monDiff: s.diff,
      points: s.points,
    })),
    rules: {
      title: meta.data?.name ?? null,
      subtitle: null,
      footer: null,
      sections: (rules.data ?? []).map((r) => {
        const row = r as { heading: string; items: unknown; notes: string[] }
        return {
          heading: row.heading,
          items: (row.items ?? []) as { label: string; text: string }[],
          notes: row.notes ?? [],
        }
      }),
    },
    matchStats,
  }
}
