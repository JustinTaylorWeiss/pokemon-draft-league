/** Kept out of LeagueView so the app shell can render the secondary nav. */
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
  { key: 'standings', label: 'Players' },
  { key: 'matches', label: 'Matches' },
  { key: 'stats', label: 'Pokémon Ranking' },
  { key: 'my-team', label: 'My Team' },
  { key: 'board', label: 'Draft List' },
]
