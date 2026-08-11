import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { SpeedTiersBody } from './SpeedTiers'
import { SpeedFilter } from './SpeedFilter'
import { defaultSpeedFilter, speedFilterRows } from '../../lib/stats'
import type { Team } from './TeamEditor'

/**
 * The speed tiers panel — its state, its header controls and its body — as one
 * unit that any card can host.
 *
 * It lives here rather than inside a card because which card owns it depends on
 * the layout: beside the teams list when there is room for two columns, and as
 * a tab of the analysis card when there is not.
 */
export function useSpeedTiersPanel(teamOne: Team, teamTwo: Team): {
  actions: ReactNode
  body: ReactNode
  footnote: string
} {
  const [selected, setSelected] = useState<string | null>(null)
  // This league plays doubles at 50, which is what the numbers should mean by
  // default; 100 is there for anyone reading singles tiers across.
  const [level, setLevel] = useState(50)

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
    setFilterOne(defaultSpeedFilter(both))
    setFilterTwo(defaultSpeedFilter(both))
  }

  return {
    actions: (
      <>
        <SpeedFilter
          rows={rows}
          oneName={teamOne.name || 'Team 1'}
          twoName={teamTwo.name || 'Team 2'}
          filterOne={filterOne} filterTwo={filterTwo}
          onChange={setFilter} onReset={reset}
        />
        <label className="level-picker">
          <span>Lv</span>
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </>
    ),
    body: (
      <SpeedTiersBody
        teamOne={teamOne} teamTwo={teamTwo}
        filterOne={filterOne} filterTwo={filterTwo} level={level}
        selected={selected} onSelect={setSelected}
      />
    ),
    footnote: selected
      ? 'Click again to clear the selection.'
      : 'Click a Pokémon to trace it through the tiers.',
  }
}
