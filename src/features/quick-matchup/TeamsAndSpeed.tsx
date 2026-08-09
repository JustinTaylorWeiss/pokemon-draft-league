import { useEffect, useMemo, useState } from 'react'
import { Widget } from '../../components/Widget'
import { TeamsBody } from './Overview'
import { SpeedTiersBody } from './SpeedTiers'
import { SpeedFilter } from './SpeedFilter'
import { defaultSpeedFilter, speedFilterRows } from '../../lib/stats'
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
}

export function TeamsAndSpeed({ teamOne, teamTwo }: Props) {
  const [tab, setTab] = useState('teams')
  const [selected, setSelected] = useState<string | null>(null)

  // Both the row list and the defaults come off the combined roster, so the two
  // columns start symmetric the way DraftZone's do.
  const both = useMemo(
    () => [...teamOne.members, ...teamTwo.members],
    [teamOne.members, teamTwo.members],
  )
  // Which rows the filter offers depends on the rosters: the spreads and stages
  // are fixed, but an ability row only appears if someone actually has it.
  const rows = useMemo(() => speedFilterRows(both), [both])
  const [filterOne, setFilterOne] = useState<Set<string>>(() => defaultSpeedFilter(both))
  const [filterTwo, setFilterTwo] = useState<Set<string>>(() => defaultSpeedFilter(both))

  // A roster change can add or remove ability rows, so the defaults are
  // recomputed rather than left pointing at abilities nobody has any more.
  useEffect(() => {
    setFilterOne(defaultSpeedFilter(both))
    setFilterTwo(defaultSpeedFilter(both))
  }, [both])

  const onSpeed = tab === 'speed'

  const setFilter = (side: 'one' | 'two', key: string, on: boolean) => {
    const apply = (prev: Set<string>) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    }
    if (side === 'one') setFilterOne(apply)
    else setFilterTwo(apply)
  }

  const reset = () => {
    setFilterOne(defaultSpeedFilter(teamOne.members))
    setFilterTwo(defaultSpeedFilter(teamTwo.members))
  }

  return (
    <Widget
      tabs={TABS}
      active={tab}
      onTab={setTab}
      width={420}
      className="both-teams"
      actions={onSpeed ? (
        <SpeedFilter
          rows={rows}
          oneName={teamOne.name || 'Team 1'}
          twoName={teamTwo.name || 'Team 2'}
          filterOne={filterOne} filterTwo={filterTwo}
          onChange={setFilter} onReset={reset}
        />
      ) : undefined}
      footnote={onSpeed
        ? (selected ? 'Click again to clear the selection.' : 'Click a Pokémon to trace it through the tiers.')
        : undefined}
    >
      {onSpeed ? (
        <SpeedTiersBody
          teamOne={teamOne} teamTwo={teamTwo}
          filterOne={filterOne} filterTwo={filterTwo}
          selected={selected} onSelect={setSelected}
        />
      ) : (
        <TeamsBody teamOne={teamOne} teamTwo={teamTwo} />
      )}
    </Widget>
  )
}
