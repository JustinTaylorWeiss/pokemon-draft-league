/**
 * Five seasons added together: who has played, and what they played.
 *
 * Not a season — there was never an All Time draft — but it is shaped like one
 * so every view renders it without knowing. It carries the two things that
 * survive a season ending, a coach's record and a Pokemon's, and nothing else:
 * no board, no fixtures of its own, no rosters. `tabsFor` in `tabs.ts` is where
 * that shows.
 *
 * Built in the browser from the other seasons rather than generated into a
 * file, so Season 5 counts the moment a match is reported rather than the next
 * time someone runs a script.
 */
import type { League, Match, MatchStat, Player, Standing } from './league'

/**
 * The same person, season after season, under whatever handle they used then.
 *
 * Thirty-seven handles across four archived seasons are not thirty-seven
 * people. The ids are slugs of whatever the sheet called someone that year, so
 * Sean is `sean` in Season 1, `swjf` in Season 2 and `sean-swjf` in Season 4,
 * and an all-time table that believed the ids would put one coach's record in
 * three rows and rank all three below people who had played once.
 *
 * Only the league can settle who is who, so this is its answer rather than a
 * guess at spellings: every pair here was confirmed. The key is the handle to
 * keep — the current one, so a coach reads as they are now — and the values
 * are the ones that fold into it. A handle in no list is its own person, which
 * is the safe default: failing to merge shows someone twice, and merging
 * wrongly credits one person with another's seasons.
 */
const COACHES: Record<string, string[]> = {
  'sean-swjf': ['sean', 'swjf'],
  'phil-ferlo': ['ferlo', 'philip', 'phillip'],
  'julian-chirashi': ['julian'],
  'austin-armadillo': ['armadillo'],
  'jo-particleflare': ['pf987'],
  'bargus-brandon': ['bargus'],
  bikey: ['bikeytomato'],
  tom: ['thomas'],
  // Both of each pair are rows in Season 5, entered twice rather than two
  // coaches — so they merge there as well as across seasons.
  nickkkkk: ['nick'],
  'lennart-pr3dixtion': ['pr3dixtion'],
}

/**
 * In the players table but not a person. Left alone where it lives — Season 5
 * still has its row, and nothing here writes — and only kept out of this table.
 */
const NOT_A_COACH = new Set(['test2'])

const ALIASES = new Map(
  Object.entries(COACHES).flatMap(([keep, folded]) => folded.map((id) => [id, keep] as const)),
)

/** The handle to file a record under, whichever one the season called them. */
export const coachId = (id: string) => ALIASES.get(id) ?? id

interface Tally {
  id: string
  name: string
  /** The seasons they turned up in, oldest first — shown in place of a team. */
  seasons: string[]
  wins: number
  losses: number
  gamesWon: number
  gamesLost: number
  monDiff: number
  points: number
}

const ADDED = ['wins', 'losses', 'gamesWon', 'gamesLost', 'monDiff', 'points'] as const

/**
 * One season's worth of the league, and the short name to file it under.
 *
 * Newest first, the order the picker lists them in, because the newest
 * spelling of a coach's name is the one to show.
 */
export interface SeasonPart {
  label: string
  league: League
}

export function combineSeasons(parts: SeasonPart[]): League {
  const coaches = new Map<string, Tally>()
  const schedule: Match[] = []
  const matchStats: MatchStat[] = []

  // Oldest first, so each pass overwrites the name with a more recent one and
  // the seasons land in the order they were played.
  for (const { label, league } of [...parts].reverse()) {
    /**
     * A standings row for somebody the season no longer lists is somebody who
     * was removed from it. The record of the matches they played stays — that
     * is why the row is still there — but they are not a coach this counts.
     */
    const listed = new Set(league.players.map((p) => p.id))
    for (const row of league.standings) {
      if (!listed.has(row.player)) continue
      const id = coachId(row.player)
      if (NOT_A_COACH.has(id)) continue
      const own = coaches.get(id) ?? {
        id, name: row.name, seasons: [],
        wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, monDiff: 0, points: 0,
      }
      own.name = row.name
      if (!own.seasons.includes(label)) own.seasons.push(label)
      for (const field of ADDED) own[field] += row[field]
      coaches.set(id, own)
    }

    // The ids come along canonicalised, so the head-to-head tiebreak can see
    // that Sean beat Bikey in Season 2 while they were `swjf` and
    // `bikeytomato`. Each season numbers its own matches from one, so the
    // database ids are dropped rather than collided.
    for (const m of league.schedule) {
      const { id: _id, ...rest } = m
      schedule.push({ ...rest, a: m.a.map(coachId), b: m.b.map(coachId) })
    }
    matchStats.push(...(league.matchStats ?? []))
  }

  const standings: Standing[] = [...coaches.values()].map((c) => ({
    // Ranked by the view, which applies the league's own tiebreaks.
    rank: 0,
    player: c.id,
    name: c.name,
    // No coach has one team across five seasons, so the column that would hold
    // one holds what they do have in common instead: the seasons they played.
    team: c.seasons.join(' '),
    wins: c.wins,
    losses: c.losses,
    gamesWon: c.gamesWon,
    gamesLost: c.gamesLost,
    monDiff: c.monDiff,
    points: c.points,
  }))

  const players: Player[] = standings.map((s, i) => ({
    id: s.player, seed: i + 1, name: s.name, team: s.team,
  }))

  return {
    meta: {
      name: 'All Time',
      regulation: null,
      format: null,
      // Counted, not drafted: a span of seasons rather than a season's length,
      // and no budget or tier limits because nothing here was ever picked.
      weeks: null,
      picksPerPlayer: null,
      seriesLength: null,
      tierLimits: {},
      pointsBudget: null,
    },
    players,
    board: {},
    rosters: {},
    draft: [],
    schedule,
    standings,
    matchStats,
    // Each season's awards belong to the season that gave them, and three
    // "MVP Race" tabs beside each other would say less than one of them does
    // in its own place. What this tab has instead is the ranking underneath
    // them, over every match the league has played.
    awards: [],
  }
}
