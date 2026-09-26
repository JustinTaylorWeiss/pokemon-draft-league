import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Widget } from '../../components/Widget'
import type { LearnsetDex, MoveDex, SetDex, TypeChart } from '../../data/types'
import { loadSets } from '../../data/load'
import { DraftSummaryBody } from './DraftSummary'
import { DefensiveChartBody } from './DefensiveChart'
import { buildMoveRows, LearnedMovesBody } from './LearnedMoves'
import { CoverageBody } from './CoveragePanel'
import { useSpeedTiersPanel } from './useSpeedTiersPanel'
import { TeamName } from '../../components/TeamName'
import { ZoomControl } from './ZoomControl'
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
  chart: TypeChart
  moves: MoveDex
  /** Null until the largest data file finishes loading in the background. */
  learnsets: LearnsetDex | null
  /** Both rosters. Every tab reads both; none of them picks one. */
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
  chart, moves, learnsets, teamOne, teamTwo, dex, solo,
}: Props) {
  const [tab, setTab] = useState('summary')
  const [neutral, setNeutral] = useState(80)
  const [defenseAbilities, setDefenseAbilities] = useState(true)
  const [coverageAbilities, setCoverageAbilities] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  // 1 means "as large as fits the card", which is where the chart starts.
  const [typesZoom, setTypesZoom] = useState(1)

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
  const moveRows = useMemo(() => ({
    one: learnsets ? buildMoveRows(teamOne, moves, learnsets) : [],
    two: learnsets ? buildMoveRows(teamTwo, moves, learnsets) : [],
  }), [teamOne, teamTwo, moves, learnsets])
  const byId = useMemo(() => Object.fromEntries(
    [...teamOne.members, ...teamTwo.members].map((m) => [m.id, m.pokemon]),
  ), [teamOne.members, teamTwo.members])

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
      <>
        <label className="toggle">
          <input
            type="checkbox" checked={defenseAbilities}
            onChange={(e) => setDefenseAbilities(e.target.checked)}
          />
          <span>Abilities</span>
        </label>
        <ZoomControl value={typesZoom} onChange={setTypesZoom} />
      </>
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
        <TeamPair one={teamOne} two={teamTwo}>
          {(team) => <DraftSummaryBody team={team} neutral={neutral} />}
        </TeamPair>
      )}
      {tab === 'types' && (
        <TeamPair one={teamOne} two={teamTwo}>
          {(team) => (
            <DefensiveChartBody
              team={team} chart={chart} useAbilities={defenseAbilities} zoom={typesZoom}
            />
          )}
        </TeamPair>
      )}
      {/* Only these two need the learnsets, so the other tabs stay usable while
          that file is still downloading. */}
      {tab === 'moves' && (learnsets
        ? (
          <TeamPair one={teamOne} two={teamTwo}>
            {(team, side) => <LearnedMovesBody team={team} rows={moveRows[side]} byId={byId} />}
          </TeamPair>
        )
        : <LoadingBall label="Loading learnsets…" inline />)}
      {tab === 'speed' && speed.body}
      {tab === 'coverage' && (learnsets
        ? (
          <TeamPair one={teamOne} two={teamTwo}>
            {(team, side) => (
              <CoverageBody
                attackers={team} defenders={side === 'one' ? teamTwo : teamOne}
                chart={chart} moves={moves} learnsets={learnsets}
                useAbilities={coverageAbilities} minPower={MIN_POWER} resetKey={resetKey}
                sets={sets}
              />
            )}
          </TeamPair>
        )
        : <LoadingBall label="Loading learnsets…" inline />)}
    </Widget>
  )
}

/**
 * Both sides of a tab, each under its own name in its own colour.
 *
 * Every reading here used to be of one team, picked by a toggle in the bar
 * above — so the comparison the tool exists for was a toggle and a memory
 * apart. Both sides are on every tab now and the toggle is gone.
 *
 * Left and right, always, so the comparison is a glance across rather than a
 * scroll down. The panels sized to their box take the halving themselves, and
 * the type chart — the one that feels it, at nineteen columns — has a zoom
 * slider for when half a card is tight. Only a phone stacks them.
 *
 * One side on its own gets no heading — there is nothing to tell it from.
 */
function TeamPair({ one, two, children }: {
  one: Team
  two: Team
  children: (team: Team, side: 'one' | 'two') => ReactNode
}) {
  if (!two.members.length) return <>{children(one, 'one')}</>
  const sides: ['one' | 'two', Team, string][] = [
    ['one', one, one.name || 'Team 1'],
    ['two', two, two.name || 'Team 2'],
  ]
  return (
    <div className="panel-pair">
      {sides.map(([side, team, name]) => (
        <section key={side} className={`panel-side accent-${side}`}>
          <h3><TeamName name={name} /></h3>
          {children(team, side)}
        </section>
      ))}
    </div>
  )
}
