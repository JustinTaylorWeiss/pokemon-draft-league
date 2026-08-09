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
  // Coverage defaults to what people actually run rather than every move a
  // Pokémon could learn, which otherwise reports near-100% for everyone.
  const [useCommonSets, setUseCommonSets] = useState(true)
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
            <span>Moves</span>
            <select
              value={useCommonSets ? 'common' : 'all'}
              onChange={(e) => setUseCommonSets(e.target.value === 'common')}
            >
              <option value="common">Common set</option>
              <option value="all">Full movepool</option>
            </select>
          </label>
          {!useCommonSets && (
            <label className="toggle">
              <span>Min BP</span>
              <select value={minPower} onChange={(e) => setMinPower(Number(e.target.value))}>
                {POWER_STEPS.map((p) => <option key={p} value={p}>{p || 'any'}</option>)}
              </select>
            </label>
          )}
          <label className="toggle">
            <input type="checkbox" checked={useAbilities} onChange={(e) => setUseAbilities(e.target.checked)} />
            <span>Abilities</span>
          </label>
          <button type="button" className="btn ghost sm" onClick={() => setResetKey((k) => k + 1)}>Reset</button>
        </>
      ) : undefined}
      footnote={onCoverage
        ? (useCommonSets
          ? 'Types come from each Pokémon\u2019s most-used set. Click a type to drop it from the calculation.'
          : 'Every move at or above the power floor. Click a type to drop it from the calculation.')
        : undefined}
    >
      {onCoverage ? (
        <CoverageBody
          attackers={analyzed} defenders={other} chart={chart} moves={moves} learnsets={learnsets}
          useAbilities={useAbilities} minPower={minPower} resetKey={resetKey}
          sets={useCommonSets ? sets : null}
        />
      ) : (
        <LearnedMovesBody team={analyzed} moves={moves} learnsets={learnsets} />
      )}
    </Widget>
  )
}
