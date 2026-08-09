/** Kept out of LeagueView so the app shell can render the secondary nav. */
export type LeagueTab = 'standings' | 'rosters' | 'schedule' | 'board'

export const LEAGUE_TABS: { key: LeagueTab; label: string }[] = [
  { key: 'standings', label: 'Standings' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'rosters', label: 'Rosters' },
  { key: 'board', label: 'Draft Board' },
]
