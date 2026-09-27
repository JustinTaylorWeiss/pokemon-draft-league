import { useMemo, useState } from 'react'
import type { LearnsetDex, Move, MoveDex, Pokemon, SetDex, StatKey, TypeChart } from '../../data/types'
import { STAT_LABELS } from '../../lib/stats'
import { MODELLED_ABILITIES, itemMatters, typeBoosted } from '../../lib/damage'
import {
  ASSUME_SET, EV_BUDGET, EV_MAX, EV_STATS, EV_STEP, emptySpread, opponentsFrom, planFor,
  spent, statOfSpread, type Assume, type Assumptions, type Spread, type Threshold,
} from '../../lib/evPlan'
import { Sprite } from '../../components/Sprite'
import { MoveCategory } from '../../components/MoveCategory'
import { TypeChip } from '../../components/TypeChip'
import { PokemonLink } from '../../components/PokemonLink'
import { toId } from '../../data/load'
import { DropPicker, type DropItem } from '../../components/DropPicker'
import type { ItemDex } from '../../data/types'
import type { LeagueDex } from '../../data/league'
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
 * The shapes a Pokémon takes mid-battle, where it takes more than one.
 *
 * Aegislash is 60 Defense in one stance and 150 in the other, and a spread
 * chosen against one of those is not a spread for the other. Twenty-eight
 * Pokémon have a second shape they change into without being a second draft
 * pick; for everything else this comes back with one entry and no toggle.
 *
 * Found through `battleOnly`, which each changed forme carries pointing back
 * at the one it reverts to.
 */
function battleFormes(id: string, dex: LeagueDex) {
  const mon = dex[id]
  if (!mon) return []
  const base = mon.battleOnly?.[0] ?? id
  const ids = [base, ...Object.keys(dex).filter((k) => dex[k].battleOnly?.includes(base))]
  return [...new Set(ids)].filter((k) => dex[k]).map((k) => ({ id: k, pokemon: dex[k] }))
}

/** Short on the button, spelled out on hover. */
const ASSUME_LABEL: Record<Assume, string> = { set: 'set', max: '252', 'max+': '252+' }
const ASSUME_MEANS: Record<Assume, string> = {
  set: 'whatever their most-used set runs',
  max: 'maximum EVs',
  'max+': 'maximum EVs and a boosting nature',
}

/**
 * The three states side by side rather than one button cycling through them.
 *
 * Cycling is fine for two and poor for three: reaching the one you want
 * means clicking through the one you do not, and which comes next is only
 * learnable by trying. Laid out, the choice is the control.
 */
function AssumePicker({ label, value, states, onPick }: {
  label: string
  value: Assume
  states: Assume[]
  onPick: (next: Assume) => void
}) {
  return (
    <span className="ev-assume">
      <span className="ev-assume-what">{label}</span>
      <span className="ev-assume-seg">
        {states.map((state) => (
          <button
            key={state}
            type="button"
            className="ev-seg"
            aria-pressed={value === state}
            title={`${label}: ${ASSUME_MEANS[state]}`}
            onClick={() => onPick(state)}
          >
            {ASSUME_LABEL[state]}
          </button>
        ))}
      </span>
    </span>
  )
}

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

/**
 * A column's heading and its controls, which live apart from its list.
 *
 * Apart because they stick: the lists are long and the reason to read one is
 * to decide where to put an EV, which meant scrolling back to the top to
 * move the slider and then back down to see what it did.
 */
function StatHead({
  stat, bare, value, spread, onEvs, onNature,
}: {
  stat: StatKey
  /** The stat before any EVs go in, which is where every decision starts. */
  bare: number
  value: number
  spread: Spread
  onEvs: (n: number) => void
  onNature: (mult: number) => void
}) {
  const evs = spread.evs[stat]
  return (
    <div className="ev-col ev-col-fixed">
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
    </div>
  )
}

/** Rounding room, for comparing a sixteenth-based probability against a half. */
const EPSILON = 1e-9

