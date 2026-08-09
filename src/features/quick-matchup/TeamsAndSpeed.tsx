import { useState } from 'react'
import { Widget } from '../../components/Widget'
import { TeamsBody } from './Overview'
import { SpeedTiersBody } from './SpeedTiers'
import type { Team } from './TeamEditor'

const TABS = [
  { key: 'teams', label: 'Teams' },
  { key: 'speed', label: 'Speed Tiers' },
]

/**
 * Both views describe the same two rosters, so they share a card and swap by
 * tab rather than taking up two slots in the grid.
 */
interface Props {
  teamOne: Team
  teamTwo: Team
  /** Height of the column beside this card; the speed list scrolls within it. */
  maxHeight: number | null
}

export function TeamsAndSpeed({ teamOne, teamTwo, maxHeight }: Props) {
  const [tab, setTab] = useState('teams')
  const [showZero, setShowZero] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const onSpeed = tab === 'speed'

  return (
    <Widget
      tabs={TABS}
      active={tab}
      onTab={setTab}
      width={420}
      // Only the speed list runs long enough to need capping.
      className={onSpeed ? 'stretch-tall' : undefined}
      maxHeight={onSpeed ? maxHeight : null}
      actions={onSpeed ? (
        <label className="toggle">
          <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
          <span>Uninvested</span>
        </label>
      ) : undefined}
      footnote={onSpeed
        ? (selected ? 'Click again to clear the selection.' : 'Click a Pokémon to trace it through the tiers.')
        : undefined}
    >
      {onSpeed ? (
        <SpeedTiersBody
          teamOne={teamOne} teamTwo={teamTwo}
          showZero={showZero} selected={selected} onSelect={setSelected}
        />
      ) : (
        <TeamsBody teamOne={teamOne} teamTwo={teamTwo} />
      )}
    </Widget>
  )
}
