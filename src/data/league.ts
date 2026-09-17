/** Shapes produced by scripts/import-league.mjs from the master spreadsheet. */
import { toId } from './load'
import { setDbSeason } from './supabase'
import type { BaseStats, Pokemon, PokemonDex } from './types'

export type DraftTier = 'Banned' | 'Top' | 'High' | 'Mid' | 'Low'

/** Board order, worst to best, for sorting and color ramps. */
export const TIER_ORDER: DraftTier[] = ['Low', 'Mid', 'High', 'Top', 'Banned']

export interface LeagueMeta {
  name: string | null
  regulation: string | null
  format: string | null
  weeks: number | null
  picksPerPlayer: number | null
  seriesLength: string | null
  /** Max picks allowed from each tier, e.g. { Top: 2, High: 2, Mid: 2, Low: 1 }. */
  /**
   * How many of each a team may hold. Keyed by tier, plus `Mega` — which is not
   * a tier and never appears in `board.tier`, but is capped the same way: a
   * Mega carries its own tier and counts against this as well.
   */
  tierLimits: Partial<Record<DraftTier | 'Mega', number>>
  /**
   * What a coach may spend in total. Null for a season drafted on tier counts
   * rather than a budget, which is every season before Season 5.
   */
  pointsBudget: number | null
}

export interface Player {
  id: string
  seed: number
  name: string
  /** Null when the player has not named their team yet. */
  team: string | null
  /**
   * Where they pick in the snake draft, drawn at random when it opened. Null
   * before a draft has ever been opened, and on a season read from the sheet.
   */
  draftOrder?: number | null
}

export interface BoardEntry {
  name: string
  tier: DraftTier
  note: string | null
  draftedBy: string | null
  /** What it costs to draft. Null on a season not drafted on points. */
  points?: number | null
  /** Present when the sheet lists stats; these override the Showdown dex. */
  baseStats?: BaseStats
  bst?: number | null
}

export interface RosterPick {
  /** Dex id, joinable against pokemon.json. */
  pokemon: string
  tier: DraftTier
  /**
   * What was paid, at the time it was drafted — not what the board asks now.
   * Re-pricing is a decision about future picks, not a rewrite of settled ones.
   */
  points?: number | null
}

export interface DraftPick {
  round: number
  pick: number
  player: string
  pokemon: string
  tier: DraftTier
}

/** One 2v2 partner match: two players per side. */
/** One Pokémon's line in one game. */
export interface GameLine {
  pokemon: string
  kills: number
  deaths: number
  /** Whether it was sent out: six are previewed, four are usually played. */
  brought: boolean
}

/**
 * A single game inside a match.
 *
 * Only present for matches reported from replays. A season imported from the
 * spreadsheet knows its series scores and nothing about the games underneath,
 * so this is empty there rather than wrong.
 */
export interface Game {
  number: number
  /** Which side of the *match* won, not which side of the Showdown log. */
  winner: 'a' | 'b' | null
  replayUrl: string | null
  survivors: number | null
  a: GameLine[]
  b: GameLine[]
}

export interface Match {
  /**
   * The database row, when there is one. Absent for a season read from the
   * spreadsheet, which has no ids — and which is why removing a fixture is
   * only offered where one exists.
   */
  id?: number
  week: number
  match: string | number
  a: string[]
  b: string[]
  scoreA: number | null
  scoreB: number | null
  games?: Game[]
}

export interface Standing {
  rank: number
  player: string
  name: string
  team: string | null
  wins: number
  losses: number
  gamesWon: number
  gamesLost: number
  monDiff: number
  points: number
}

export interface RuleSection {
  heading: string
  items: { label: string; text: string }[]
  /** Callouts that belong to the section but have no label/value split. */
  notes: string[]
}

export interface Rulebook {
  title: string | null
  subtitle: string | null
  footer: string | null
  sections: RuleSection[]
}

/** One Pokémon's line in a match: what it brought down and what it lost. */
export interface MatchLine {
  pokemon: string
  kills: number
  deaths: number
}

export interface MatchSide {
  /** Raw pair label from the sheet, e.g. "Pr3dixtion / Kaleb Clark". */
  team: string
  result: string | null
  score: number | null
  lines: MatchLine[]
}

export interface MatchStat {
  week: number
  a: MatchSide
  b: MatchSide
}

/** The sheet's own per-Pokémon totals, which are still being filled in. */
export interface PokemonStat {
  player: string
  gamesPlayed: number
  kills: number
  deaths: number
}

