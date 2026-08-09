import { useEffect, useState } from 'react'
import { Widget } from '../../components/Widget'
import type { LearnsetDex, MoveDex, SetDex, TypeChart } from '../../data/types'
import { loadSets } from '../../data/load'
import { LearnedMovesBody } from './LearnedMoves'
import { CoverageBody } from './CoveragePanel'
import type { Team } from './TeamEditor'

const TABS = [
  { key: 'moves', label: 'Learned Moves' },
  { key: 'coverage', label: 'Coverage' },
]

/** Chip pool floor. Below this, universal TMs hand out most of the type chart. */
const MIN_POWER = 60

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
  const [resetKey, setResetKey] = useState(0)
  const [sets, setSets] = useState<SetDex | null>(null)
  useEffect(() => { loadSets().then(setSets, () => {}) }, [])

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
            <input type="checkbox" checked={useAbilities} onChange={(e) => setUseAbilities(e.target.checked)} />
            <span>Abilities</span>
          </label>
          <button type="button" className="btn ghost sm" onClick={() => setResetKey((k) => k + 1)}>Reset</button>
        </>
      ) : undefined}
      footnote={onCoverage
        ? 'Lit types are the Pokémon\u2019s most-used set; the dim ones are everything else it can learn. Click any to toggle.'
        : undefined}
    >
      {onCoverage ? (
        <CoverageBody
          attackers={analyzed} defenders={other} chart={chart} moves={moves} learnsets={learnsets}
          useAbilities={useAbilities} minPower={MIN_POWER} resetKey={resetKey}
          sets={sets}
        />
      ) : (
        <LearnedMovesBody team={analyzed} moves={moves} learnsets={learnsets} />
      )}
    </Widget>
  )
}
