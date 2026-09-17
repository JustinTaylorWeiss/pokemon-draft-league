/** Kept out of LeagueView so the app shell can render the secondary nav. */
import type { Season } from '../../data/league'

export type LeagueTab =
  | 'standings' | 'matches' | 'stats' | 'my-team' | 'board' | 'history' | 'rules'

/**
 * The league's tabs.
 *
 * Drafting is not a separate place any more: your team and the board are two
 * more views of the same league, sitting beside the standings and the matches.
 * `history` and `rules` are not here — the log spans the whole league and
 * reaches from the top bar, and the rules open over whatever you are reading.
 */
export const LEAGUE_TABS: { key: LeagueTab; label: string }[] = [
  { key: 'my-team', label: 'My Team' },
  { key: 'standings', label: 'Players' },
  { key: 'matches', label: 'Matches' },
  { key: 'stats', label: 'Pokémon Awards' },
  { key: 'board', label: 'Draft List' },
]

/**
 * All Time is a record of coaches and Pokémon and nothing besides.
 *
 * It was never drafted and never scheduled: there is no board behind it, no
 * fixture that belongs to it rather than to the season that played it, and no
 * team behind a coach — their row is four or five seasons of different teams
 * added up. The tabs that would open onto nothing are not offered rather than
 * offered empty.
 */
const ALL_TIME: LeagueTab[] = ['standings', 'stats']

/** The tabs this season has. */
export const tabsFor = (season: Season) =>
  (season.source === 'all-time'
    ? LEAGUE_TABS.filter((t) => ALL_TIME.includes(t.key))
    : LEAGUE_TABS)