/** Totals derived from the match log, which is the complete record. */
export interface PokemonTotals {
  pokemon: string
  gamesPlayed: number
  kills: number
  deaths: number
  diff: number
  /** KOs per game — the rate behind the total, and the sort tiebreaker. */
  killsPerGame: number
  /**
   * KOs per death. `Infinity` for a Pokémon that has never fainted, which is
   * the honest value and sorts it above everything with a finite ratio; the
   * table shows that as ∞ rather than a number.
   */
  kd: number
}

/**
 * One of the league's awards, as written in the sheet's MVP Race tab.
 *
 * The numbers behind each award differ — "most kills" and "best ratio" are not
 * argued from the same figures — so the columns come along with the winners
 * rather than being fixed here.
 */
export interface Award {
  title: string
  blurb: string | null
  columns: string[]
  winners: {
    /** "First", "Second", "Third" — several can share a place. */
    place: string
    pokemon: string
    /** As the sheet writes it: "Justin / Numeral". A caption, not a join. */
    coach: string
    values: (number | string | null)[]
  }[]
}

export interface League {
  meta: LeagueMeta
  players: Player[]
  board: Record<string, BoardEntry>
  rosters: Record<string, RosterPick[]>
  draft: DraftPick[]
  schedule: Match[]
  standings: Standing[]
  rules?: Rulebook
  matchStats?: MatchStat[]
  pokemonStats?: Record<string, PokemonStat>
  /** Only ever from the spreadsheet: a league writes its own awards. */
  awards?: Award[]
}

/**
 * The seasons the site can show.
 *
 * `sheet` reads the JSON built from the spreadsheet, with a live read of the
 * sheet on top. `database` reads Supabase, where editing happens on the site.
 * Views never learn which they are looking at — switching republishes through
 * the same channel a refresh uses, so everything re-renders as it already does.
 */
export interface Season {
  id: string
  label: string
  source: 'sheet' | 'database'
  /**
   * The file in the build this season is served from, for the ones that are
   * records rather than live. Season 4's is `league.json` because it was the
   * only one when it was written.
   */
  file?: string
}

/**
 * The seasons the site offers, current first — and the first is the one it
 * opens on.
 *
 * The Test Season is no longer among them. It was Season 4 imported into the
 * database to build the database-backed half of the site against real data, and
 * it did that job; with Season 5 live and being drafted, a second copy of a
 * finished season is a thing to pick by mistake rather than a thing to use.
 *
 * Taken off the list and not deleted. Its rows are still there, and `seasons`
 * is the table every other one cascades from — a single DELETE against it took
 * 2,925 rows across eleven tables in August, which is why it now has no delete
 * policy and why `supabase/README.md` says there must never be a
 * `delete_season`. Putting it back is this line again.
 */
export const SEASONS: Season[] = [
  { id: 'mega-mc', label: 'Season 5', source: 'database' },
  { id: 'season-4', label: 'Season 4', source: 'sheet', file: 'league.json' },
  { id: 'season-3', label: 'Season 3', source: 'sheet', file: 'season-3.json' },
  { id: 'season-2', label: 'Season 2', source: 'sheet', file: 'season-2.json' },
  { id: 'season-1', label: 'Season 1', source: 'sheet', file: 'season-1.json' },
]

const SEASON_KEY = 'league:season'

function storedSeason(): Season {
  try {
    const id = localStorage.getItem(SEASON_KEY)
    const saved = SEASONS.find((s) => s.id === id)
    if (saved) return saved
    // A season that is not offered any more — anyone who was last looking at
    // the Test Season has one of these. Cleared rather than left to sit there
    // naming something the picker cannot show.
    if (id) localStorage.removeItem(SEASON_KEY)
    return SEASONS[0]
  } catch {
    return SEASONS[0]
  }
}

let season: Season = storedSeason()

export const currentSeason = () => season

/**
 * Tells the database layer which season it is reading and writing.
 *
 * Kept in step in one place rather than at each call site: a season the site is
 * showing but the database has not been told about would read one season's
 * standings while saving into another's, and nothing on screen would say so.
 * The spreadsheet season names no database rows, so it is passed as null and
 * the database layer falls back.
 */
function tellDatabase(s: Season) {
  setDbSeason(s.source === 'database' ? s.id : null)
}

tellDatabase(season)

let pending: Promise<League> | null = null
const listeners = new Set<(l: League) => void>()

