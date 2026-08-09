/** Shapes produced by scripts/import-league.mjs from the master spreadsheet. */
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
  tierLimits: Partial<Record<DraftTier, number>>
}

export interface Player {
  id: string
  seed: number
  name: string
  /** Null when the player has not named their team yet. */
  team: string | null
}

export interface BoardEntry {
  name: string
  tier: DraftTier
  note: string | null
  draftedBy: string | null
  /** Present when the sheet lists stats; these override the Showdown dex. */
  baseStats?: BaseStats
  bst?: number | null
}

export interface RosterPick {
  /** Dex id, joinable against pokemon.json. */
  pokemon: string
  tier: DraftTier
}

export interface DraftPick {
  round: number
  pick: number
  player: string
  pokemon: string
  tier: DraftTier
}

/** One 2v2 partner match: two players per side. */
export interface Match {
  week: number
  match: string | number
  a: string[]
  b: string[]
  scoreA: number | null
  scoreB: number | null
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
  /** Kills per game — the rate behind the total, and the sort tiebreaker. */
  killsPerGame: number
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
}

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

export function loadLeague(): Promise<League> {
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/league.json`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load league.json: HTTP ${res.status}`)
      const modified = res.headers.get('last-modified')
      if (modified) {
        const when = new Date(modified)
        if (!Number.isNaN(when.getTime())) dataTimestamp = when
      }
      return res.json() as Promise<League>
    })
    pending.catch(() => { pending = null })
  }
  return pending
}

/** Notified when a refresh replaces the data, so views re-render in place. */
export function subscribeLeague(fn: (l: League) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Replaces the cached league after an in-page refresh from the sheet. */
export function publishLeague(next: League) {
  pending = Promise.resolve(next)
  dataTimestamp = new Date()
  for (const fn of listeners) fn(next)
}

/**
 * Re-reads the master sheet in the browser and republishes the result.
 *
 * READ-ONLY: this is a single GET of the export URL. Nothing here writes to
 * the sheet, and nothing may be added that does — see CLAUDE.md. SheetJS and
 * the parser load on demand so the initial bundle does not carry them.
 */
export async function refreshLeagueFromSheet(sheetUrl: string): Promise<League> {
  const [{ read }, { parseLeagueSheet }, dexRes, sheetRes] = await Promise.all([
    import('xlsx'),
    import('../lib/parseLeagueSheet.js'),
    fetch(`${import.meta.env.BASE_URL}data/pokemon.json`),
    // no-store or the browser replays the previous refresh's copy and the
    // button appears to do nothing.
    fetch(sheetUrl, { method: 'GET', cache: 'no-store' }),
  ])
  if (!sheetRes.ok) throw new Error(`Could not reach the sheet (HTTP ${sheetRes.status})`)
  const bytes = new Uint8Array(await sheetRes.arrayBuffer())
  // An xlsx is a zip; anything else means a sign-in page came back instead.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('The sheet link did not return a spreadsheet — check it is shared for reading.')
  }
  const wb = read(bytes, { type: 'array' })
  const { league } = parseLeagueSheet(wb, await dexRes.json())
  publishLeague(league as League)
  return league as League
}

export const playerLabel = (p: Player) => (p.team ? `${p.name} — ${p.team}` : p.name)

/** Draft tiers get their own color ramp, distinct from the Smogon tier chips. */
export const tierClass = (tier: DraftTier | string) => `tier tier-${String(tier).toLowerCase()}`

/** Index players by id for the many places that only carry the key. */
export const byId = (players: Player[]) =>
  Object.fromEntries(players.map((p) => [p.id, p])) as Record<string, Player>

/** A dex entry with the league's own tier attached. */
export interface LeaguePokemon extends Pokemon {
  draftTier: DraftTier | null
  note: string | null
  draftedBy: string | null
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
export function mergeDex(dex: PokemonDex, league: League | null): Record<string, LeaguePokemon> {
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
          pokemon: line.pokemon, gamesPlayed: 0, kills: 0, deaths: 0, diff: 0, killsPerGame: 0,
        })
        t.gamesPlayed++
        t.kills += line.kills || 0
        t.deaths += line.deaths || 0
        t.diff = t.kills - t.deaths
        t.killsPerGame = t.gamesPlayed ? t.kills / t.gamesPlayed : 0
      }
    }
  }
  return out
}

/** Best-to-worst, for sorting rosters and board listings. */
const TIER_RANK: Record<string, number> = { Top: 0, High: 1, Mid: 2, Low: 3, Banned: 4 }

export const byTier = (a: string | null, b: string | null) =>
  (TIER_RANK[a ?? ''] ?? 99) - (TIER_RANK[b ?? ''] ?? 99)
