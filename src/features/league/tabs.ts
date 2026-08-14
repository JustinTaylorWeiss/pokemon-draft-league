/** Kept out of LeagueView so the app shell can render the secondary nav. */
export type LeagueTab = 'standings' | 'players' | 'matches' | 'stats' | 'board' | 'rules'

/**
 * The league's own tabs. `board` is not among them — the draft board lives
 * under the top-level Draft tab, since drafting happens before a season rather
 * than during one.
 */
export const LEAGUE_TABS: { key: LeagueTab; label: string }[] = [
  { key: 'standings', label: 'Player Ranking' },
  { key: 'stats', label: 'Pokémon Ranking' },
  { key: 'matches', label: 'Matches' },
  { key: 'players', label: 'Players' },
  { key: 'rules', label: 'Rules' },
]
