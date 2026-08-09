/** Shapes produced by scripts/import-league.mjs from the master spreadsheet. */

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

export interface League {
  meta: LeagueMeta
  players: Player[]
  board: Record<string, BoardEntry>
  rosters: Record<string, RosterPick[]>
  draft: DraftPick[]
  schedule: Match[]
  standings: Standing[]
}

let pending: Promise<League> | null = null

export function loadLeague(): Promise<League> {
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/league.json`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load league.json: HTTP ${res.status}`)
      return res.json() as Promise<League>
    })
    pending.catch(() => { pending = null })
  }
  return pending
}

export const playerLabel = (p: Player) => (p.team ? `${p.name} — ${p.team}` : p.name)

/** Draft tiers get their own color ramp, distinct from the Smogon tier chips. */
export const tierClass = (tier: DraftTier | string) => `tier tier-${String(tier).toLowerCase()}`

/** Index players by id for the many places that only carry the key. */
export const byId = (players: Player[]) =>
  Object.fromEntries(players.map((p) => [p.id, p])) as Record<string, Player>
