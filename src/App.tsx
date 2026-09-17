import { useEffect, useState } from 'react'
import { useElementHeight } from './lib/useElementHeight'
import { QuickMatchup } from './features/quick-matchup/QuickMatchup'
import { LeagueView } from './features/league/LeagueView'
import { LEAGUE_TABS, type LeagueTab } from './features/league/tabs'
import { DropPicker } from './components/DropPicker'
import {
  forgetMyPlayer, isSpectator, myPlayerId, setMyPlayer, SPECTATOR, subscribeIdentity,
} from './data/identity'
import { ReportMatch } from './features/league/ReportMatch'
import { ManagePlayers } from './features/league/ManagePlayers'
import {
  currentSeason, loadLeague, reloadSeason, SEASONS, setSeason, subscribeLeague,
  type League,
} from './data/league'
import { draftState, type DraftState } from './data/supabase'
import { Dex } from './features/dex/Dex'
import { PokemonModalProvider } from './features/pokemon/PokemonModalContext'
import { PokemonModal } from './features/pokemon/PokemonModal'
import './App.css'

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
  const [loadError, setLoadError] = useState<string | null>(null)
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


  // Rules are read-only, so a stray click costs nothing and closing on one is
  // the quickest way out. Escape does the same.
  useEffect(() => {
    if (!rulesOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRulesOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rulesOpen])
  const [season, setSeasonId] = useState(() => currentSeason().id)

  // Who you are is stored per season, so switching seasons means re-reading it
  // — and usually finding nothing, which is what raises the question again.
  useEffect(() => { setMeState(myPlayerId()) }, [season])
  const source = SEASONS.find((s) => s.id === season)?.source
  const onDatabase = source === 'database'

  /**
   * Asked whenever the site does not know who it is talking to in a season it
   * can edit. Every edit is stamped with it, so a season's history is only
   * worth having if this is answered before the editing starts.
   *
   * Only for a season backed by the database. The spreadsheet season is read
   * here and written nowhere, so there is nothing to stamp and nothing to
   * unlock — asking would be a question with no consequence attached.
   *
   * Two ways not to know: nobody has said yet, or the player they said has
   * since been removed. `league.players` has hidden players filtered out
   * already, so being absent from it is the same question either way — and the
   * stale answer is forgotten rather than left to stamp edits with somebody the
   * season has removed.
   */
  const players = league?.players ?? []
  /**
   * The player you said you were is not in the league any more, so the question
   * has to be asked again. A spectator is not a player and never will be in
   * this list, which is not the same thing as having been removed from it.
   */
  const gone = onDatabase && !!me && !isSpectator(me)
    && players.length > 0 && !players.some((p) => p.id === me)
  /**
   * Whether this browser may change anything without a passphrase. Recording a
   * match and renaming a team are open to any player, which is the league
   * trusting itself; somebody watching has not said they are part of it.
   */
  const canEdit = onDatabase && !isSpectator(me)

  useEffect(() => { if (gone) forgetMyPlayer() }, [gone])

  const askWho = onDatabase && (!me || gone) && players.length > 0

  // The primary bar wraps to two rows on narrow screens, so the secondary bar
  // cannot assume a fixed offset to stick below.
  const [topbarRef, topbarHeight] = useElementHeight<HTMLElement>()
  useEffect(() => {
    if (topbarHeight) document.documentElement.style.setProperty('--topbar-h', `${topbarHeight}px`)
  }, [topbarHeight])

  useEffect(() => {
    loadLeague().then(setLeague, () => {})
    // Republished when the season changes, and every view listens for it.
    return subscribeLeague(setLeague)
  }, [])

  // Re-read when the season changes, and whenever the league republishes —
  // which is what opening or closing the draft does.
  useEffect(() => {
    if (!onDatabase) { setDraft(null); return }
    let live = true
    draftState().then((d) => { if (live) setDraft(d) }, () => {})
    return () => { live = false }
  }, [onDatabase, season, league])

  const changeSeason = async (id: string) => {
    setSeasonId(id)
    setLoadError(null)
    try {
      await setSeason(id)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load that season')
    }
  }

  return (
    <PokemonModalProvider>
      {/* Both bars in one sticky box. The sub-bar used to stick at
          `top: var(--topbar-h)`, a value measured in JavaScript and written
          after the first paint — so on load the bar moved the moment the real
          height arrived, and Safari left the underline it had already painted
          behind at the old offset. Stuck together they need no measurement and
          nothing shifts. */}
      <div className="bars">
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
            {/* Only where a name means something. Season 4 is a finished
                record that cannot be edited, so there is nothing to stamp and
                no team of yours to single out. */}
            {onDatabase && league && league.players.length > 0 && (
              <DropPicker
                className="who-picker"
                ariaLabel="Which player you are"
                items={[
                  ...league.players.map((p) => ({ id: p.id, label: p.name, note: p.team })),
                  { id: SPECTATOR, label: 'Spectator', note: 'Watching, not playing' },
                ]}
                value={me}
                onPick={(p) => setMyPlayer(p.id, p.label)}
              />
            )}

            {/* Switching seasons is the only thing left here that can fail, and
                it failing silently would leave the wrong season on screen. */}
            {loadError && <span className="refresh-stamp is-error">{loadError}</span>}

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
              {LEAGUE_TABS.map((t) => ({
                ...t,
                label: t.key === 'my-team' && !onDatabase ? 'Teams' : t.label,
              })).map((t) => (
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
                {canEdit && (
                  <button type="button" onClick={() => setEditing('match')}>Record a match</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </div>

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
            {/* The way past without claiming to be one of them. Set apart from
                the names rather than listed among them, because it is not a
                nineteenth coach — it is the answer "none of these". */}
            <button
              type="button" className="who-spectate"
              onClick={() => setMyPlayer(SPECTATOR, 'Spectator')}
            >
              I am just watching
              <em>See everything, change nothing</em>
            </button>
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
