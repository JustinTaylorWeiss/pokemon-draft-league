import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LearnsetDex, MoveDex, SetDex, TypeChart } from '../../data/types'
import { loadSets } from '../../data/load'
import { DraftSummaryBody } from './DraftSummary'
import { DefensiveChartBody } from './DefensiveChart'
import { buildMoveRows, LearnedMovesBody } from './LearnedMoves'
import { CoverageBody } from './CoveragePanel'
import { EvCalcBody, EvHelp } from './EvCalc'
import { useSpeedTiersPanel } from './useSpeedTiersPanel'
import { TeamName } from '../../components/TeamName'
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
  // Last, because it is the one you open having decided everything else.
  { key: 'evs', label: 'EV Calc' },
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
  /** The damaging moves the format plays, for the Pokémon with no usage set. */
  played: string[]
  /** One team, read on its own: no opponent, so no Coverage. */
  solo?: boolean
  /** What sits at the left of the bar, before the tabs. The page's, not ours. */
  lead?: ReactNode
  /** And what sits at the far right of it, past this card's own controls. */
  trail?: ReactNode
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
  chart, moves, learnsets, teamOne, teamTwo, dex, played, solo, lead, trail,
}: Props) {
  const [tab, setTab] = useState('summary')
  const [neutral, setNeutral] = useState(80)
  const [defenseAbilities, setDefenseAbilities] = useState(true)
  const [coverageAbilities, setCoverageAbilities] = useState(true)
  /**
   * How the two teams sit on a tab. Side by side answers "how do these
   * compare"; one above the other gives each panel the card's full width,
   * which the type chart and the move grid would rather have. Neither is
   * right for every tab or every window, so it is the reader's call, and it
   * is one call for the card rather than one per tab.
   */
  const [abreast, setAbreast] = useState(true)
  /**
   * One level for the card, not one per tab. The speed tiers and the EV
   * calculator are answering the same question at the same level, and two
   * pickers that could disagree is two chances to read the wrong number.
   * The league plays at 50; 100 is there for reading singles across.
   */
  const [level, setLevel] = useState(50)

  const speed = useSpeedTiersPanel(teamOne, teamTwo, dex, level)
  // Coverage is the one reading that needs somebody on the other side: what a
  // team hits is a fact about the team it is hitting. Every other tab here is
  // about the analysed team alone, so solo keeps them all and drops that one.
  // Coverage and the EV calculator both need somebody on the other side:
  // what a team hits, and what to build against, are facts about the team it
  // is facing. The rest are about the analysed team alone.
  const tabs = solo ? TABS.filter((t) => t.key !== 'coverage' && t.key !== 'evs') : TABS
  useEffect(() => {
    if (solo && (tab === 'coverage' || tab === 'evs')) setTab(TABS[0].key)
  }, [solo, tab])

  const [sets, setSets] = useState<SetDex | null>(null)
  useEffect(() => { loadSets().then(setSets, () => {}) }, [])
  const [help, setHelp] = useState(false)

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

  // Level first on the tabs that read at one: every number on them is read
  // at it, and the controls beside it only narrow what is shown within that.
  const levelPicker = (
    <label className="level-picker">
      <span>Lv</span>
      <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
        <option value={50}>50</option>
        <option value={100}>100</option>
      </select>
    </label>
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
      <button
        type="button" className="pill-toggle" aria-pressed={defenseAbilities}
        onClick={() => setDefenseAbilities((on) => !on)}
      >
        Abilities
      </button>
    ),
    coverage: (
      <button
        type="button" className="pill-toggle" aria-pressed={coverageAbilities}
        onClick={() => setCoverageAbilities((on) => !on)}
      >
        Abilities
      </button>
    ),
    speed: <>{levelPicker}{speed.actions}</>,
    // The one tab dense enough to need saying out loud what it is for.
    evs: (
      <>
        <button
          type="button"
          className="sub-help"
          aria-label="How the EV calculator works"
          title="How the EV calculator works"
          onClick={() => setHelp(true)}
        >
          ?
        </button>
        {levelPicker}
      </>
    ),
  }[tab]

  // On every tab that shows the two teams as a pair, which is all of them bar
  // the speed tiers — those interleave both sides into one list.
  const pairing = teamTwo.members.length > 0 && tab !== 'speed' && tab !== 'evs' && (
    // A button rather than a checkbox: it does not tick a condition, it puts
    // the page one way or the other, and `aria-pressed` says which way it is.
    <button
      type="button" className="pill-toggle" aria-pressed={abreast}
      onClick={() => setAbreast((on) => !on)}
    >
      Side by side
    </button>
  )

  const footnote = {
    types: 'Delta is resists minus weaknesses. Negative columns are types this team struggles to switch into.',
    coverage: 'Lit types are the Pokémon’s most-used set; the dim ones are everything else it can learn. Click any to toggle.',
    speed: speed.footnote,
  }[tab]

  // Nothing rather than an empty toolbar on a tab that has neither.
  const header = actions || pairing ? <>{actions}{pairing}</> : undefined

  return (
    <>
      {/*
        * The tabs live in the page's own bar rather than on a card of their
        * own. A card inside a viewport-height shell was a frame drawn around
        * the only thing on the screen: it cost a border, two lots of padding
        * and a tab strip's worth of height, and bought nothing, since there
        * was nothing for it to be distinguished from.
        */}
      <div className="subbar subbar-bleed">
        <div className="bar-inner matchup-bar">
          {lead}
          <nav className="sub-nav" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key} type="button" role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'is-active' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {(header || trail) && <div className="sub-actions">{header}{trail}</div>}
        </div>
      </div>

      {help && <EvHelp onClose={() => setHelp(false)} />}

      <div className="analysis-body">
      {tab === 'summary' && (
        <TeamPair one={teamOne} two={teamTwo} abreast={abreast}>
          {(team) => <DraftSummaryBody team={team} neutral={neutral} />}
        </TeamPair>
      )}
      {tab === 'types' && (
        <TeamPair one={teamOne} two={teamTwo} abreast={abreast}>
          {(team) => (
            <DefensiveChartBody team={team} chart={chart} useAbilities={defenseAbilities} />
          )}
        </TeamPair>
      )}
      {/* Only these two need the learnsets, so the other tabs stay usable while
          that file is still downloading. */}
      {tab === 'moves' && (learnsets
        ? (
          <TeamPair one={teamOne} two={teamTwo} abreast={abreast}>
            {(team, side) => <LearnedMovesBody team={team} rows={moveRows[side]} byId={byId} />}
          </TeamPair>
        )
        : <LoadingBall label="Loading learnsets…" inline />)}
      {tab === 'speed' && speed.body}
      {/* Not a pair: it reads one Pokemon against the whole of the other side,
          and picks which from either team itself. */}
      {tab === 'evs' && (learnsets
        ? (
          <EvCalcBody
            teamOne={teamOne} teamTwo={teamTwo}
            chart={chart} moves={moves} learnsets={learnsets} sets={sets} played={played}
            dex={dex} level={level}
          />
        )
        : <LoadingBall label="Loading learnsets…" inline />)}
      {tab === 'coverage' && (learnsets
        ? (
          <TeamPair one={teamOne} two={teamTwo} abreast={abreast}>
            {(team, side) => (
              <CoverageBody
                attackers={team} defenders={side === 'one' ? teamTwo : teamOne}
                chart={chart} moves={moves} learnsets={learnsets}
                useAbilities={coverageAbilities} minPower={MIN_POWER} sets={sets} played={played}
              />
            )}
          </TeamPair>
        )
        : <LoadingBall label="Loading learnsets…" inline />)}
      </div>
      {footnote && <p className="widget-note analysis-note">{footnote}</p>}
    </>
  )
}

