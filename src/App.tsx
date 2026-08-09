import { useState } from 'react'
import { QuickMatchup } from './features/quick-matchup/QuickMatchup'
import { LeagueView } from './features/league/LeagueView'
import { Dex } from './features/dex/Dex'
import './App.css'

type View = 'league' | 'matchup' | 'dex'

const VIEWS: { key: View; label: string }[] = [
  { key: 'league', label: 'League' },
  { key: 'matchup', label: 'Quick Matchup' },
  { key: 'dex', label: 'Dex' },
]

export default function App() {
  const [view, setView] = useState<View>('league')

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Draft League</h1>
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
      </header>

      <main>
        {view === 'league' && <LeagueView />}
        {view === 'matchup' && <QuickMatchup />}
        {view === 'dex' && <Dex />}
      </main>
    </div>
  )
}