/**
 * When the data in hand was produced. Taken from league.json's Last-Modified
 * rather than stamped into the file itself — a timestamp inside the JSON would
 * change on every import, and the sync workflow only commits when the data
 * actually differs.
 */
let dataTimestamp: Date | null = null

export const leagueTimestamp = () => dataTimestamp

/**
 * A refresh saved by an older build, left behind in browsers that visited
 * before Season 4 was frozen. Nothing writes one now and nothing reads one, so
 * the only thing left to do with it is stop it sitting there — it is a whole
 * league's JSON, and a big one against a 5MB quota.
 */
function dropStaleRefresh() {
  try { localStorage.removeItem('league:refreshed') } catch { /* nothing to clean up */ }
}

/**
 * Season 4, as it finished.
 *
 * It used to be the spreadsheet's latest word: read live on every visit, with a
 * copy of the last read saved over the file the site shipped with. The season
 * is over, so there is no later word to wait for. The record is the JSON in the
 * build, it does not change, and nothing reaches out to Google to ask whether
 * it has.
 */
async function loadShipped(from: Season): Promise<League> {
  dropStaleRefresh()
  const file = from.file ?? 'league.json'
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
  if (!res.ok) throw new Error(`Failed to load ${file}: HTTP ${res.status}`)
  const modified = res.headers.get('last-modified')
  const builtAt = modified ? new Date(modified) : null
  if (builtAt && !Number.isNaN(builtAt.getTime())) dataTimestamp = builtAt
  return res.json() as Promise<League>
}

export function loadLeague(): Promise<League> {
  if (!pending) {
    pending = season.source === 'database' ? loadFromDatabase() : loadShipped(season)
    pending.catch(() => { pending = null })
  }
  return pending
}

async function loadFromDatabase(): Promise<League> {
  const { loadLeagueFromSupabase } = await import('./leagueFromSupabase')
  const league = await loadLeagueFromSupabase()
  dataTimestamp = new Date()
  return league
}

/**
 * Switches season and republishes, so every view updates in place.
 *
 * A database season is read fresh each time rather than from the saved refresh
 * or the shipped JSON, both of which belong to the spreadsheet season.
 */
export async function setSeason(id: string): Promise<void> {
  const next = SEASONS.find((s) => s.id === id)
  if (!next || next.id === season.id) return
  season = next
  tellDatabase(next)
  try { localStorage.setItem(SEASON_KEY, next.id) } catch { /* private browsing */ }

  pending = null
  try {
    const league = next.source === 'database'
      ? await loadFromDatabase()
      : await loadShipped(next)
    pending = Promise.resolve(league)
    for (const fn of listeners) fn(league)
  } finally {
  }
}

/** Re-reads the season already showing, for the refresh button. */
export async function reloadSeason(id: string): Promise<void> {
  const target = SEASONS.find((s) => s.id === id)
  if (!target) return
  tellDatabase(target)
  try {
    const league = target.source === 'database' ? await loadFromDatabase() : await loadShipped(target)
    pending = Promise.resolve(league)
    for (const fn of listeners) fn(league)
  } finally {
  }
}

