import { useEffect, useState } from 'react'
import { QuickMatchup } from './features/quick-matchup/QuickMatchup'
import { LeagueView } from './features/league/LeagueView'
import { LEAGUE_TABS, type LeagueTab } from './features/league/tabs'
import { leagueTimestamp, loadLeague, refreshLeagueFromSheet, subscribeLeague, type League } from './data/league'
import { Dex } from './features/dex/Dex'
import { PokemonModalProvider } from './features/pokemon/PokemonModalContext'
import { PokemonModal } from './features/pokemon/PokemonModal'
import './App.css'

/**
 * The league's master sheet, exported as xlsx.
 *
 * READ-ONLY. The share link grants edit access; nothing in this app may use
 * it. The refresh below performs a single GET. See CLAUDE.md.
 */
const LEAGUE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1xnKp-XtR9o-zJy1BNS78PxXy891zv_n4rawKto6rlyE/export?format=xlsx'

/** "Draft League Season 4 VGC Reg F" -> "Season 4". */
const seasonLabel = (name: string | null) =>
  name?.match(/Season\s*\d+/i)?.[0] ?? name ?? 'Season'

type View = 'league' | 'matchup' | 'dex'

const VIEWS: { key: View; label: string }[] = [
  { key: 'league', label: 'League Sheet' },
  { key: 'matchup', label: 'Quick Matchup' },
  { key: 'dex', label: 'Dex' },
]

export default function App() {
  const [view, setView] = useState<View>('league')
  // Lifted so the secondary bar can sit directly under the primary one.
  const [leagueTab, setLeagueTab] = useState<LeagueTab>('standings')
  // Loaded here too so the secondary nav can name the season; the loader caches,
  // so this shares one fetch with the views below.
  const [league, setLeague] = useState<League | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [dataAt, setDataAt] = useState<Date | null>(null)

  useEffect(() => {
    loadLeague().then((l) => { setLeague(l); setDataAt(leagueTimestamp()) }, () => {})
    // A refresh republishes the league, and every view listens for it.
    return subscribeLeague((l) => { setLeague(l); setDataAt(leagueTimestamp()) })
  }, [])

  /** Re-reads the sheet in the browser. Read-only: a GET, nothing more. */
  const refresh = async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      await refreshLeagueFromSheet(LEAGUE_SHEET_URL)
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <PokemonModalProvider>
      <header className="topbar">
        <div className="bar-inner">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-text">Draft League</span>
          </span>
          <nav className="main-nav">
            {VIEWS.map((v) => (
              <button
                key={v.key} type="button"
                className={view === v.key ? 'is-active' : ''}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </nav>

          {/* One season for now; this is where other seasons or leagues will be
              chosen once there is more than one to import. */}
          {league && (
            <label className="season-picker">
              <select value="current" onChange={() => {}} aria-label="League and season">
                <option value="current">{seasonLabel(league.meta.name)}</option>
              </select>
            </label>
          )}

          {/* Re-reads the master sheet. This only ever GETs — the sheet is
              read-only, see CLAUDE.md. */}
          <div className="refresh-wrap">
          <button
            type="button"
            className={`refresh-btn${refreshing ? ' is-busy' : ''}`}
            onClick={refresh}
            disabled={refreshing}
            title={refreshError ?? 'Fetch the latest data from the league sheet'}
            aria-label="Refresh league data from the sheet"
          >
            <span className="refresh-icon" aria-hidden="true">⟳</span>
            <span className="refresh-label">
              {refreshing ? 'Refreshing…' : refreshError ? 'Retry' : 'Refresh'}
            </span>
          </button>

          <span className={`refresh-stamp${refreshError ? ' is-error' : ''}`}>
            {refreshError
              ? refreshError
              : dataAt
                ? `Updated ${dataAt.toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}`
                : ''}
          </span>
          </div>
        </div>
      </header>

      {view === 'league' && (
        <div className="subbar">
          <div className="bar-inner">
            <nav className="sub-nav">
              {LEAGUE_TABS.map((t) => (
                <button
                  key={t.key} type="button"
                  className={leagueTab === t.key ? 'is-active' : ''}
                  onClick={() => setLeagueTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      <main className="shell">
        {view === 'league' && <LeagueView tab={leagueTab} />}
        {view === 'matchup' && <QuickMatchup />}
        {view === 'dex' && <Dex />}
      </main>

      <PokemonModal />
    </PokemonModalProvider>
  )
}
