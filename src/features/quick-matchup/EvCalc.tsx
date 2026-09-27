import { useMemo, useState } from 'react'
import type { LearnsetDex, Move, MoveDex, Pokemon, SetDex, StatKey, TypeChart } from '../../data/types'
import { STAT_LABELS } from '../../lib/stats'
import {
  EV_BUDGET, EV_MAX, EV_STATS, EV_STEP, emptySpread, opponentsFrom, planFor, spent,
  statOfSpread, type Spread, type Threshold,
} from '../../lib/evPlan'
import { Sprite } from '../../components/Sprite'
import { DropPicker, type DropItem } from '../../components/DropPicker'
import type { Team, TeamEntry } from './TeamEditor'

/**
 * What to spend EVs on, worked out against the team on the other side.
 *
 * Every other EV tool is a spreadsheet: it tells you what the number becomes
 * and leaves you to know whether that matters. The number never matters on
 * its own — 12 Special Attack is worth having or worth nothing depending
 * entirely on whether it moves a 5HKO to a 4HKO on something they actually
 * brought. Both teams are already on screen here, so the question can be
 * answered rather than left.
 *
 * One column per stat, each listing what that stat could buy against them,
 * cheapest first, with a slider that lights up everything it pays for.
 */

/** The nature a stat can be given, as the multiplier the maths wants. */
const NATURES: { mult: number; label: string; title: string }[] = [
  { mult: 0.9, label: '−', title: 'Hindering nature' },
  { mult: 1, label: '·', title: 'Neutral nature' },
  { mult: 1.1, label: '+', title: 'Boosting nature' },
]

/** A nature gives one stat and takes from another, so only one of each. */
const natureIsLegal = (s: Spread) => {
  const plus = EV_STATS.filter((k) => s.nature[k] > 1).length
  const minus = EV_STATS.filter((k) => s.nature[k] < 1).length
  return plus <= 1 && minus <= 1
}

/** HP has no nature: no nature in the games touches it. */
const takesNature = (stat: StatKey) => stat !== 'hp'

/**
 * Odds as a player says them. "Guaranteed" and "never" rather than 100% and
 * 0%, because those two are the only ones you can actually plan on and a
 * number reads as one more thing to weigh.
 */
function odds(p: number): string {
  if (p >= 0.9995) return 'always'
  if (p <= 0.0005) return 'never'
  return `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`
}

function ThresholdRow({
  row, lit, tied, target,
}: { row: Threshold; lit: boolean; tied: boolean; target?: Pokemon }) {
  const out = row.unreachable
  return (
    <li className={`ev-row${lit ? ' is-lit' : ''}${tied ? ' is-tied' : ''}${out ? ' is-out' : ''}`}>
      {/* The price in both currencies: what it costs in EVs, and what the
          stat has to read for it. One of those is what you spend and the
          other is what you are aiming at, and neither implies the other
          without the arithmetic this tool exists to save. */}
      <span className="ev-cost" title={out ? 'Out of reach' : `${row.evs} EVs — the stat reads ${row.statAt}`}>
        <span className="ev-cost-evs">{out ? '—' : row.evs}</span>
        <span className="ev-cost-stat">{out ? '—' : row.statAt}</span>
      </span>
      {/* Which Pokémon this is about, read before the words. A column of
          twelve rows is a column of names otherwise. */}
      {target && <Sprite pokemon={target} className="ev-face" width={26} height={22} />}
      <span className="ev-what">
        <span className="ev-target">{row.targetName}</span>
        {row.outspeed != null ? (
          <span className="ev-detail">
            {row.tier} · {row.outspeed}{tied ? ' · tied' : ''}
          </span>
        ) : (
          <>
            <span className="ev-detail">{row.moveName}</span>
            <span className="ev-detail ev-swing">
              {row.from}HKO {'→'} {row.to}HKO
              {row.chance != null && row.at != null && (
                <em className="ev-odds" title={`${odds(row.chance)} to ${row.at}HKO as it stands`}>
                  {odds(row.chance)} {row.at}HKO
                </em>
              )}
            </span>
          </>
        )}
      </span>
    </li>
  )
}

