import { useEffect, useMemo, useState } from 'react'
import { Widget } from '../../components/Widget'
import type { LearnsetDex, MoveDex, SetDex, TypeChart } from '../../data/types'
import { loadSets } from '../../data/load'
import { DraftSummaryBody } from './DraftSummary'
import { DefensiveChartBody } from './DefensiveChart'
import { buildMoveRows, LearnedMovesBody } from './LearnedMoves'
import { CoverageBody } from './CoveragePanel'
import { useSpeedTiersPanel } from './useSpeedTiersPanel'
import type { Team } from './TeamEditor'
import { LoadingBall } from '../../components/LoadingBall'

const TABS = [
  { key: 'summary', label: 'Draft Summary' },
  { key: 'types', label: 'Defensive Type Chart' },
  { key: 'moves', label: 'Learned Moves' },
  { key: 'coverage', label: 'Coverage' },
]

/** Where the speed tiers sit once there is only one column to put them in:
    third, after the two team-wide readings and before the move lists. */
const SPEED_TAB = { key: 'speed', label: 'Speed Tiers' }
const SPEED_TAB_INDEX = 2

/** Chip pool floor. Below this, universal TMs hand out most of the type chart. */
const MIN_POWER = 60

interface Props {
  analyzed: Team
  other: Team
  chart: TypeChart
  moves: MoveDex
  /** Null until the largest data file finishes loading in the background. */
  learnsets: LearnsetDex | null
  /** Both rosters, for the speed tiers this card hosts in one-column layouts. */
  teamOne: Team
  teamTwo: Team
  hostSpeedTiers: boolean
}

/**
 * Every reading of the analyzed team — its stat line, what it resists, what it
 * can learn and what it can hit — behind one tab strip.
 *
 * Each tab's own controls appear in the header only while it is up. The two
 * Abilities toggles stay separate on purpose: one decides whether abilities
 * blunt incoming damage, the other whether they change what a move hits, so
 * folding them into one switch would silently move numbers on the tab you are
 * not looking at.
 */
export function AnalysisCard({
  analyzed, other, chart, moves, learnsets, teamOne, teamTwo, hostSpeedTiers,
}: Props) {
  const [tab, setTab] = useState('summary')
  const [neutral, setNeutral] = useState(80)
  const [defenseAbilities, setDefenseAbilities] = useState(true)
  const [coverageAbilities, setCoverageAbilities] = useState(true)
  const [resetKey, setResetKey] = useState(0)

  // Always built, shown only when this card is hosting it. The body is what
  // does the work, and that is only rendered on its own tab.
  const speed = useSpeedTiersPanel(teamOne, teamTwo)
  const tabs = hostSpeedTiers
    ? [...TABS.slice(0, SPEED_TAB_INDEX), SPEED_TAB, ...TABS.slice(SPEED_TAB_INDEX)]
    : TABS
  // A layout change can pull the tab out from under the reader.
  useEffect(() => {
    if (!hostSpeedTiers && tab === SPEED_TAB.key) setTab(TABS[0].key)
  }, [hostSpeedTiers, tab])

  const [sets, setSets] = useState<SetDex | null>(null)
  useEffect(() => { loadSets().then(setSets, () => {}) }, [])

  // Built here rather than inside LearnedMovesBody: this component stays
  // mounted across tab switches, so the work survives leaving the tab and
  // coming back instead of being redone each time.
  const moveRows = useMemo(
    () => (learnsets ? buildMoveRows(analyzed, moves, learnsets) : []),
    [analyzed, moves, learnsets],
  )
  const byId = useMemo(
    () => Object.fromEntries(analyzed.members.map((m) => [m.id, m.pokemon])),
    [analyzed.members],
  )

  const actions = {
    summary: (
      <label className="neutral-control">
        <span>Neutral</span>
        <input
          type="range" min={40} max={140} value={neutral}
          onChange={(e) => setNeutral(Number(e.target.value))}
        />
        <output>{neutral}</output>
      </label>
    ),
    types: (
      <label className="toggle">
        <input
          type="checkbox" checked={defenseAbilities}
          onChange={(e) => setDefenseAbilities(e.target.checked)}
        />
        <span>Abilities</span>
      </label>
    ),
    coverage: (
      <>
        <label className="toggle">
          <input
            type="checkbox" checked={coverageAbilities}
            onChange={(e) => setCoverageAbilities(e.target.checked)}
          />
          <span>Abilities</span>
        </label>
        <button type="button" className="btn ghost sm" onClick={() => setResetKey((k) => k + 1)}>Reset</button>
      </>
    ),
    speed: speed.actions,
  }[tab]

  const footnote = {
    types: 'Delta is resists minus weaknesses. Negative columns are types this team struggles to switch into.',
    coverage: 'Lit types are the Pokémon’s most-used set; the dim ones are everything else it can learn. Click any to toggle.',
    speed: speed.footnote,
  }[tab]

  return (
    <Widget
      tabs={tabs} active={tab} onTab={setTab} width={700}
      className="analysis-card" actions={actions} footnote={footnote}
    >
      {tab === 'summary' && (
        <DraftSummaryBody team={analyzed} neutral={neutral} />
      )}
      {tab === 'types' && (
        <DefensiveChartBody
          team={analyzed} chart={chart} useAbilities={defenseAbilities}
        />
      )}
      {/* Only these two need the learnsets, so the other tabs stay usable while
          that file is still downloading. */}
      {tab === 'moves' && (learnsets
        ? <LearnedMovesBody team={analyzed} rows={moveRows} byId={byId} />
        : <LoadingBall label="Loading learnsets…" inline />)}
      {tab === 'speed' && speed.body}
      {tab === 'coverage' && (learnsets
        ? (
          <CoverageBody
            attackers={analyzed} defenders={other} chart={chart} moves={moves} learnsets={learnsets}
            useAbilities={coverageAbilities} minPower={MIN_POWER} resetKey={resetKey}
            sets={sets}
          />
        )
        : <LoadingBall label="Loading learnsets…" inline />)}
    </Widget>
  )
}
