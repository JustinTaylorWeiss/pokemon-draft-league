/** Shapes produced by scripts/import-league.mjs from the master spreadsheet. */
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
}

/** Newest league season first; the test season is scaffolding and sits last. */
export const SEASONS: Season[] = [
  { id: 'season-4', label: 'Season 4', source: 'sheet' },
  { id: 'mega-mc', label: 'Season 5', source: 'database' },
  { id: 'test', label: 'Test Season', source: 'database' },
]

const SEASON_KEY = 'league:season'

function storedSeason(): Season {
  try {
    const id = localStorage.getItem(SEASON_KEY)
    return SEASONS.find((s) => s.id === id) ?? SEASONS[0]
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
 * Where an in-page refresh is kept so it survives a reload.
 *
 * Refreshing used to only replace the copy in memory, so the next page load
 * went back to the file the site was built with and the refresh looked like it
 * had been undone.
 */
const REFRESH_KEY = 'league:refreshed'

interface CachedLeague { at: number; league: League }

function readRefreshed(): CachedLeague | null {
  try {
    const raw = localStorage.getItem(REFRESH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedLeague
    return parsed?.league && typeof parsed.at === 'number' ? parsed : null
  } catch {
    return null
  }
}

function writeRefreshed(league: League) {
  try {
    localStorage.setItem(REFRESH_KEY, JSON.stringify({ at: Date.now(), league }))
  } catch {
    // Private browsing, or the 5MB quota. The refresh still applies to this
    // page; it just will not outlive it.
  }
}

/** The JSON built from the spreadsheet, or a newer refresh saved over it. */
async function loadShipped(): Promise<League> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/league.json`)
  if (!res.ok) throw new Error(`Failed to load league.json: HTTP ${res.status}`)
  const modified = res.headers.get('last-modified')
  const builtAt = modified ? new Date(modified) : null
  if (builtAt && !Number.isNaN(builtAt.getTime())) dataTimestamp = builtAt

  // A saved refresh wins only while it is newer than the deployed file. The
  // hourly sync commits straight into the build, so once that lands the shipped
  // copy is the better one and the saved refresh is dropped.
  const saved = readRefreshed()
  if (saved) {
    const shipped = builtAt && !Number.isNaN(builtAt.getTime()) ? builtAt.getTime() : 0
    if (saved.at > shipped) {
      dataTimestamp = new Date(saved.at)
      return saved.league
    }
    try { localStorage.removeItem(REFRESH_KEY) } catch { /* nothing to clean up */ }
  }
  return res.json() as Promise<League>
}

export function loadLeague(): Promise<League> {
  if (!pending) {
    pending = season.source === 'database' ? loadFromDatabase() : loadShipped()
    pending.catch(() => { pending = null })
  }
  return pending
}

/**
 * Whether a read of the sheet is in flight, from whatever started it.
 *
 * The button is not the only thing that reads the sheet any more — every page
 * load does — so the busy state belongs here rather than in the button's own
 * component, which would otherwise sit idle through the fetch it triggered.
 */
let sheetBusy = false
const busyListeners = new Set<(busy: boolean) => void>()

export const isSheetBusy = () => sheetBusy

export function subscribeSheetBusy(fn: (busy: boolean) => void): () => void {
  busyListeners.add(fn)
  return () => { busyListeners.delete(fn) }
}

function setSheetBusy(busy: boolean) {
  if (sheetBusy === busy) return
  sheetBusy = busy
  for (const fn of busyListeners) fn(busy)
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
  setSheetBusy(true)
  try {
    const league = next.source === 'database'
      ? await loadFromDatabase()
      : await loadShipped()
    pending = Promise.resolve(league)
    for (const fn of listeners) fn(league)
  } finally {
    setSheetBusy(false)
  }
}

/** Re-reads the season already showing, for the refresh button. */
export async function reloadSeason(id: string): Promise<void> {
  const target = SEASONS.find((s) => s.id === id)
  if (!target) return
  tellDatabase(target)
  setSheetBusy(true)
  try {
    const league = target.source === 'database' ? await loadFromDatabase() : await loadShipped()
    pending = Promise.resolve(league)
    for (const fn of listeners) fn(league)
  } finally {
    setSheetBusy(false)
  }
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
  writeRefreshed(next)
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
  setSheetBusy(true)
  try {
    return await readSheet(sheetUrl)
  } finally {
    setSheetBusy(false)
  }
}

async function readSheet(sheetUrl: string): Promise<League> {
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

let revalidateStarted = false

/**
 * Reads the sheet once per page load, in the background.
 *
 * The sheet is the league's source of truth and it is read live, so it is by
 * definition the freshest thing available — fresher than the JSON the site was
 * built with and fresher than any refresh saved from an earlier visit. Everyone
 * therefore sees an edit on their next visit without anyone pressing anything.
 *
 * Deferred to idle because it pulls in the spreadsheet parser, which is the
 * largest chunk in the bundle and has no business delaying first paint. If the
 * sheet cannot be reached the page keeps whatever it already had, which is why
 * the failure is swallowed rather than surfaced — only the button reports
 * errors, because only the button was asked for.
 */
/**
 * How stale the copy in hand has to be before the sheet is read again.
 *
 * Reading it takes between four and twelve seconds — it is a spreadsheet
 * export, not an API — and doing that on every single page load meant the
 * refresh button spun for most of a visit and the numbers changed underneath
 * whoever was reading them, almost always to the same numbers. The hourly sync
 * commits the sheet into the build anyway, so a copy from ten minutes ago is
 * not meaningfully behind.
 */
const REVALIDATE_AFTER = 10 * 60 * 1000

export function revalidateLeague(sheetUrl: string) {
  if (revalidateStarted || typeof window === 'undefined') return
  revalidateStarted = true

  const saved = readRefreshed()
  const shipped = dataTimestamp?.getTime() ?? 0
  const freshest = Math.max(saved?.at ?? 0, shipped)
  if (freshest && Date.now() - freshest < REVALIDATE_AFTER) return

  const run = () => { refreshLeagueFromSheet(sheetUrl).catch(() => {}) }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 3000 })
  } else {
    setTimeout(run, 1200)
  }
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
 * like anything else *and* a tag of its own, which is what the cap is counted
 * against. Read off the forme rather than the name: "Meganium" and "Yanmega"
 * both contain the word.
 */
export const isMega = (p: { forme?: string } | null | undefined) =>
  /^(Mega|Primal)/.test(p?.forme ?? '')

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