function StatColumn({
  stat, bare, value, spread, rows, faces, onEvs, onNature, note,
}: {
  stat: StatKey
  /** The stat before any EVs go in, which is where every decision starts. */
  bare: number
  value: number
  spread: Spread
  rows: Threshold[]
  faces: Record<string, Pokemon>
  onEvs: (n: number) => void
  onNature: (mult: number) => void
  note?: string
}) {
  const evs = spread.evs[stat]
  const reachable = rows.filter((r) => !r.unreachable)
  const beyond = rows.filter((r) => r.unreachable)
  return (
    <section className="ev-col">
      {/* What the stat reads right now, EVs and nature and all — the number
          the rows below are aiming at, so it moves with the slider. */}
      <header className="ev-col-head">
        <span className="ev-stat">{STAT_LABELS[stat]}</span>
        <strong className="ev-value" title={`${bare} before EVs`}>{value}</strong>
      </header>

      {/* What is being spent, what spends it, and what bends it — one row,
          reading left to right in that order. The total is above; this line
          is only the controls. */}
      <div className="ev-spend">
        <span className="ev-evs" title={`${evs} EVs`}>{evs}</span>
        <input
          type="range" min={0} max={EV_MAX} step={EV_STEP} value={evs}
          aria-label={`${STAT_LABELS[stat]} EVs`}
          onChange={(e) => onEvs(Number(e.target.value))}
        />
        {takesNature(stat) && (
          <span className="ev-natures">
            {NATURES.map((n) => (
              <button
                key={n.mult}
                type="button"
                title={n.title}
                aria-pressed={spread.nature[stat] === n.mult}
                className="ev-nature"
                onClick={() => onNature(n.mult)}
              >
                {n.label}
              </button>
            ))}
          </span>
        )}
      </div>

      {rows.length ? (
        <>
          <ul className="ev-rows">
            {reachable.map((r, i) => (
              <ThresholdRow
                key={`${r.target}-${r.move ?? r.tier}-${i}`}
                row={r}
                lit={evs >= r.evs}
                tied={r.tieAt != null && evs >= r.tieAt && evs < r.evs}
                target={faces[r.target]}
              />
            ))}
          </ul>
          {/* Held apart, because these are not more of the list above. That
              list is what the stat can buy; this is what it cannot. */}
          {beyond.length > 0 && (
            <ul className="ev-rows ev-beyond">
              {beyond.map((r, i) => (
                <ThresholdRow key={`${r.target}-out-${i}`} row={r} lit={false} tied={false} target={faces[r.target]} />
              ))}
            </ul>
          )}
        </>
      ) : <p className="ev-none">{note ?? 'Nothing here to buy.'}</p>}
    </section>
  )
}

interface Props {
  teamOne: Team
  teamTwo: Team
  chart: TypeChart
  moves: MoveDex
  learnsets: LearnsetDex | null
  sets: SetDex | null
  /** The damaging moves the format plays, for the Pokémon with no usage set. */
  played: string[]
  /** Owned by the card, so one picker in the bar serves this and the tiers. */
  level: number
}

