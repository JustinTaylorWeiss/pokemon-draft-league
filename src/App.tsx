import { useEffect, useState } from 'react'
import { useElementHeight } from './lib/useElementHeight'
import { QuickMatchup } from './features/quick-matchup/QuickMatchup'
import { LeagueView } from './features/league/LeagueView'
import { LEAGUE_TABS, type LeagueTab } from './features/league/tabs'
import {
  currentSeason, isSheetBusy, leagueTimestamp, loadLeague, refreshLeagueFromSheet,
  reloadSeason, revalidateLeague, SEASONS, setSeason, subscribeLeague, subscribeSheetBusy,
  type League,
} from './data/league'
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
  // Driven by the data layer, so the button also animates through the read the
  // page starts on load — not only the one the button starts itself.
  const [refreshing, setRefreshing] = useState(isSheetBusy)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [dataAt, setDataAt] = useState<Date | null>(null)
  const [season, setSeasonId] = useState(() => currentSeason().id)
  const onDatabase = SEASONS.find((s) => s.id === season)?.source === 'database'

  // The primary bar wraps to two rows on narrow screens, so the secondary bar
  // cannot assume a fixed offset to stick below.
  const [topbarRef, topbarHeight] = useElementHeight<HTMLElement>()
  useEffect(() => {
    if (topbarHeight) document.documentElement.style.setProperty('--topbar-h', `${topbarHeight}px`)
  }, [topbarHeight])

  useEffect(() => {
    loadLeague().then((l) => { setLeague(l); setDataAt(leagueTimestamp()) }, () => {})
    // Then read the sheet itself, which is always the newest source there is —
    // but only for the season that comes from it. A database season is already
    // reading its source directly.
    if (currentSeason().source === 'sheet') revalidateLeague(LEAGUE_SHEET_URL)
    const stopBusy = subscribeSheetBusy(setRefreshing)
    // A refresh republishes the league, and every view listens for it.
    const stopLeague = subscribeLeague((l) => { setLeague(l); setDataAt(leagueTimestamp()) })
    return () => { stopBusy(); stopLeague() }
  }, [])

  /** Re-reads the sheet in the browser. Read-only: a GET, nothing more. */
  const refresh = async () => {
    // The busy state comes from the data layer, which the read below sets, so
    // there is nothing to toggle here beyond clearing the last error.
    setRefreshError(null)
    try {
      // Refresh means "re-read this season's source", which is the database for
      // a database season and the spreadsheet for the other.
      if (onDatabase) await reloadSeason(season)
      else await refreshLeagueFromSheet(LEAGUE_SHEET_URL)
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Refresh failed')
    }
  }

  const changeSeason = async (id: string) => {
    setSeasonId(id)
    setRefreshError(null)
    try {
      await setSeason(id)
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Could not load that season')
    }
  }

  return (
    <PokemonModalProvider>
      <header className="topbar" ref={topbarRef}>
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

          <div className="nav-tail">
            <span className={`refresh-stamp${refreshError ? ' is-error' : ''}`}>
              {refreshError
                ? refreshError
                : dataAt
                  ? `Updated ${dataAt.toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}`
                  : ''}
            </span>

            {/* Re-reads the master sheet. This only ever GETs — the sheet is
                read-only, see CLAUDE.md. */}
            <button
            type="button"
            className={`refresh-btn${refreshing ? ' is-busy' : ''}`}
            onClick={refresh}
            disabled={refreshing}
            title={refreshError ?? 'Fetch the latest data from the league sheet'}
            aria-label="Refresh league data from the sheet"
          >
            {refreshing ? (
              <span className="wave" aria-hidden="true">
                <i /><i /><i /><i /><i />
              </span>
            ) : (
              <span className="refresh-icon" aria-hidden="true">⟳</span>
            )}
              <span className="refresh-label">
                {refreshing ? 'Refreshing…' : refreshError ? 'Retry' : 'Refresh'}
              </span>
            </button>

            {/* One season for now; this is where other seasons or leagues will
                be chosen once there is more than one to import. */}
            {league && (
              <label className="season-picker">
                <select
                  value={season}
                  onChange={(e) => changeSeason(e.target.value)}
                  aria-label="League and season"
                >
                  {/* Labels come from the registry, not from the league in
                      hand: sourcing them from the loaded data made every option
                      take the name of whichever season was showing. */}
                  {SEASONS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>
            )}
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
