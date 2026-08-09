import { useCallback, useState } from 'react'
import { Widget } from '../../components/Widget'
import type { LearnsetDex, MoveDex, TypeChart } from '../../data/types'
import { LearnedMovesBody } from './LearnedMoves'
import { CoverageBody } from './CoveragePanel'
import type { Team } from './TeamEditor'

const TABS = [
  { key: 'moves', label: 'Learned Moves' },
  { key: 'coverage', label: 'Coverage' },
]

const POWER_STEPS = [0, 60, 75, 90]

interface Props {
  analyzed: Team
  other: Team
  chart: TypeChart
  moves: MoveDex
  learnsets: LearnsetDex
}

/**
 * Both answer "what can this team do offensively", so they share a card and
 * swap by tab. Coverage's controls sit in the header only while its tab is up.
 */
export function MovesAndCoverage({ analyzed, other, chart, moves, learnsets }: Props) {
  const [tab, setTab] = useState('moves')
  const [useAbilities, setUseAbilities] = useState(true)
  // 75 is roughly "a move you would actually click". At 0 nearly every Pokémon
  // reads 100% because Gen 9 TMs hand out weak coverage of half the type chart.
  const [minPower, setMinPower] = useState(75)
  const [resetKey, setResetKey] = useState(0)
  const [counts, setCounts] = useState({ shown: 0, total: 0 })

  const onCount = useCallback((shown: number, total: number) => setCounts({ shown, total }), [])

  const onCoverage = tab === 'coverage'

  return (
    <Widget
      tabs={TABS}
      active={tab}
      onTab={setTab}
      width={933}
      actions={onCoverage ? (
        <>
          <label className="toggle">
            <span>Min BP</span>
            <select value={minPower} onChange={(e) => setMinPower(Number(e.target.value))}>
              {POWER_STEPS.map((p) => <option key={p} value={p}>{p || 'any'}</option>)}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={useAbilities} onChange={(e) => setUseAbilities(e.target.checked)} />
            <span>Abilities</span>
          </label>
          <button type="button" className="btn ghost sm" onClick={() => setResetKey((k) => k + 1)}>Reset</button>
        </>
      ) : (
        <span className="widget-count">{counts.shown} of {counts.total}</span>
      )}
      footnote={onCoverage
        ? 'Percentages count opponents hit for at least 2×. Click a type to drop it from the calculation.'
        : undefined}
    >
      {onCoverage ? (
        <CoverageBody
          attackers={analyzed} defenders={other} chart={chart} moves={moves} learnsets={learnsets}
          useAbilities={useAbilities} minPower={minPower} resetKey={resetKey}
        />
      ) : (
        <LearnedMovesBody team={analyzed} moves={moves} learnsets={learnsets} onCount={onCount} />
      )}
    </Widget>
  )
}
