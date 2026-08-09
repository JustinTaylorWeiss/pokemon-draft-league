import { useState } from 'react'
import { QuickMatchup } from './features/quick-matchup/QuickMatchup'
import { Dex } from './features/dex/Dex'
import './App.css'

type View = 'matchup' | 'dex'

export default function App() {
  const [view, setView] = useState<View>('matchup')

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Draft League</h1>
        <nav className="main-nav">
          <button type="button" className={view === 'matchup' ? 'is-active' : ''} onClick={() => setView('matchup')}>
            Quick Matchup
          </button>
          <button type="button" className={view === 'dex' ? 'is-active' : ''} onClick={() => setView('dex')}>
            Dex
          </button>
        </nav>
      </header>

      <main>{view === 'matchup' ? <QuickMatchup /> : <Dex />}</main>
    </div>
  )
}
