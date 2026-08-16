import { useEffect, useState } from 'react'
import { useElementHeight } from './lib/useElementHeight'
import { QuickMatchup } from './features/quick-matchup/QuickMatchup'
import { LeagueView } from './features/league/LeagueView'
import { LEAGUE_TABS, type LeagueTab } from './features/league/tabs'
import { DropPicker } from './components/DropPicker'
import { myPlayerId, setMyPlayer, subscribeIdentity } from './data/identity'
import { ReportMatch } from './features/league/ReportMatch'
import { ManagePlayers } from './features/league/ManagePlayers'
import {
  currentSeason, isSheetBusy, leagueTimestamp, loadLeague, refreshLeagueFromSheet,
  reloadSeason, revalidateLeague, SEASONS, setSeason, subscribeLeague, subscribeSheetBusy,
  type League,
} from './data/league'
import { draftState, type DraftState } from './data/supabase'
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
type View = 'league' | 'matchup' | 'dex' | 'history'

const VIEWS: { key: View; label: string }[] = [
  { key: 'league', label: 'League' },
  { key: 'matchup', label: 'Quick Matchup' },
  { key: 'dex', label: 'Dex' },
  // The log covers every part of the league, not just the draft it started in.
  { key: 'history', label: 'History' },
]

export default function App() {
  const [view, setView] = useState<View>('league')
  // Lifted so the secondary bar can sit directly under the primary one.
  const [leagueTab, setLeagueTab] = useState<LeagueTab>('my-team')
  // Loaded here too so the secondary nav can name the season; the loader caches,
  // so this shares one fetch with the views below.
  const [league, setLeague] = useState<League | null>(null)
  // Driven by the data layer, so the button also animates through the read the
  // page starts on load — not only the one the button starts itself.
  const [refreshing, setRefreshing] = useState(isSheetBusy)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  /**
   * Whether a draft is open, read here rather than on the Draft List tab.
   *
   * An open draft changes what every tab in the League section means — a roster
   * change is a pick during one and a trade after it — so it belongs in the bar
   * that spans them, not on the one page that happens to start it.
   */
  const [draft, setDraft] = useState<DraftState | null>(null)
  /** Editing lives in the secondary bar, beside the tabs it acts on. */
  const [editing, setEditing] = useState<'match' | 'players' | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [me, setMeState] = useState(myPlayerId)
  useEffect(() => subscribeIdentity(setMeState), [])

  /**
   * Asked once, the first time somebody arrives without having said who they
   * are. Every edit is stamped with it, so a season's history is only worth
   * having if this is answered before the editing starts.
   */
  const askWho = !me && !!league?.players.length

  // Rules are read-only, so a stray click costs nothing and closing on one is
  // the quickest way out. Escape does the same.
  useEffect(() => {
    if (!rulesOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRulesOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rulesOpen])
  const [dataAt, setDataAt] = useState<Date | null>(null)
  const [season, setSeasonId] = useState(() => currentSeason().id)
  /**
   * The refresh button re-reads the spreadsheet, so it only means anything for
   * a season backed by one. A database season is already the source: it is
   * read on load and re-read after every edit, and there is no older copy for a
   * refresh to replace.
   */
  const source = SEASONS.find((s) => s.id === season)?.source
  const onDatabase = source === 'database'
  const fromSheet = source === 'sheet'

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

  // Re-read when the season changes, and whenever the league republishes —
  // which is what opening or closing the draft does.
  useEffect(() => {
    if (!onDatabase) { setDraft(null); return }
    let live = true
    draftState().then((d) => { if (live) setDraft(d) }, () => {})
    return () => { live = false }
  }, [onDatabase, season, league])

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
            {/* Rules describe the league itself rather than a view of its
                data, so they open over whatever you are looking at instead of
                replacing it. */}
            <button
              type="button"
              className={`rules-link${rulesOpen ? ' is-active' : ''}`}
              onClick={() => setRulesOpen((v) => !v)}
              aria-expanded={rulesOpen}
              aria-label="League rules"
              title="League rules"
            >
              ?
            </button>
            {league && league.players.length > 0 && (
              <DropPicker
                className="who-picker"
                ariaLabel="Which player you are"
                items={league.players.map((p) => ({ id: p.id, label: p.name, note: p.team }))}
                value={me}
                onPick={(p) => setMyPlayer(p.id, p.label)}
              />
            )}

            {fromSheet && (
            <span className={`refresh-stamp${refreshError ? ' is-error' : ''}`}>
              {refreshError
                ? refreshError
                : dataAt
                  ? `Updated ${dataAt.toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}`
                  : ''}
            </span>
            )}

            {/* Re-reads the master sheet. This only ever GETs — the sheet is
                read-only, see CLAUDE.md. */}
            {fromSheet && (
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
            )}

            {/* One season for now; this is where other seasons or leagues will
                be chosen once there is more than one to import. */}
            {league && (
              /* Labels come from the registry, not from the league in hand:
                 sourcing them from the loaded data made every option take the
                 name of whichever season was showing. */
              <DropPicker
                className="season-picker"
                ariaLabel="League and season"
                items={SEASONS.map((x) => ({
                  id: x.id,
                  label: x.label,
                  note: x.source === 'database' ? 'Edited on the site' : 'From the spreadsheet',
                }))}
                value={season}
                onPick={(x) => changeSeason(x.id)}
              />
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
            {/* Only a database season can be edited; the spreadsheet is read
                at its source and never written to. */}
            {onDatabase && (
              <div className="sub-actions">
                {draft?.status === 'active' && (
                  <span className="draft-live">
                    <span className="draft-dot" aria-hidden="true" />
                    Draft mode enabled
                  </span>
                )}
                <button type="button" onClick={() => setEditing('match')}>Record a match</button>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="shell">
        {view === 'league' && <LeagueView tab={leagueTab} />}
        {view === 'history' && <LeagueView tab="history" />}
        {view === 'matchup' && <QuickMatchup />}
        {view === 'dex' && <Dex />}
      </main>

      {askWho && league && (
        <div className="modal-backdrop">
          <div className="modal who-modal" role="dialog" aria-modal="true" aria-label="Who are you">
            <h2 className="report-title">Who are you?</h2>
            <p className="report-lead">
              Every change is recorded against a name, and the draft screen only
              lets you edit your own team. You can change this later beside the
              season.
            </p>
            <div className="who-grid">
              {league.players.map((p) => (
                <button
                  key={p.id} type="button"
                  onClick={() => setMyPlayer(p.id, p.name)}
                >
                  {p.name}
                  {p.team && <em>{p.team}</em>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {rulesOpen && (
        <div
          className="modal-backdrop rules-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setRulesOpen(false) }}
        >
          <div className="modal rules-modal" role="dialog" aria-modal="true" aria-label="League rules">
            <button
              type="button" className="modal-close"
              onClick={() => setRulesOpen(false)} aria-label="Close"
            >
              ✕
            </button>
            <LeagueView tab="rules" />
          </div>
        </div>
      )}

      {league && editing === 'match' && (
        <ReportMatch
          league={league}
          onClose={() => setEditing(null)}
          onSaved={() => reloadSeason(season)}
        />
      )}
      {league && editing === 'players' && (
        <ManagePlayers
          league={league}
          onClose={() => setEditing(null)}
          onSaved={() => reloadSeason(season)}
        />
      )}

      <PokemonModal />
    </PokemonModalProvider>
  )
}
