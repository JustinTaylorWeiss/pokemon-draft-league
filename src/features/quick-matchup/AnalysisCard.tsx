import { useEffect, useMemo, useState } from 'react'
import { Widget } from '../../components/Widget'
import type { LearnsetDex, MoveDex, SetDex, TypeChart } from '../../data/types'
import { loadSets } from '../../data/load'
import { DraftSummaryBody, DraftSummaryPair } from './DraftSummary'
import { DefensiveChartBody } from './DefensiveChart'
import { buildMoveRows, LearnedMovesBody } from './LearnedMoves'
import { CoverageBody } from './CoveragePanel'
import { useSpeedTiersPanel } from './useSpeedTiersPanel'
import type { LeagueDex } from '../../data/league'
import type { Team } from './TeamEditor'
import { LoadingBall } from '../../components/LoadingBall'

/*
 * Speed tiers sit third, after the two team-wide readings and before the move
 * lists. They used to belong to a second card beside this one and moved here
 * only when the screen was too narrow for two; that card is gone, so this is
 * simply where they live.
 */
const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'types', label: 'Defensive Type Chart' },
  { key: 'speed', label: 'Speed Tiers' },
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
  /** Null until the largest data file finishes loading in the background. */
  learnsets: LearnsetDex | null
  /** Both rosters: the speed tiers interleave them and the summary pairs them. */
  teamOne: Team
  teamTwo: Team
  /** Speed tiers add the formes the Megas start in, which needs looking up. */
  dex: LeagueDex
  /** One team, read on its own: no opponent, so no Coverage. */
  solo?: boolean
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
  analyzed, other, chart, moves, learnsets, teamOne, teamTwo, dex, solo,
}: Props) {
  const [tab, setTab] = useState('summary')
  const [neutral, setNeutral] = useState(80)
  const [defenseAbilities, setDefenseAbilities] = useState(true)
  const [coverageAbilities, setCoverageAbilities] = useState(true)
  const [resetKey, setResetKey] = useState(0)

  const speed = useSpeedTiersPanel(teamOne, teamTwo, dex)
  // Coverage is the one reading that needs somebody on the other side: what a
  // team hits is a fact about the team it is hitting. Every other tab here is
  // about the analysed team alone, so solo keeps them all and drops that one.
  const tabs = solo ? TABS.filter((t) => t.key !== 'coverage') : TABS
  useEffect(() => {
    if (solo && tab === 'coverage') setTab(TABS[0].key)
  }, [solo, tab])

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
      {tab === 'summary' && (solo
        ? <DraftSummaryBody team={analyzed} neutral={neutral} />
        : <DraftSummaryPair teamOne={teamOne} teamTwo={teamTwo} neutral={neutral} />)}
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
