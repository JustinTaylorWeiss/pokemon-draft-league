import { useState } from 'react'
import { Widget } from '../../components/Widget'
import { TeamsBody } from './Overview'
import { useSpeedTiersPanel } from './useSpeedTiersPanel'
import type { Team } from './TeamEditor'

const TABS = [
  { key: 'teams', label: 'Teams' },
  { key: 'speed', label: 'Speed Tiers' },
]

/**
 * Both views describe the same two rosters, so they share a card and swap by
 * tab rather than taking up two slots in the grid.
 *
 * Only rendered when there is room for two columns. Below that the analysis
 * card hosts the speed tiers and this card, roster list included, goes away.
 */
interface Props {
  teamOne: Team
  teamTwo: Team
}

export function TeamsAndSpeed({ teamOne, teamTwo }: Props) {
  const [tab, setTab] = useState('teams')
  const speed = useSpeedTiersPanel(teamOne, teamTwo)
  const onSpeed = tab === 'speed'

  return (
    <Widget
      tabs={TABS}
      active={tab}
      onTab={setTab}
      width={420}
      className="both-teams"
      actions={onSpeed ? speed.actions : undefined}
      footnote={onSpeed ? speed.footnote : undefined}
    >
      {onSpeed ? speed.body : <TeamsBody teamOne={teamOne} teamTwo={teamTwo} />}
    </Widget>
  )
}
