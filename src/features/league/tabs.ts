/** Kept out of LeagueView so the app shell can render the secondary nav. */
export type LeagueTab = 'standings' | 'matches' | 'stats' | 'board' | 'rules'

/**
 * The league's own tabs.
 *
 * `board` is not among them — the draft board lives under the top-level Draft
 * tab, since drafting happens before a season rather than during one. There is
 * no separate players tab either: the ranking already lists every player, and
 * each row opens onto that player's team.
 */
export const LEAGUE_TABS: { key: LeagueTab; label: string }[] = [
  { key: 'standings', label: 'Players' },
  { key: 'stats', label: 'Pokémon Ranking' },
  { key: 'matches', label: 'Matches' },
  { key: 'rules', label: 'Rules' },
]
