import { useEffect, useMemo, useState } from 'react'
import { Widget } from '../../components/Widget'
import type { AbilityDex, LearnsetDex, MoveDex, SetDex, TypeChart } from '../../data/types'
import { loadAbilities, loadSets } from '../../data/load'
import { DraftSummaryBody } from './DraftSummary'
import { DefensiveChartBody } from './DefensiveChart'
import { buildMoveRows, LearnedMovesBody } from './LearnedMoves'
import { CoverageBody } from './CoveragePanel'
import type { Team } from './TeamEditor'

const TABS = [
  { key: 'summary', label: 'Draft Summary' },
  { key: 'types', label: 'Defensive Type Chart' },
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
export function AnalysisCard({ analyzed, other, chart, moves, learnsets }: Props) {
  const [tab, setTab] = useState('summary')
  const [neutral, setNeutral] = useState(80)
  const [defenseAbilities, setDefenseAbilities] = useState(true)
  const [coverageAbilities, setCoverageAbilities] = useState(true)
  const [resetKey, setResetKey] = useState(0)

  // Descriptions for the ability pills' tooltips.
  const [abilityDex, setAbilityDex] = useState<AbilityDex | null>(null)
  useEffect(() => { loadAbilities().then(setAbilityDex, () => {}) }, [])
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
  }[tab]

  const footnote = {
    types: 'Delta is resists minus weaknesses. Negative columns are types this team struggles to switch into.',
    coverage: 'Lit types are the Pokémon’s most-used set; the dim ones are everything else it can learn. Click any to toggle.',
  }[tab]

  return (
    <Widget
      tabs={TABS} active={tab} onTab={setTab} width={700}
      className="analysis-card" actions={actions} footnote={footnote}
    >
      {tab === 'summary' && (
        <DraftSummaryBody team={analyzed} neutral={neutral} abilities={abilityDex} />
      )}
      {tab === 'types' && (
        <DefensiveChartBody team={analyzed} chart={chart} useAbilities={defenseAbilities} />
      )}
      {/* Only these two need the learnsets, so the other tabs stay usable while
          that file is still downloading. */}
      {tab === 'moves' && (learnsets
        ? <LearnedMovesBody team={analyzed} rows={moveRows} byId={byId} />
        : <p className="loading">Loading learnsets…</p>)}
      {tab === 'coverage' && (learnsets
        ? (
          <CoverageBody
            attackers={analyzed} defenders={other} chart={chart} moves={moves} learnsets={learnsets}
            useAbilities={coverageAbilities} minPower={MIN_POWER} resetKey={resetKey}
            sets={sets}
          />
        )
        : <p className="loading">Loading learnsets…</p>)}
    </Widget>
  )
}
