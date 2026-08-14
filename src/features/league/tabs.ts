/** Kept out of LeagueView so the app shell can render the secondary nav. */
export type LeagueTab = 'standings' | 'matches' | 'stats' | 'board' | 'draft-teams' | 'rules'

/**
 * The league's own tabs.
 *
 * Two of the league's screens are not here. `board` lives under the top-level
 * Draft tab, since drafting happens before a season rather than during one, and
 * `rules` sits in the top bar because it describes the league itself rather
 * than a view of its data. There is no separate players tab either: the ranking
 * already lists every player, and each row opens onto that player's team.
 */
export const LEAGUE_TABS: { key: LeagueTab; label: string }[] = [
  { key: 'standings', label: 'Players' },
  { key: 'matches', label: 'Matches' },
  { key: 'stats', label: 'Pokémon Ranking' },
]