export function EvCalcBody({
  teamOne, teamTwo, chart, moves, learnsets, sets, played, level,
}: Props) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [spread, setSpread] = useState<Spread>(emptySpread)
  /**
   * Opponents switched off.
   *
   * A spread is chosen against the Pokémon you expect to be across from, and
   * that is rarely all six — a column showing what it takes to survive
   * something you are never bringing this into is a row between you and the
   * ones that matter.
   */
  const [off, setOff] = useState<Set<string>>(() => new Set())

  const sides: { key: 'one' | 'two'; team: Team }[] = [
    { key: 'one', team: teamOne }, { key: 'two', team: teamTwo },
  ]
  const find = (id: string): { entry: TeamEntry; foes: TeamEntry[] } | null => {
    for (const { team } of sides) {
      const entry = team.members.find((m) => m.id === id)
      if (entry) {
        const other = team === teamOne ? teamTwo : teamOne
        return { entry, foes: other.members }
      }
    }
    return null
  }

  const picked = chosen ? find(chosen) : null

  /** My own four, from the usage set where there is one and the pool where not. */
  const myMoves: Move[] = useMemo(() => {
    if (!picked) return []
    const set = sets?.[picked.entry.id]
    const known = (set?.moves ?? [])
      .map((m) => moves[m])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0)
    if (known.length) return known
    // Same standing-in the other side gets, through the same door.
    return opponentsFrom([picked.entry], null, moves, learnsets, played, level)[0].moves
  }, [picked, sets, moves, learnsets, played, level])

  const opponents = useMemo(
    () => (picked
      ? opponentsFrom(picked.foes.filter((m) => !off.has(m.id)), sets, moves, learnsets, played, level)
      : []),
    [picked, off, sets, moves, learnsets, played, level],
  )

  /** Everything on either side, for the picker. */
  const items: DropItem[] = sides.flatMap(({ key, team }) => team.members.map((m) => ({
    id: m.id,
    label: m.pokemon.name,
    // The coach's name heads the section rather than trailing every row in
    // it: it is the same six times over, and six times is a list of coaches.
    group: team.name || (key === 'one' ? 'Team 1' : 'Team 2'),
    icon: <Sprite pokemon={m.pokemon} width={28} height={24} />,
  })))

  const choose = (id: string) => {
    setChosen(id)
    // A spread belongs to the Pokémon it was chosen for, and so does a
    // decision about which of the other side to weigh it against.
    setSpread(emptySpread())
    setOff(new Set())
  }

  const plan = useMemo(() => {
    if (!picked) return null
    const set = sets?.[picked.entry.id]?.spreads?.[0]
    return planFor({
      pokemon: picked.entry.pokemon,
      moves: myMoves,
      item: set?.item,
      ability: set?.ability,
      spread,
      opponents,
      chart,
      level,
      // The league plays doubles, which takes a quarter off the spread moves.
      doubles: true,
    })
  }, [picked, myMoves, opponents, spread, chart, level, sets])

  /** The same natures, none of the EVs — what each column counts up from. */
  const bareSpread = useMemo(
    () => ({ evs: emptySpread().evs, nature: spread.nature }),
    [spread.nature],
  )

  const faces = useMemo(
    () => Object.fromEntries(opponents.map((o) => [o.id, o.pokemon])),
    [opponents],
  )

  const used = spent(spread)
  const left = EV_BUDGET - used
  const guessed = opponents.filter((o) => o.guessed)

  // Capped at what is left rather than allowed to go over and be corrected
  // afterwards: an illegal spread is not a step on the way to a legal one,
  // and a slider that stops is a clearer way to say so than a warning is.
  const setEvs = (stat: StatKey, n: number) =>
    setSpread((s) => {
      const elsewhere = spent(s) - s.evs[stat]
      return { ...s, evs: { ...s.evs, [stat]: Math.max(0, Math.min(n, EV_MAX, EV_BUDGET - elsewhere)) } }
    })
  const setNature = (stat: StatKey, mult: number) =>
    setSpread((s) => {
      const next = { ...s, nature: { ...s.nature, [stat]: mult } }
      return natureIsLegal(next) ? next : s
    })

  if (!teamOne.members.length) return null

  return (
    <div className="ev-calc">
      <div className="ev-bar">
        <DropPicker
          className="ev-picker"
          items={items}
          value={chosen ?? ''}
          onPick={(item) => choose(item.id)}
          ariaLabel="Pokémon to build a spread for"
          placeholder="Pick a Pokémon"
        />

        {picked && picked.foes.length > 0 && (
          <div className="ev-foes">
            <span className="ev-against">against</span>
            {picked.foes.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`ev-foe${off.has(m.id) ? ' is-off' : ''}`}
                title={`${m.pokemon.name} — ${off.has(m.id) ? 'not counted' : 'counted'}`}
                aria-pressed={!off.has(m.id)}
                onClick={() => setOff((prev) => {
                  const next = new Set(prev)
                  if (next.has(m.id)) next.delete(m.id)
                  else next.add(m.id)
                  return next
                })}
              >
                <Sprite pokemon={m.pokemon} width={40} height={33} />
              </button>
            ))}
          </div>
        )}

        {picked && (
          <span className={`ev-budget${left === 0 ? ' ev-full' : ''}`}>
            {used} of {EV_BUDGET} EVs{left > 0 ? ` · ${left} left` : ' · all spent'}
            {used > 0 && (
              <button type="button" className="link-btn" onClick={() => setSpread(emptySpread())}>
                Clear
              </button>
            )}
          </span>
        )}
      </div>

      {!picked ? (
        <p className="ev-hint">Pick a Pokémon to see what its EVs would buy against the other side.</p>
      ) : (
        <>

          <div className="ev-cols">
            {EV_STATS.map((stat) => (
              <StatColumn
                key={stat}
                stat={stat}
                bare={statOfSpread(picked.entry.pokemon, level, bareSpread, stat)}
                value={statOfSpread(picked.entry.pokemon, level, spread, stat)}
                spread={spread}
                rows={plan?.[stat] ?? []}
                faces={faces}
                onEvs={(n) => setEvs(stat, n)}
                onNature={(m) => setNature(stat, m)}
                note={(stat === 'atk' || stat === 'spa') && !myMoves.some(
                  (m) => m.category === (stat === 'atk' ? 'Physical' : 'Special'),
                ) ? `No ${stat === 'atk' ? 'physical' : 'special'} moves on this set.` : undefined}
              />
            ))}
          </div>

          <p className="ev-note">
            Hits are guaranteed ones: the worst roll every time. Against each Pokémon{"'"}s
            most-used set where there is one
            {guessed.length > 0 && (
              <> — {guessed.map((o) => o.pokemon.name).join(', ')} {guessed.length === 1 ? 'has' : 'have'} none,
                so {guessed.length === 1 ? 'its' : 'their'} movepool stands in</>
            )}
            . Weather, terrain, screens, boosts and Intimidate are not counted.
          </p>
        </>
      )}
    </div>
  )
}
