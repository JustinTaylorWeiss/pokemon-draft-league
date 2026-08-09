import { useEffect, useState } from 'react'
import { QuickMatchup } from './features/quick-matchup/QuickMatchup'
import { LeagueView } from './features/league/LeagueView'
import { LEAGUE_TABS, type LeagueTab } from './features/league/tabs'
import { loadLeague, type League } from './data/league'
import { Dex } from './features/dex/Dex'
import { PokemonModalProvider } from './features/pokemon/PokemonModalContext'
import { PokemonModal } from './features/pokemon/PokemonModal'
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
                <option value="current">{league.meta.name ?? 'Draft League'}</option>
              </select>
              <span className="season-detail">
                {[league.meta.format, league.meta.regulation && `Reg ${league.meta.regulation}`,
                  league.meta.seriesLength, league.meta.weeks && `${league.meta.weeks} weeks`,
                  league.meta.picksPerPlayer && `${league.meta.picksPerPlayer} picks each`]
                  .filter(Boolean).join(' · ')}
              </span>
            </label>
          )}
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
