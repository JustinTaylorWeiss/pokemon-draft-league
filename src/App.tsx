import { useEffect, useState } from 'react'
import { QuickMatchup } from './features/quick-matchup/QuickMatchup'
import { LeagueView } from './features/league/LeagueView'
import { LEAGUE_TABS, type LeagueTab } from './features/league/tabs'
import { loadLeague, type League } from './data/league'
import { Dex } from './features/dex/Dex'
import './App.css'

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
  useEffect(() => { loadLeague().then(setLeague, () => {}) }, [])

  return (
    <>
      <header className="topbar">
        <div className="bar-inner">
          <span className="brand">Draft League</span>
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
            {league && (
              <div className="league-badge">
                <strong>{league.meta.name ?? 'Draft League'}</strong>
                <span>
                  {[league.meta.format, league.meta.regulation && `Reg ${league.meta.regulation}`,
                    league.meta.seriesLength, league.meta.weeks && `${league.meta.weeks} weeks`,
                    league.meta.picksPerPlayer && `${league.meta.picksPerPlayer} picks each`]
                    .filter(Boolean).join(' · ')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="shell">
        {view === 'league' && <LeagueView tab={leagueTab} />}
        {view === 'matchup' && <QuickMatchup />}
        {view === 'dex' && <Dex />}
      </main>
    </>
  )
}
