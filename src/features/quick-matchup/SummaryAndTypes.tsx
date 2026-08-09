import { useEffect, useState } from 'react'
import { Widget } from '../../components/Widget'
import type { AbilityDex, TypeChart } from '../../data/types'
import { loadAbilities } from '../../data/load'
import { DraftSummaryBody } from './DraftSummary'
import { DefensiveChartBody } from './DefensiveChart'
import type { Team } from './TeamEditor'

const TABS = [
  { key: 'summary', label: 'Draft Summary' },
  { key: 'types', label: 'Defensive Type Chart' },
]

/** Two readings of the same team's stat line, sharing one card. */
export function SummaryAndTypes({ team, chart }: { team: Team; chart: TypeChart }) {
  const [tab, setTab] = useState('summary')
  const [neutral, setNeutral] = useState(80)
  const [useAbilities, setUseAbilities] = useState(true)
  // Descriptions for the ability pills' tooltips.
  const [abilityDex, setAbilityDex] = useState<AbilityDex | null>(null)
  useEffect(() => { loadAbilities().then(setAbilityDex, () => {}) }, [])

  const onTypes = tab === 'types'

  return (
    <Widget
      tabs={TABS}
      active={tab}
      onTab={setTab}
      width={933}
      actions={onTypes ? (
        <label className="toggle">
          <input type="checkbox" checked={useAbilities} onChange={(e) => setUseAbilities(e.target.checked)} />
          <span>Abilities</span>
        </label>
      ) : (
        <label className="neutral-control">
          <span>Neutral</span>
          <input
            type="range" min={40} max={140} value={neutral}
            onChange={(e) => setNeutral(Number(e.target.value))}
          />
          <output>{neutral}</output>
        </label>
      )}
      footnote={onTypes
        ? 'Delta is resists minus weaknesses. Negative columns are types this team struggles to switch into.'
        : 'Bulk is HP × the matching defense ÷ 100 — BST hides that HP multiplies with defenses instead of adding to them.'}
    >
      {onTypes
        ? <DefensiveChartBody team={team} chart={chart} useAbilities={useAbilities} />
        : <DraftSummaryBody team={team} neutral={neutral} abilities={abilityDex} />}
    </Widget>
  )
}