/** And the list itself, which is what scrolls under it. */
function StatRows({ stat, evs, rows, faces, note }: {
  stat: StatKey
  /** What the slider above says, for lighting the rows it has paid for. */
  evs: number
  rows: Threshold[]
  faces: Record<string, Pokemon>
  note?: string
}) {
  const reachable = rows.filter((r) => !r.unreachable)
  const beyond = rows.filter((r) => r.unreachable)

  /*
   * Taking a hit is lit by the odds, not by the guaranteed count.
   *
   * "Guaranteed 3HKO" is a statement about the worst roll, and the worst
   * roll is one outcome in sixteen. A wall that still falls in two seven
   * times out of eight is not a wall, and it was going green. Half is the
   * line: under it the hit more often than not fails to land, over it the
   * threshold has bought a technicality.
   *
   * Landing one is not the same question — there the guaranteed count is
   * the whole point of investing — so Attack and Special Attack keep it,
   * and Speed has no rolls at all.
   */
  const defensive = stat === 'hp' || stat === 'def' || stat === 'spd'
  const lit = (r: Threshold) => (defensive && r.chance != null
    ? r.chance < 0.5 - EPSILON
    : evs >= r.evs)
  const tied = (r: Threshold) => (defensive && r.chance != null
    ? Math.abs(r.chance - 0.5) <= EPSILON
    : r.tieAt != null && evs >= r.tieAt && evs < r.evs)
  return (
    <div className="ev-col">
      {rows.length ? (
        <>
          <ul className="ev-rows">
            {reachable.map((r, i) => (
              <ThresholdRow
                key={`${r.target}-${r.move ?? r.tier}-${i}`}
                row={r}
                lit={lit(r)}
                tied={tied(r)}
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
    </div>
  )
}

/** What a Pokémon has been given by hand, over whatever its set said. */
export interface Gear { item?: string; ability?: string }

/**
 * An item and an ability, chosen for one Pokémon.
 *
 * Abilities come from the Pokémon's own three; items from the seventy the
 * format's sets actually reference, which is the closest thing to a legality
 * list this data has and excludes everything the regulation does not allow
 * by simply never having seen it played.
 *
 * Both are calculated with rather than decorative — an Assault Vest is a
 * fifth of the Special Defense column, and Multiscale is half of every
 * defensive row at once.
 */
function GearPicker({ pokemon, items, gear, onChange }: {
  pokemon: Pokemon
  items: ItemDex
  gear: Gear | undefined
  onChange: (next: Gear) => void
}) {
  const [open, setOpen] = useState(false)
  const chosen = [gear?.ability, gear?.item].filter(Boolean)

  // Only what this calculation reads. An ability that changes nothing here
  // is a control that does nothing, and there is no way to tell from the
  // name which is which — the two lists are built from the same tables the
  // damage maths uses, so they cannot drift apart from it.
  const abilities = [...new Set(Object.values(pokemon.abilities))]
    .filter((a) => MODELLED_ABILITIES.has(a))
  /*
   * The type boosters kept apart from the rest.
   *
   * Twenty-two of the twenty-nine are the same item — a fifth to one type —
   * and listed together they bury the seven that do something else. Each
   * says which type it lends to, since half of them are named after a
   * mineral rather than the type it belongs to.
   */
  const { plain, boosters } = useMemo(() => {
    const usable = Object.values(items)
      .map((i) => i.name)
      .filter((n) => itemMatters(n, pokemon))
      .sort((a, b) => a.localeCompare(b))
    return {
      plain: usable.filter((n) => !typeBoosted(n)),
      boosters: usable.filter((n) => typeBoosted(n)),
    }
  }, [items, pokemon])

  // Nothing either list can offer, so nothing to open.
  if (!abilities.length && !plain.length && !boosters.length) return null

  return (
    <span className="ev-gear">
      <button
        type="button"
        className={`ev-gear-open${chosen.length ? ' has-gear' : ''}`}
        aria-expanded={open}
        title={chosen.length ? chosen.join(' · ') : `Give ${pokemon.name} an item or ability`}
        onClick={() => setOpen((v) => !v)}
      >
        {chosen.length ? chosen.join(' · ') : '+'}
      </button>

      {open && (
        <>
          {/* Click anywhere else and it closes, which is what a reader
              expects of something that opened over the page. */}
          <button type="button" className="ev-gear-away" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="ev-gear-pop">
            {abilities.length > 0 && (
              <label>
                <span>Ability</span>
                <select
                  value={gear?.ability ?? ''}
                  onChange={(e) => onChange({ ...gear, ability: e.target.value })}
                >
                  <option value="">its set{'’'}s</option>
                  {abilities.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            )}
            <label>
              <span>Item</span>
              <select
                value={gear?.item ?? ''}
                onChange={(e) => onChange({ ...gear, item: e.target.value })}
              >
                <option value="">none</option>
                {plain.map((n) => <option key={n} value={n}>{n}</option>)}
                {boosters.length > 0 && (
                  <optgroup label="Type boosters">
                    {boosters.map((n) => (
                      <option key={n} value={n}>{n} — {typeBoosted(n)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {chosen.length > 0 && (
              <button
                type="button" className="link-btn"
                onClick={() => { onChange({}); setOpen(false) }}
              >
                Back to its set
              </button>
            )}
          </div>
        </>
      )}
    </span>
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
  /** For finding a Pokémon's other in-battle shapes, which are not on a team. */
  dex: LeagueDex
  /** The items this format's sets reference, which is what may be given out. */
  items: ItemDex
  /** Owned by the card, so one picker in the bar serves this and the tiers. */
  level: number
}

export function EvCalcBody({
  teamOne, teamTwo, chart, moves, learnsets, sets, played, dex, items, level,
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
  /** What the other side is credited with, where their set is not the answer. */
  const [assume, setAssume] = useState<Assumptions>(ASSUME_SET)
  /** Moves named by hand, credited to every opponent that can learn one. */
  const [extra, setExtra] = useState<string[]>([])
  const [query, setQuery] = useState('')
  /** Which shape to read it in, for the ones that have more than one. */
  const [shape, setShape] = useState<string | null>(null)
  /** Items and abilities given out by hand, on either side. */
  const [gear, setGear] = useState<Record<string, Gear>>({})
  const give = (id: string, next: Gear) => setGear((prev) => ({ ...prev, [id]: next }))

  const sides: { key: 'one' | 'two'; team: Team }[] = [
    { key: 'one', team: teamOne }, { key: 'two', team: teamTwo },
  ]
  const formes = useMemo(() => (chosen ? battleFormes(chosen, dex) : []), [chosen, dex])

  /**
   * The chosen Pokémon and the side facing it, wearing whichever shape is
   * selected. Memoised because the plan hangs off it: rebuilt every render,
   * every calculation below would be too.
   */
  const picked = useMemo((): { entry: TeamEntry; foes: TeamEntry[]; own: string } | null => {
    if (!chosen) return null
    for (const team of [teamOne, teamTwo]) {
      const entry = team.members.find((m) => m.id === chosen)
      if (!entry) continue
      const other = team === teamOne ? teamTwo : teamOne
      return {
        entry: shape && dex[shape] ? { id: shape, pokemon: dex[shape] } : entry,
        foes: other.members,
        own: entry.id,
      }
    }
    return null
  }, [chosen, shape, dex, teamOne, teamTwo])

  /** My own four, from the usage set where there is one and the pool where not. */
  const myMoves: Move[] = useMemo(() => {
    if (!picked) return []
    const set = sets?.[picked.entry.id]
    const known = (set?.moves ?? [])
      .map((m) => moves[m])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0)

    // Same standing-in the other side gets, and the same named moves, through
    // the same door — a move named by hand belongs to whoever can learn it,
    // and that includes this one.
    return opponentsFrom(
      [picked.entry], known.length ? sets : null, moves, learnsets, played, level, ASSUME_SET, extra,
    )[0].moves
  }, [picked, sets, moves, learnsets, played, level, extra])

  const opponents = useMemo(
    () => (picked
      ? opponentsFrom(
        picked.foes.filter((m) => !off.has(m.id)),
        sets, moves, learnsets, played, level, assume, extra, gear,
      )
      : []),
    [picked, off, sets, moves, learnsets, played, level, assume, extra, gear],
  )

  /** Everything on either side, for the picker. */
  const choices: DropItem[] = sides.flatMap(({ key, team }) => team.members.map((m) => ({
    id: m.id,
    label: m.pokemon.name,
    // The coach's name heads the section rather than trailing every row in
    // it: it is the same six times over, and six times is a list of coaches.
    group: team.name || (key === 'one' ? 'Team 1' : 'Team 2'),
    icon: <Sprite pokemon={m.pokemon} width={28} height={24} />,
  })))

  /**
   * Moves matching what has been typed, that somebody over there can learn.
   *
   * Filtered against the other side rather than the whole move list: a move
   * none of them has is a move that would be added to nobody, and offering
   * it is offering a button that does nothing.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2 || !picked) return []
    const legal = new Set<string>()
    // Both sides: a move added to this Pokémon fills out what it can threaten
    // with, and one added to theirs fills out what it has to survive. Which
    // of those happens is decided by who can learn it, not by who typed it.
    for (const m of [picked.entry, ...picked.foes]) {
      for (const id of Object.keys(learnsets?.[m.id] ?? {})) legal.add(id)
    }
    return [...legal]
      .map((id) => moves[id])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0
        && m.name.toLowerCase().includes(q) && !extra.includes(toId(m.name)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [query, picked, learnsets, moves, extra])

  const choose = (id: string) => {
    setChosen(id)
    // A spread belongs to the Pokémon it was chosen for, and so does a
    // decision about which of the other side to weigh it against.
    setSpread(emptySpread())
    setOff(new Set())
    setShape(null)
  }

  const addMove = (move: Move) => {
    setExtra((prev) => (prev.includes(toId(move.name)) ? prev : [...prev, toId(move.name)]))
    setQuery('')
  }

  const plan = useMemo(() => {
    if (!picked) return null
    const set = sets?.[picked.entry.id]?.spreads?.[0]
    const worn = gear[picked.entry.id]
    return planFor({
      pokemon: picked.entry.pokemon,
      moves: myMoves,
      // No item until one is given. A set's item is a guess about a build,
      // and unlike its moves and its spread it is worth a third of the
      // damage on its own — too much to apply without being asked.
      item: worn?.item || undefined,
      ability: worn?.ability || set?.ability,
      spread,
      opponents,
      chart,
      level,
      // The league plays doubles, which takes a quarter off the spread moves.
      doubles: true,
    })
  }, [picked, myMoves, opponents, spread, chart, level, sets, gear])

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
      {/* Everything you can change, above everything you read, and stuck
          there: the reason to read a column is to decide where an EV goes,
          and the slider was a scroll away from the list that argued for it. */}
      <div className="ev-top">
      <div className="ev-bar">
        <DropPicker
          className="ev-picker"
          items={choices}
          value={chosen ?? ''}
          onPick={(item) => choose(item.id)}
          ariaLabel="Pokémon to build a spread for"
          placeholder="Pick a Pokémon"
        />

        {/* And which of its shapes to read it in, where it has more than one.
            Aegislash is 60 Defense in one stance and 150 in the other. */}
        {formes.length > 1 && (
          <span className="ev-assume-seg ev-formes">
            {formes.map((f) => (
              <button
                key={f.id}
                type="button"
                className="ev-seg"
                aria-pressed={(shape ?? picked?.own) === f.id}
                title={f.pokemon.name}
                onClick={() => setShape(f.id)}
              >
                {f.pokemon.forme ?? 'Base'}
              </button>
            ))}
          </span>
        )}

        {/* Its picture last, after the shape that decides which picture it
            is. The picker opens the list; this opens the Pokémon, the way a
            sprite does everywhere else on the site. */}
        {picked && (
          <span className="ev-mine">
            <PokemonLink
              id={picked.entry.id}
              className="ev-open"
              title={`Open ${picked.entry.pokemon.name}`}
            >
              <Sprite pokemon={picked.entry.pokemon} width={40} height={33} />
            </PokemonLink>
            <GearPicker
              pokemon={picked.entry.pokemon} items={items}
              gear={gear[picked.entry.id]} onChange={(g) => give(picked.entry.id, g)}
            />
          </span>
        )}

        {picked && picked.foes.length > 0 && (
          <div className="ev-foes">
            <span className="ev-against">against</span>
            {picked.foes.map((m) => (
              <span key={m.id} className="ev-foe-slot">
                <button
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
                <GearPicker
                  pokemon={m.pokemon} items={items}
                  gear={gear[m.id]} onChange={(g) => give(m.id, g)}
                />
              </span>
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

      {picked && (
        <>
          {/* What to credit them with. Their set is one spread off a ladder;
              "does this hold against a max-invested one" is the question a
              spread is actually chosen to answer. */}
          <div className="ev-assumes">
            <span className="ev-against">they run</span>
            <AssumePicker
              label="HP" value={assume.hp} states={['set', 'max']}
              onPick={(hp) => setAssume((a) => ({ ...a, hp: hp as 'set' | 'max' }))}
            />
            <AssumePicker
              label="Def / SpD" value={assume.bulk} states={['set', 'max', 'max+']}
              onPick={(bulk) => setAssume((a) => ({ ...a, bulk }))}
            />
            <AssumePicker
              label="Atk / SpA" value={assume.power} states={['set', 'max', 'max+']}
              onPick={(power) => setAssume((a) => ({ ...a, power }))}
            />

            {/* And anything they might be carrying that their set does not
                say. Added to everyone over there who can learn it. */}
            <span className="ev-add">
              <input
                type="search" value={query} placeholder="Add a move…"
                aria-label="Add a move the other side might carry"
                onChange={(e) => setQuery(e.target.value)}
              />
              {matches.length > 0 && (
                <ul className="ev-matches">
                  {matches.map((m) => (
                    <li key={m.name}>
                      <button type="button" onClick={() => addMove(m)}>
                        <MoveCategory category={m.category} />
                        <span>{m.name}</span>
                        <em>{m.type} · {m.basePower}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </span>

            {extra.map((id) => {
              const move = moves[id]
              return (
                <button
                  key={id}
                  type="button"
                  className="ev-extra"
                  title={`${move?.name ?? id} — click to drop it`}
                  onClick={() => setExtra((prev) => prev.filter((x) => x !== id))}
                >
                  {move && <MoveCategory category={move.category} />}
                  <span className="ev-extra-name">{move?.name ?? id}</span>
                  {move && <TypeChip type={move.type} />}
                  <span className="ev-extra-drop" aria-hidden="true">{'×'}</span>
                </button>
              )
            })}
          </div>
          {/* The headings and their sliders in one grid, the lists in
              another below it, both on the same six columns. Two grids
              rather than six columns of both, so the whole top can stick
              while the lists run under it. */}
          <div className="ev-cols ev-heads">
            {EV_STATS.map((stat) => (
              <StatHead
                key={stat}
                stat={stat}
                bare={statOfSpread(picked.entry.pokemon, level, bareSpread, stat)}
                value={statOfSpread(picked.entry.pokemon, level, spread, stat)}
                spread={spread}
                onEvs={(n) => setEvs(stat, n)}
                onNature={(m) => setNature(stat, m)}
              />
            ))}
          </div>
        </>
      )}
      </div>

      {!picked ? (
        <p className="ev-hint">Pick a Pokémon to see what its EVs would buy against the other side.</p>
      ) : (
        <>
          <div className="ev-cols">
            {EV_STATS.map((stat) => (
              <StatRows
                key={stat}
                stat={stat}
                evs={spread.evs[stat]}
                rows={plan?.[stat] ?? []}
                faces={faces}
                note={(stat === 'atk' || stat === 'spa') && !myMoves.some(
                  (m) => m.category === (stat === 'atk' ? 'Physical' : 'Special'),
                ) ? `No ${stat === 'atk' ? 'physical' : 'special'} moves on this set.` : undefined}
              />
            ))}
          </div>

          <p className="ev-note">
            Hits are guaranteed ones: the worst roll every time, with the odds beside them.
            Each Pokémon threatens with its most-used set plus the moves the format plays
            that it can learn
            {guessed.length > 0 && (
              <> — {guessed.map((o) => o.pokemon.name).join(', ')} {guessed.length === 1 ? 'has' : 'have'} no
                set on record, so that second list is all there is for {guessed.length === 1 ? 'it' : 'them'}</>
            )}
            . Weather, terrain, screens, boosts and Intimidate are not counted.
            {(assume.bulk === 'max+' || assume.power === 'max+') && (
              <> A boosting nature is credited to whichever of the pair each
                calculation reads, which no single Pokémon could have both of.</>
            )}
          </p>
        </>
      )}
    </div>
  )
}