/**
 * Both sides of a tab, each under its own name in its own colour.
 *
 * Every reading here used to be of one team, picked by a toggle in the bar
 * above — so the comparison the tool exists for was a toggle and a memory
 * apart. Both sides are on every tab now and the toggle is gone.
 *
 * Left and right by default, so the comparison is a glance across rather than
 * a scroll down; the header's switch stacks them instead, which is what the
 * type chart and the move grid want when half a card is too tight. A phone
 * stacks them either way, having no second column to offer.
 *
 * One side on its own gets no heading — there is nothing to tell it from.
 */
function TeamPair({ one, two, abreast, children }: {
  one: Team
  two: Team
  abreast: boolean
  children: (team: Team, side: 'one' | 'two') => ReactNode
}) {
  if (!two.members.length) return <>{children(one, 'one')}</>
  const sides: ['one' | 'two', Team, string][] = [
    ['one', one, one.name || 'Team 1'],
    ['two', two, two.name || 'Team 2'],
  ]
  return (
    <div className={`panel-pair${abreast ? '' : ' is-stacked'}`}>
      {sides.map(([side, team, name]) => (
        <section key={side} className={`panel-side accent-${side}`}>
          <h3><TeamName name={name} /></h3>
          {children(team, side)}
        </section>
      ))}
    </div>
  )
}