/** Notified when the league is replaced — a season change — so views re-render. */
export function subscribeLeague(fn: (l: League) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const playerLabel = (p: Player) => (p.team ? `${p.name} — ${p.team}` : p.name)

/** Draft tiers get their own color ramp, distinct from the Smogon tier chips. */
export const tierClass = (tier: DraftTier | string) => `tier tier-${String(tier).toLowerCase()}`

/** Index players by id for the many places that only carry the key. */
export const byId = (players: Player[]) =>
  Object.fromEntries(players.map((p) => [p.id, p])) as Record<string, Player>

/** A dex entry with the league's own tier attached. */
/**
 * Whether this is a Mega or Primal forme.
 *
 * Season 5 drafts these apart from the Pokémon they evolve from — Venusaur and
 * Venusaur-Mega are two separate picks off the board — so a Mega carries a tier
 * like anything else *and* a tag of its own. Read off the forme rather than the
 * name: "Meganium" and "Yanmega" both contain the word.
 *
 * Matched as a whole segment anywhere in the forme rather than as a prefix. Six
 * Megas evolve from a forme rather than from a species and are named for both —
 * Meowstic's "M-Mega" and "F-Mega", Tatsugiri's "Curly-Mega" and its siblings,
 * Magearna's "Original-Mega" — and an anchored test called none of them a Mega.
 */
export const isMega = (p: { forme?: string } | null | undefined) =>
  /(^|-)(Mega|Primal)(-|$)/.test(p?.forme ?? '')

/**
 * The id of the forme a Mega evolves from.
 *
 * Usually the base species, and for four of them not: Meowstic-F-Mega comes
 * from Meowstic-F and Meowstic-M-Mega from plain Meowstic, who is the male, and
 * both say only "Meowstic" in `baseSpecies`. Worked out at build time and read
 * back here, so the rule for it lives in one place.
 */
export const megaBaseId = (p: { baseSpecies?: string; megaBase?: string }) =>
  p.megaBase ?? (p.baseSpecies ? toId(p.baseSpecies) : null)

/**
 * How a Mega reads on the board: the Pokémon it evolves from, and a badge for
 * the forme.
 *
 * Showdown names them "Venusaur-Mega", so printing the full name beside a badge
 * saying Mega says it twice. Splitting it also keeps the distinction that
 * matters — "Charizard, Mega X" and "Charizard, Mega Y" are two different picks
 * and both are on the board.
 */
export function megaParts(p: { name: string; baseSpecies?: string; forme?: string }) {
  if (!isMega(p)) return { name: p.name, badge: null }
  return {
    name: p.baseSpecies ?? p.name,
    badge: (p.forme ?? 'Mega').replace(/-/g, ' '),
  }
}

export interface LeaguePokemon extends Pokemon {
  draftTier: DraftTier | null
  note: string | null
  draftedBy: string | null
  /** What it costs to draft. Null on a season not drafted on points. */
  points: number | null
  /** False when the sheet does not list this Pokémon at all. */
  onBoard: boolean
}

/**
 * The spreadsheet is the source of truth. Where it and the Showdown dataset
 * disagree, the sheet wins: its display name, stats, and tier are taken as
 * given, and the dex only fills in what the sheet has no opinion about — types,
 * abilities, learnsets, sprites.
 *
 * Returns a dex-shaped object so every existing panel keeps working unchanged.
 */
/** The dex with the league's view of each Pokémon folded in. */
export type LeagueDex = Record<string, LeaguePokemon>

export function mergeDex(dex: PokemonDex, league: League | null): LeagueDex {
  const out: Record<string, LeaguePokemon> = {}
  for (const [id, mon] of Object.entries(dex)) {
    const entry = league?.board[id]
    const baseStats = entry?.baseStats ?? mon.baseStats
    out[id] = {
      ...mon,
      name: entry?.name ?? mon.name,
      baseStats,
      bst: entry?.bst ?? (entry?.baseStats
        ? baseStats.hp + baseStats.atk + baseStats.def + baseStats.spa + baseStats.spd + baseStats.spe
        : mon.bst),
      draftTier: entry?.tier ?? null,
      note: entry?.note ?? null,
      draftedBy: entry?.draftedBy ?? null,
      points: entry?.points ?? null,
      onBoard: Boolean(entry),
    }
  }
  return out
}

/**
 * Per-Pokémon totals from the match log rather than the sheet's Pokémon Stats
 * tab: that tab is still being filled in, so most of its rows read zero even
 * where the games were recorded.
 */
export function totalsFromMatches(matches: MatchStat[]): Record<string, PokemonTotals> {
  const out: Record<string, PokemonTotals> = {}
  for (const match of matches) {
    for (const side of [match.a, match.b]) {
      for (const line of side.lines) {
        const t = (out[line.pokemon] ??= {
          pokemon: line.pokemon, gamesPlayed: 0, kills: 0, deaths: 0, diff: 0,
          killsPerGame: 0, kd: 0,
        })
        t.gamesPlayed++
        t.kills += line.kills || 0
        t.deaths += line.deaths || 0
        t.diff = t.kills - t.deaths
        t.killsPerGame = t.gamesPlayed ? t.kills / t.gamesPlayed : 0
        // Never fainted is not a ratio of zero, it is a ratio without a bottom.
        t.kd = t.deaths ? t.kills / t.deaths : t.kills ? Infinity : 0
      }
    }
  }
  return out
}

/** Best-to-worst, for sorting rosters and board listings. */
const TIER_RANK: Record<string, number> = { Top: 0, High: 1, Mid: 2, Low: 3, Banned: 4 }

export const byTier = (a: string | null, b: string | null) =>
  (TIER_RANK[a ?? ''] ?? 99) - (TIER_RANK[b ?? ''] ?? 99)
