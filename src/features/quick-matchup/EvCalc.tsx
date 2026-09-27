import { Fragment, useEffect, useMemo, useState } from 'react'
import type { LearnsetDex, Move, MoveDex, Pokemon, SetDex, StatKey, TypeChart } from '../../data/types'
import { STAT_LABELS } from '../../lib/stats'
import {
  GIVEABLE_ITEMS, MODELLED_ABILITIES, itemEffect, itemMatters, typeBoosted,
} from '../../lib/damage'
import {
  ASSUME_BARE, EV_BUDGET, EV_MAX, EV_STATS, EV_STEP, IV_MAX, SET_SIZE, emptySpread, lowered,
  opponentsFrom, planFor, spent, statOfSpread, usualMoves,
  type Assume, type Assumptions, type Shot, type Spread, type Threshold,
} from '../../lib/evPlan'
import { Sprite } from '../../components/Sprite'
import { MoveCategory } from '../../components/MoveCategory'
import { TypeChip } from '../../components/TypeChip'
import { PokemonLink } from '../../components/PokemonLink'
import { toId } from '../../data/load'
import { DropPicker, type DropItem } from '../../components/DropPicker'
import { isMega, type LeagueDex } from '../../data/league'
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
 * One column per stat, each with a slider above it. The three defensive
 * ones and Speed list what that stat could buy against them, cheapest
 * first, lighting up as the slider pays for it. Attack and Special Attack
 * are not lists of purchases but readings: one row per Pokémon over there,
 * saying what the chosen set does to it and how the odds move as you spend.
 */

/** The nature a stat can be given, as the multiplier the maths wants. */
const NATURES: { mult: number; label: string; title: string }[] = [
  { mult: 0.9, label: '− Nature', title: 'Hindering nature' },
  { mult: 1, label: 'Nature', title: 'Neutral nature' },
  { mult: 1.1, label: '+ Nature', title: 'Boosting nature' },
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
/** How big the Pokemon along the top are drawn. */
const SPRITE_W = 56
const SPRITE_H = 46

const ASSUME_LABEL: Record<Assume, string> = { ivs: '31', max: '252', 'max+': '252+' }
const ASSUME_MEANS: Record<Assume, string> = {
  ivs: 'perfect IVs and nothing else — no EVs, neutral nature',
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

/**
 * The knockout in words, the way a damage calculator says it.
 *
 * Where the rolls disagree — it falls in two on a good one and three on a
 * bad one — the pair of counts is not the useful thing to print. "84% 2HKO"
 * is, and the three is implied by the sixteen percent it leaves. Where every
 * roll agrees there is one count and no odds to give.
 */
function ShotOutcome({ shot, chance }: { shot: Shot; chance: number }) {
  if (!Number.isFinite(shot.hits)) return <>no damage</>
  if (shot.soonest === shot.hits || chance <= 0) return <>{shot.hits}HKO</>
  return (
    <span title={`${odds(chance)} to ${shot.soonest}HKO, ${shot.hits} otherwise`}>
      {odds(chance)} {shot.soonest}HKO
    </span>
  )
}

/**
 * A move's name in its own type's colour.
 *
 * The palette is the one the chips use, taken from the variable each type
 * class sets rather than written out again here, and pulled a quarter of
 * the way towards the page's own ink: Dark and Ghost are chosen to be read
 * as a white word on a dark ground, and unmixed they are barely visible as
 * the word itself.
 */
const typeInk = (type?: string) => (type ? ` ev-ink type-${type.toLowerCase()}` : '')

/**
 * How to read this tab, for someone opening it for the first time.
 *
 * Plainly. The columns are dense and what each number refers to is not
 * obvious from looking at them, so this says what each control does and
 * what each figure means, and leaves the reader to decide whether any of
 * it is useful.
 */
export function EvHelp({ onClose }: { onClose: () => void }) {
  // Escape closes it, the way it closes everything else that opens over the
  // page. The backdrop takes a click for the same reason.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="ev-help" role="dialog" aria-modal="true" aria-label="How the EV calculator works">
      <button type="button" className="ev-help-away" aria-label="Close" onClick={onClose} />
      <div className="ev-help-panel">
        <header>
          <h2>How this tab works</h2>
          <button type="button" className="ev-help-close" aria-label="Close" onClick={onClose}>
            {'\u00d7'}
          </button>
        </header>

        <div className="ev-help-body">
          <p>
            This tab works out what EVs do for one Pokémon against the team it is facing.
            Both teams are already loaded, so each figure refers to a specific Pokémon on
            the other side rather than to the stat on its own.
          </p>

          <h3>Setting it up</h3>
          <ol>
            <li>
              Pick your Pokémon from the dropdown in the blue box. Both teams are listed,
              grouped by coach.
            </li>
            <li>
              Choose its four moves. They start filled with its most-used set, topped up
              from the damaging moves this format plays. The Attack and Special Attack
              columns read from these four and nothing else.
            </li>
            <li>
              The <code>{'\u22ef'}</code> under each sprite on the red side opens that
              Pokémon. You can hide it from the columns, credit it with 252 HP or a
              boosting nature, lower an IV, give it an item, switch its ability, or add a
              move to the ones it is reckoned to have. Each choice appears as a pill under
              the sprite, and the columns update.
            </li>
          </ol>

          <h3>Reading a row</h3>
          <p className="ev-help-eg">
            <span>Incineroar</span>
            <em>94% 1HKO</em>
            <span>Earthquake</span>
            <em>98.8–117.6%</em>
          </p>
          <p>
            Earthquake does between 98.8% and 117.6% of Incineroar&rsquo;s HP, which knocks
            it out in one hit 94% of the time and in two otherwise. The range is the sixteen
            damage rolls, lowest to highest. Both figures change as the sliders move.
          </p>
          <p>
            HP, Defense and Special Defense show the same thing in reverse — their moves
            against your Pokémon. Attack and Special Attack list each of your four moves
            against each of their Pokémon, in passes: your strongest result against each of
            them first, then the next, and so on.
          </p>

          <h3>Green rows</h3>
          <p>
            A row is green when its guaranteed hit count already matches the best that
            column can reach — the fewest hits when attacking, the most when defending.
            Further EVs in that stat do not change the outcome against that Pokémon. Grey
            rows are the ones the next point can still change.
          </p>

          <h3>Speed</h3>
          <p>
            Speed has no damage rolls, so its rows are thresholds rather than readings. Each
            is one build of theirs — <code>31</code> for perfect IVs and nothing else,
            <code>252</code> for full investment, <code>+</code> for a boosting nature — with
            the EVs and the Speed needed to outrun it. Orange marks a tie.
          </p>

          <h3>Adding a move</h3>
          <p>
            Each Pokémon&rsquo;s <code>{'\u22ef'}</code> menu has a search that credits it
            with a move on top of the set it is reckoned to have. Only moves that Pokémon
            can learn are offered, and the move counts for that Pokémon alone. Its rows are
            grouped above the rest, under &ldquo;Added&rdquo;.
          </p>

          <p className="ev-help-small">
            Not counted: weather, terrain, screens, stat stages, Intimidate, burn and Tera.
            Hit counts are the guaranteed ones — the lowest roll every time — with the odds
            of the faster result beside them.
          </p>
        </div>
      </div>
    </div>
  )
}

/** What each sweep of the other side is, above the rows that make it up. */
const PASS_LABEL = ['Best move', '2nd best', '3rd best', '4th best']
const passName = (n: number) => (n < 0 ? 'Added' : PASS_LABEL[n] ?? `${n + 1}th best`)

/** A percentage of someone's HP, to one place, without a trailing zero. */
const pct = (n: number) => `${Math.round(n * 10) / 10}`

/**
 * An attacking row: who, with what, for how much, and how often.
 *
 * No price column. The other four stats are lists of purchases and the two
 * numbers on their left are what each costs; these are readings of what the
 * chosen set already does, and there is no price to put there — pricing the
 * next breakpoint filled it with dashes, because for most pairings no amount
 * of Attack moves the hit count at all.
 *
 * Two lines: the Pokemon and what happens to it on the first, the move and
 * what it does on the second. The outcome is the answer and belongs beside
 * the name being asked about; the move and its roll range are the working
 * that produced it.
 */
function ShotRow({
  row, shot, lit, tied, target,
}: { row: Threshold; shot: Shot; lit: boolean; tied: boolean; target?: Pokemon }) {
  return (
    <li className={`ev-row ev-shot${lit ? ' is-lit' : ''}${tied ? ' is-tied' : ''}`}>
      {target && <Sprite pokemon={target} className="ev-face" width={26} height={22} />}
      <span className="ev-what">
        <span className="ev-line">
          <span className="ev-target">{row.targetName}</span>
          <em className="ev-odds">
            <ShotOutcome shot={shot} chance={row.chance ?? 0} />
          </em>
        </span>
        {/* What is making this number what it is, where anything is. */}
        {row.via?.length ? (
          <span className="ev-via" title={`Because of ${row.via.join(' and ')}`}>
            {row.via.join(' · ')}
          </span>
        ) : null}
        <span className="ev-line">
          <span className={`ev-detail ev-move${typeInk(row.moveType)}`}>{row.moveName}</span>
          <span className="ev-range" title="Worst roll to best, as a share of its HP">
            {pct(shot.low)}–{pct(shot.high)}%
          </span>
        </span>
      </span>
    </li>
  )
}

function ThresholdRow({
  row, lit, tied, target,
}: { row: Threshold; lit: boolean; tied: boolean; target?: Pokemon }) {
  const out = Boolean(row.unreachable)
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
        {/* What is making this number what it is, where anything is. A row
            reading 3HKO is a different row when a Life Orb is the reason. */}
        {row.via?.length ? (
          <span className="ev-via" title={`Because of ${row.via.join(' and ')}`}>
            {row.via.join(' · ')}
          </span>
        ) : null}
        {/* Which build of theirs this row is about, and only that. Their
            Speed was printed beside it, one below the number already on
            the left — which is the Speed you need, meaning theirs plus
            one. Two figures a step apart read as two facts. */}
        <span className="ev-detail" title={`They reach ${row.outspeed} Speed`}>
          {row.tier}{tied ? ' · tied' : ''}
        </span>
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

  /*
   * One button rather than three.
   *
   * A nature raises one stat and lowers one, so at most two of the six can
   * be anything but neutral — which meant two of the three buttons under
   * most columns did nothing when pressed. A control that mostly cannot be
   * used has to be read before it is touched.
   *
   * So it shows where this stat stands and steps to the next thing it could
   * be. Neutral is always one of those, and the plus and the minus only
   * where no other stat is holding them. Where both are, there is nowhere
   * to step and the button says so rather than going quiet.
   */
  const cycle = NATURES.filter((n) => n.mult === 1
    || n.mult === spread.nature[stat]
    || !EV_STATS.some((k) => k !== stat && spread.nature[k] === n.mult))
  const now = NATURES.find((n) => n.mult === spread.nature[stat]) ?? NATURES[1]
  const next = cycle[(cycle.findIndex((n) => n.mult === now.mult) + 1) % cycle.length]

  return (
    <div className="ev-col ev-col-fixed">
      {/* What the stat reads right now, EVs and nature and all — the number
          the rows below are aiming at, so it moves with the slider. */}
      <header className="ev-col-head">
        <span className="ev-stat">{STAT_LABELS[stat]}</span>
        <strong className="ev-value" title={`${bare} before EVs`}>{value}</strong>
        {/* Beside the stat it bends rather than under the slider it does
            not: a nature is part of what the number above reads, where the
            slider is the other part. */}
        {takesNature(stat) && (
          <button
            type="button"
            className="ev-nature"
            title={cycle.length > 1
              ? `${now.title} — click for ${next.title.toLowerCase()}`
              : `${now.title} — the other two are spoken for`}
            aria-label={`${STAT_LABELS[stat]}: ${now.title}`}
            aria-pressed={now.mult !== 1}
            disabled={cycle.length < 2}
            onClick={() => onNature(next.mult)}
          >
            {now.label}
          </button>
        )}
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
      </div>

    </div>
  )
}

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
   * Whether the sweeps are worth ruling off. More than one of them, or any
   * move named by hand — a column with a single group of guessed moves has
   * nothing to separate, but one holding a move somebody asked about should
   * say which it is even if it is the only group there.
   */
  const passes = new Set(reachable.map((r) => r.pass ?? 0)).size
  const grouped = passes > 1 || reachable.some((r) => r.added)

  const defensive = stat === 'hp' || stat === 'def' || stat === 'spd'
  /*
   * A reading goes green at its ceiling, whichever way it is read.
   *
   * The guaranteed hit count is the fewest this column could ever make it —
   * landing a hit — or the most — taking one. Either way it is the one
   * place where there is nothing left to buy, which is the only thing
   * worth marking on a row that is a reading rather than a price: a
   * percentage that has crept up is not a breakpoint.
   *
   * Never green where nothing lands at all in the attacking columns. The
   * ceiling is technically reached — no Attack ever knocks out something
   * immune to the move — and "as good as it gets" over a row doing nothing
   * reads as a win. Taking a hit it is the opposite: they cannot touch you,
   * and that is the best the row will ever say.
   */
  const lit = (r: Threshold) => {
    // Speed is the one column still priced, and a price is paid or it is not.
    if (!r.shot) return evs >= r.evs
    if (r.shot.peak == null || r.shot.hits !== r.shot.peak) return false
    return defensive || Number.isFinite(r.shot.hits)
  }
  // A speed tie is its own outcome: not a win, because the turn order is a
  // coin flip, and not nothing, because it is four EVs short of one.
  const tied = (r: Threshold) =>
    !r.shot && r.tieAt != null && evs >= r.tieAt && evs < r.evs
  return (
    <div className="ev-col">
      {rows.length ? (
        <>
          <ul className="ev-rows">
            {reachable.map((r, i) => {
              const key = `${r.target}-${r.move ?? r.tier}-${i}`
              return (
                <Fragment key={key}>
                  {/* A line and a word where the sweep changes: everything
                      above is each Pokemon's best answer, everything below
                      its second. Only where there is more than one to tell
                      apart — a column with one row per Pokemon has nothing
                      to separate. */}
                  {grouped && r.pass != null && r.pass !== reachable[i - 1]?.pass && (
                    <li className="ev-pass" aria-hidden="true">{passName(r.pass)}</li>
                  )}
                  {r.shot
                    ? <ShotRow row={r} shot={r.shot} lit={lit(r)} tied={tied(r)} target={faces[r.target]} />
                    : <ThresholdRow row={r} lit={lit(r)} tied={tied(r)} target={faces[r.target]} />}
                </Fragment>
              )
            })}
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
export interface Gear {
  item?: string
  ability?: string
  /** Only the ones dropped below 31; the rest are assumed perfect. */
  ivs?: Partial<Record<StatKey, number>>
  /**
   * Moves struck off the ones it is reckoned to have.
   *
   * The list a Pokémon gets is its set plus what the format plays that it
   * can learn, which is a guess and sometimes a wrong one. Taking one off
   * is the other half of naming one.
   */
  without?: string[]
}

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
function GearPicker({
  pokemon, usual, gear, onChange, assume, onAssume, out, onHide,
  learnset, moves, played, named, onNamed, carrying,
}: {
  pokemon: Pokemon
  /** The ability it is reckoned to have when nobody has said otherwise. */
  usual: string
  gear: Gear | undefined
  onChange: (next: Gear) => void
  /**
   * Its movepool and what has been credited to it out of that, for the
   * opponents. A move named here is named for this Pokémon and no other:
   * "what if this one has Ice Beam" is the question, and answering it for
   * everything on the team that can learn Ice Beam answers a wider one.
   */
  learnset?: Record<string, unknown>
  moves?: MoveDex
  played?: string[]
  named?: string[]
  onNamed?: (next: string[]) => void
  /** What it is currently reckoned to have, which is what the columns read. */
  carrying?: Move[]
  /**
   * What this one is credited with, for an opponent. Absent for the Pokémon
   * the spread is being built for, whose numbers are the sliders below.
   */
  assume?: Assumptions
  onAssume?: (next: Assumptions) => void
  /**
   * Whether this one is left out of the columns. Opponents only: a spread
   * is chosen against the Pokémon you expect to be across from, and that is
   * rarely all six.
   */
  out?: boolean
  onHide?: (next: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  /*
   * What has been said about this Pokemon, on the button itself: the spread
   * it is credited with first, then what it is holding. Closed, the button
   * is the only place any of it shows, and "Atk 252+" is the line most
   * worth seeing without opening anything. Defence and Special Defence move
   * together under one toggle, as do Attack and Special Attack, so the pill
   * names the first of each pair rather than spelling both out — two stats
   * and a number do not fit under a sprite, and the second never says
   * anything the first did not.
   */
  const raised = assume ? [
    assume.hp === 'max' ? 'HP 252' : null,
    assume.bulk === 'ivs' ? null : `Def ${ASSUME_LABEL[assume.bulk]}`,
    assume.power === 'ivs' ? null : `Atk ${ASSUME_LABEL[assume.power]}`,
  ].filter(Boolean) as string[] : []
  // Only the dropped ones. Everything is 31 unless somebody said otherwise,
  // so a pill for each of six perfect IVs would be six pills saying nothing.
  const dropped = lowered(gear?.ivs).map(([stat, iv]) => `${STAT_LABELS[stat]} ${iv} IV`)
  const brought = (named ?? []).map((id) => moves?.[id]?.name ?? id)
  const chosen = [
    ...raised, ...dropped, gear?.ability, gear?.item, ...brought,
  ].filter(Boolean) as string[]

  /*
   * Three pills is what fits under a sprite, and the third is a count once
   * there are more than three.
   *
   * Which two survive is not the order they are written in. An item and an
   * ability are things this Pokémon brought and the rest is how it was
   * built, and "Choice Band" changes a row by half where "Def 252" moves it
   * a few points — so those two are kept first and whatever is left fills
   * the remaining slot. They still print in the usual order once chosen:
   * which pills are shown is a different question from where they go.
   */
  const CHIPS = 3
  const priority = [
    gear?.ability, gear?.item, ...brought, ...raised, ...dropped,
  ].filter(Boolean) as string[]
  const keeping = new Set(chosen.length > CHIPS ? priority.slice(0, CHIPS - 1) : chosen)
  const shown = chosen.filter((c) => keeping.has(c))
  const hidden = chosen.filter((c) => !keeping.has(c))

  /*
   * A Mega has neither to give. The stone is in its item slot, and its
   * ability comes with the forme rather than being one of three — Showdown
   * files exactly one against every Mega and Primal. So there is nothing to
   * choose and no plus.
   */
  const mega = isMega(pokemon)

  /*
   * All three, or none.
   *
   * Only offering the ones this calculation reads was half right: it kept
   * out the Pokémon whose abilities change nothing here, but it also kept
   * out the way to say a Pokémon is not running the one that does. Persian-
   * Alola has Fur Coat, Technician and Rattled — two of those are nothing
   * to these numbers and the third doubles its Defense, so the useful
   * choice is between them, and choosing Technician is how you say it does
   * not have Fur Coat.
   *
   * So: if any of them lands, all of them are offered. If none does, there
   * is nothing to choose between and no picker.
   */
  const own = [...new Set(Object.values(pokemon.abilities))]
  const abilities = own.some((a) => MODELLED_ABILITIES.has(a)) ? own : []
  /*
   * The type boosters kept apart from the rest.
   *
   * Twenty-two of the twenty-nine are the same item — a fifth to one type —
   * and listed together they bury the seven that do something else. Each
   * says which type it lends to, since half of them are named after a
   * mineral rather than the type it belongs to.
   */
  /*
   * A plate for each of its own types, and no others.
   *
   * All twenty-two were on offer to everything, Ogerpon's masks included.
   * Following the Pokemon's types rather than its moves means a plate for a
   * coverage move is not offered — a Garchomp with Fire Blast cannot be
   * given a Flame Plate here — which is the trade for a list of two rather
   * than a list of six.
   */
  const { plain, boosters } = useMemo(() => {
    const own = new Set<string>(pokemon.types)
    const usable = GIVEABLE_ITEMS.filter((n) => itemMatters(n, pokemon))
    return {
      plain: usable.filter((n) => !typeBoosted(n)),
      boosters: usable.filter((n) => {
        const type = typeBoosted(n)
        return type != null && own.has(type)
      }),
    }
  }, [pokemon])

  /*
   * What it could be given, once somebody has said what they are looking
   * for. Its own damaging movepool minus what it already has, popular
   * first — and nothing at all until a letter is typed, because the list
   * above is what it is carrying and a hundred rows of what it is not
   * would bury that.
   */
  const has = new Set((carrying ?? []).map((m) => toId(m.name)))
  const addable = useMemo(() => {
    const q = find.trim().toLowerCase()
    if (!open || !onNamed || !learnset || !moves || !q) return []
    const rank = new Map((played ?? []).map((id, i) => [id, i]))
    return Object.keys(learnset)
      .filter((id) => !has.has(id))
      .map((id) => moves[id])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0
        && m.name.toLowerCase().includes(q))
      .sort((a, b) => (rank.get(toId(a.name)) ?? Infinity) - (rank.get(toId(b.name)) ?? Infinity)
        || b.basePower - a.basePower
        || a.name.localeCompare(b.name))
      .slice(0, 30)
    // `has` is rebuilt every render from `carrying`, which is the dependency
    // that actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onNamed, learnset, moves, played, carrying, find])

  /*
   * Taking one off is not always the same act. A move named by hand is
   * unnamed; one it was reckoned to have is struck off the reckoning, and
   * finding it again in the search puts it back rather than naming it
   * twice.
   */
  const dropMove = (id: string) => {
    if (named?.includes(id)) onNamed?.(named.filter((x) => x !== id))
    else onChange({ ...gear, without: [...(gear?.without ?? []), id] })
  }
  const addMove = (move: Move) => {
    const id = toId(move.name)
    if (gear?.without?.includes(id)) {
      onChange({ ...gear, without: gear.without.filter((x) => x !== id) })
    } else {
      onNamed?.([...(named ?? []), id])
    }
    setFind('')
  }

  // Nothing to choose at all: no lists, and no spread to credit it with.
  const nothing = mega || (!abilities.length && !plain.length && !boosters.length)
  if (nothing && !assume && !onHide && !onNamed) return null

  return (
    <span className="ev-gear">
      {/* What has been said, and the way to say more — two buttons rather
          than one, so the plus can keep its own shape instead of stretching
          to whatever is written above it. Either opens the same panel. */}
      {shown.map((what) => (
        <button
          key={what}
          type="button"
          className="ev-gear-chip"
          aria-expanded={open}
          title={what}
          onClick={() => setOpen((v) => !v)}
        >
          {what}
        </button>
      ))}
      {hidden.length > 0 && (
        <button
          type="button"
          className="ev-gear-chip is-more"
          aria-expanded={open}
          title={hidden.join(' · ')}
          onClick={() => setOpen((v) => !v)}
        >
          {hidden.length} more
        </button>
      )}
      <button
        type="button"
        className={`ev-gear-open${chosen.length ? ' has-gear' : ''}`}
        aria-expanded={open}
        aria-label={`Settings for ${pokemon.name}`}
        title={`Settings for ${pokemon.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {'\u22ef'}
      </button>

      {open && (
        <>
          {/* Click anywhere else and it closes, which is what a reader
              expects of something that opened over the page. */}
          <button type="button" className="ev-gear-away" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="ev-gear-pop">
            {/* In or out of the columns, above everything about how it is
                built: whether to count it at all comes before what to
                count it as. */}
            {onHide && (
              <button
                type="button"
                className="ev-hide"
                aria-pressed={Boolean(out)}
                onClick={() => onHide(!out)}
              >
                {out ? 'Show in the columns' : 'Hide from the columns'}
              </button>
            )}
            {/* What it is built like, per Pokémon rather than one setting for
                the whole side: they are not all built the same way, and a
                spread chosen against "everything at 252" is chosen against a
                team nobody brought. */}
            {assume && onAssume && (
              <div className="ev-gear-assumes">
                <AssumePicker
                  label="HP" value={assume.hp} states={['ivs', 'max']}
                  onPick={(hp) => onAssume({ ...assume, hp: hp as 'ivs' | 'max' })}
                />
                <AssumePicker
                  label="Def / SpD" value={assume.bulk} states={['ivs', 'max', 'max+']}
                  onPick={(bulk) => onAssume({ ...assume, bulk })}
                />
                <AssumePicker
                  label="Atk / SpA" value={assume.power} states={['ivs', 'max', 'max+']}
                  onPick={(power) => onAssume({ ...assume, power })}
                />
              </div>
            )}
            {/* Dropped IVs. Two of the six are dropped on purpose and often:
                zero Attack takes a third off Foul Play and confusion, zero
                Speed is how anything gets under a Trick Room. The other four
                are here because leaving them out would mean explaining why. */}
            <div className="ev-gear-ivs">
              <span>IVs</span>
              <div>
                {EV_STATS.map((stat) => (
                  <label key={stat} className="ev-iv">
                    <span>{STAT_LABELS[stat]}</span>
                    <input
                      type="number" min={0} max={IV_MAX} step={1}
                      value={gear?.ivs?.[stat] ?? IV_MAX}
                      aria-label={`${STAT_LABELS[stat]} IVs`}
                      onChange={(e) => {
                        const n = Math.max(0, Math.min(IV_MAX, Math.round(Number(e.target.value) || 0)))
                        const ivs = { ...gear?.ivs }
                        // Thirty-one is the absence of a choice, not a choice
                        // of 31: stored, it would print a pill saying so.
                        if (n >= IV_MAX) delete ivs[stat]
                        else ivs[stat] = n
                        onChange({ ...gear, ivs: Object.keys(ivs).length ? ivs : undefined })
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
            {abilities.length > 0 && (
              <label>
                <span>Ability</span>
                {/* No blank option: it already has an ability, and "its
                    set's" was a way of naming it without saying which. */}
                <select
                  value={gear?.ability || usual}
                  onChange={(e) => onChange({ ...gear, ability: e.target.value })}
                >
                  {abilities.map((a) => (
                  <option key={a} value={a}>
                    {a}{MODELLED_ABILITIES.has(a) ? '' : ' — no effect here'}
                  </option>
                ))}
                </select>
              </label>
            )}
            {!mega && (
            <label>
              <span>Item</span>
              <select
                value={gear?.item ?? ''}
                onChange={(e) => onChange({ ...gear, item: e.target.value })}
              >
                <option value="">none</option>
                {plain.map((n) => (
                  <option key={n} value={n}>{n} — {itemEffect(n)}</option>
                ))}
                {boosters.length > 0 && (
                  <optgroup label="Type boosters">
                    {boosters.map((n) => (
                      <option key={n} value={n}>{n} — {itemEffect(n)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            )}
            {/* Anything it might be carrying that its set does not say.
                Its own movepool and nothing else: a move it cannot learn
                is not a thing it might bring. */}
            {onNamed && moves && (
              <div className="ev-gear-moves">
                <span>Moves in the columns</span>
                {carrying && carrying.length > 0 ? (
                  <ol className="ev-set-slots">
                    {carrying.map((move) => (
                      <li key={move.name}>
                        <button
                          type="button"
                          className={`ev-set-slot${named?.includes(toId(move.name)) ? ' is-named' : ''}`}
                          title={`Take ${move.name} off this Pokémon`}
                          onClick={() => dropMove(toId(move.name))}
                        >
                          <MoveCategory category={move.category} />
                          <span className="ev-set-name">{move.name}</span>
                          <TypeChip type={move.type} />
                          <span className="ev-extra-drop" aria-hidden="true">{'×'}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="ev-set-none">
                    {out
                      ? 'Hidden, so none of its moves are being read.'
                      : 'Nothing, so it threatens with nothing.'}
                  </p>
                )}
                <input
                  type="search" value={find} placeholder="Add a move…"
                  aria-label={`Add a move ${pokemon.name} might carry`}
                  onChange={(e) => setFind(e.target.value)}
                />
                {find.trim() && (
                  <ul className="ev-set-list">
                    {addable.map((m) => (
                      <li key={m.name}>
                        <button type="button" onClick={() => addMove(m)}>
                          <MoveCategory category={m.category} />
                          <span className="ev-set-name">{m.name}</span>
                          <em>{m.type} · {m.basePower}</em>
                        </button>
                      </li>
                    ))}
                    {addable.length === 0 && <li className="ev-set-none">Nothing matches.</li>}
                  </ul>
                )}
              </div>
            )}
            {/* Everything said about this one, unsaid. Shown only where
                there is something to undo — the pills above the plus are
                exactly what it clears, so no pills means no button. */}
            {chosen.length > 0 && (
              <button
                type="button"
                className="link-btn"
                onClick={() => { onChange({}); onAssume?.(ASSUME_BARE); onNamed?.([]) }}
              >
                Reset {pokemon.name}
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
  /** Owned by the card, so one picker in the bar serves this and the tiers. */
  level: number
}

export function EvCalcBody({
  teamOne, teamTwo, chart, moves, learnsets, sets, played, dex, level,
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
  /** What each of the other side is credited with, one answer per Pokémon. */
  const [assume, setAssume] = useState<Record<string, Assumptions>>({})
  const credit = (id: string) => assume[id] ?? ASSUME_BARE
  /** Moves named by hand, credited to every opponent that can learn one. */
  const [extra, setExtra] = useState<Record<string, string[]>>({})
  const names = (id: string, next: string[]) =>
    setExtra((prev) => ({ ...prev, [id]: next }))
  /** Which shape to read it in, for the ones that have more than one. */
  const [shape, setShape] = useState<string | null>(null)
  /**
   * The four it is throwing, where somebody has said.
   *
   * Null is not "no moves" but "nobody has said" — the set it is usually
   * seen with stands in until then, so the Attack and Special Attack
   * columns are populated before the overlay has ever been opened, and
   * opening it and closing it again changes nothing.
   */
  const [myset, setMyset] = useState<string[] | null>(null)
  const [movesOpen, setMovesOpen] = useState(false)
  const [moveQuery, setMoveQuery] = useState('')
  /** Items and abilities given out by hand, on either side. */
  const [gear, setGear] = useState<Record<string, Gear>>({})
  const give = (id: string, next: Gear) => setGear((prev) => ({ ...prev, [id]: next }))

  /**
   * The ability to read a Pokémon with when nobody has chosen one:
   * whatever its most-used set runs, and failing that the first it is
   * listed with, which is the one it is usually seen with. Shared with
   * the picker, so what is shown selected is what the columns are
   * calculated from.
   */
  const usualAbility = (id: string, mon: Pokemon) =>
    sets?.[id]?.spreads?.[0]?.ability ?? Object.values(mon.abilities)[0] ?? ''

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

  /** The four it would be seen with, standing in until somebody says otherwise. */
  const usual: Move[] = useMemo(() => (picked
    ? usualMoves(
      picked.entry.pokemon, sets?.[picked.entry.id],
      learnsets?.[picked.entry.id], moves, played,
    )
    : []), [picked, sets, learnsets, moves, played])

  /**
   * My own four. Exactly four, and exactly the ones named: the Attack and
   * Special Attack columns are the case for spending EVs on a move, and a
   * case built on a move this Pokémon is not carrying is not a case.
   */
  const myMoves: Move[] = useMemo(() => (myset
    ? myset.map((id) => moves[id]).filter((m): m is Move => Boolean(m))
    : usual), [myset, usual, moves])
  const setIds = useMemo(() => myMoves.map((m) => toId(m.name)), [myMoves])

  /**
   * What it could be throwing instead, popular first.
   *
   * Its whole damaging movepool, ordered by how often the format clicks each
   * one, so the four or five worth considering are at the top and the long
   * tail of universal TMs is below them rather than mixed in alphabetically.
   */
  const movePool = useMemo(() => {
    if (!picked || !movesOpen) return []
    const rank = new Map(played.map((id, i) => [id, i]))
    const q = moveQuery.trim().toLowerCase()
    return Object.keys(learnsets?.[picked.entry.id] ?? {})
      .map((id) => moves[id])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0
        && (!q || m.name.toLowerCase().includes(q)))
      .sort((a, b) => (rank.get(toId(a.name)) ?? played.length)
        - (rank.get(toId(b.name)) ?? played.length)
        || b.basePower - a.basePower
        || a.name.localeCompare(b.name))
      .slice(0, 60)
  }, [picked, movesOpen, moveQuery, learnsets, moves, played])

  const opponents = useMemo(
    () => (picked
      ? opponentsFrom(
        picked.foes.filter((m) => !off.has(m.id)),
        sets, moves, learnsets, played, level, assume, extra, gear,
      // Struck off here rather than inside the solver: what a Pokémon is
      // reckoned to have is the solver's business, and what somebody has
      // said it is not carrying is this panel's.
      ).map((o) => {
        const without = gear[o.id]?.without
        return without?.length
          ? { ...o, moves: o.moves.filter((m) => !without.includes(toId(m.name))) }
          : o
      })
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

  const choose = (id: string) => {
    setChosen(id)
    // A spread belongs to the Pokémon it was chosen for, and so does a
    // decision about which of the other side to weigh it against.
    setSpread(emptySpread())
    setOff(new Set())
    setShape(null)
    forgetSet()
  }

  /** Back to whatever the new Pokémon, or the new shape, is usually seen with. */
  const forgetSet = () => {
    setMyset(null)
    setMovesOpen(false)
    setMoveQuery('')
  }

  const dropFromSet = (id: string) => setMyset(setIds.filter((x) => x !== id))
  const addToSet = (move: Move) => {
    const id = toId(move.name)
    if (setIds.includes(id) || setIds.length >= SET_SIZE) return
    setMyset([...setIds, id])
    setMoveQuery('')
  }

  const plan = useMemo(() => {
    if (!picked) return null
    const worn = gear[picked.entry.id]
    return planFor({
      pokemon: picked.entry.pokemon,
      moves: myMoves,
      ivs: worn?.ivs,
      // No item until one is given. A set's item is a guess about a build,
      // and unlike its moves and its spread it is worth a third of the
      // damage on its own — too much to apply without being asked.
      item: worn?.item || undefined,
      // Whatever it is reckoned to have, matching what the picker shows.
      ability: worn?.ability
        || sets?.[picked.entry.id]?.spreads?.[0]?.ability
        || Object.values(picked.entry.pokemon.abilities)[0],
      spread,
      opponents,
      chart,
      level,
      // The league plays doubles, which takes a quarter off the spread moves.
      doubles: true,
    })
  }, [picked, myMoves, opponents, spread, chart, level, sets, gear])

  /** Any of this one's own dropped below 31, which every stat above reads. */
  const myIvs = picked ? gear[picked.entry.id]?.ivs : undefined

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
      {/* The controls down the left, and the Pokemon they are about beside
          them. Two columns rather than one row: a pill added under a sprite
          used to push the picker's row taller while the space next to the
          budget and the search sat empty. Now the sprites run down into it. */}
      <div className="ev-bar">
        <div className="ev-ours">
          <div className="ev-side">
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
                    onClick={() => { setShape(f.id); forgetSet() }}
                  >
                    {f.pokemon.forme ?? 'Base'}
                  </button>
                ))}
              </span>
            )}

            {/* Its four, which the Attack and Special Attack columns are the
                case for. Behind a button rather than always open: it is
                answered once per Pokemon and right most of the time, and the
                columns are what the tab is for. */}
            {picked && (
              <div className="ev-set">
                <button
                  type="button"
                  className="ev-set-open"
                  aria-expanded={movesOpen}
                  onClick={() => setMovesOpen((v) => !v)}
                >
                  Choose move set
                  <em>{myMoves.length}/{SET_SIZE}</em>
                </button>

                {movesOpen && (
                  <>
                    <button
                      type="button" className="ev-gear-away" aria-label="Close"
                      onClick={() => setMovesOpen(false)}
                    />
                    <div className="ev-set-pop">
                      <p className="ev-set-head">
                        <span>{picked.entry.pokemon.name}</span>
                        {myset && (
                          <button type="button" className="link-btn" onClick={forgetSet}>
                            Usual set
                          </button>
                        )}
                      </p>

                      {/* The slots as they stand, each its own way out of
                          itself. Empty ones are drawn rather than left out, so
                          the number still to choose is a thing you can see. */}
                      <ol className="ev-set-slots">
                        {Array.from({ length: SET_SIZE }, (_, i) => {
                          const move = myMoves[i]
                          return (
                            <li key={i}>
                              {move ? (
                                <button
                                  type="button"
                                  className="ev-set-slot"
                                  title={`Drop ${move.name}`}
                                  onClick={() => dropFromSet(toId(move.name))}
                                >
                                  <MoveCategory category={move.category} />
                                  <span className="ev-set-name">{move.name}</span>
                                  <TypeChip type={move.type} />
                                  <span className="ev-extra-drop" aria-hidden="true">{'×'}</span>
                                </button>
                              ) : (
                                <span className="ev-set-slot is-empty">Empty</span>
                              )}
                            </li>
                          )
                        })}
                      </ol>

                      <input
                        type="search" value={moveQuery} placeholder="Search its moves…"
                        aria-label={`Search ${picked.entry.pokemon.name}'s moves`}
                        onChange={(e) => setMoveQuery(e.target.value)}
                      />

                      {/* Damaging only. These four fill the Attack and Special
                          Attack columns, and a status move puts nothing in
                          either — offering one would be offering a slot that
                          changes no number on the page. */}
                      <ul className="ev-set-list">
                        {movePool.map((m) => (
                          <li key={m.name}>
                            <button
                              type="button"
                              className={setIds.includes(toId(m.name)) ? 'is-chosen' : undefined}
                              disabled={!setIds.includes(toId(m.name)) && setIds.length >= SET_SIZE}
                              onClick={() => (setIds.includes(toId(m.name))
                                ? dropFromSet(toId(m.name))
                                : addToSet(m))}
                            >
                              <MoveCategory category={m.category} />
                              <span className="ev-set-name">{m.name}</span>
                              <em>{m.type} · {m.basePower}</em>
                            </button>
                          </li>
                        ))}
                        {movePool.length === 0 && (
                          <li className="ev-set-none">Nothing matches.</li>
                        )}
                      </ul>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* What is left to spend, drawn rather than counted out. Five
                hundred and eight is a number you have to subtract from; a
                bar is a thing you can see the end of. */}
            {picked && (
              <span className={`ev-budget${left === 0 ? ' is-full' : ''}`}>
                <span className="ev-budget-bar">
                  <span style={{ width: `${(used / EV_BUDGET) * 100}%` }} />
                </span>
                <span className="ev-budget-read">
                  {used}<i>/{EV_BUDGET}</i>
                </span>
              </span>
            )}
          </div>

          {/* Its picture where it was, to the right of the controls that
              are about it — only the box around the two of them is new.
              The picker opens the list; this opens the Pokémon, the way
              a sprite does everywhere else on the site. */}
          {picked && (
            <span className="ev-mine">
              <PokemonLink
                id={picked.entry.id}
                className="ev-open"
                title={`Open ${picked.entry.pokemon.name}`}
              >
                <Sprite pokemon={picked.entry.pokemon} width={SPRITE_W} height={SPRITE_H} />
              </PokemonLink>
              <GearPicker
                pokemon={picked.entry.pokemon}
                usual={usualAbility(picked.entry.id, picked.entry.pokemon)}
                gear={gear[picked.entry.id]} onChange={(g) => give(picked.entry.id, g)}
              />
            </span>
          )}
        </div>

        {picked && (
          <div className="ev-mons">
            {picked.foes.length > 0 && (
              <div className="ev-foes">
                {picked.foes.map((m) => (
                  <span key={m.id} className="ev-foe-slot">
                    {/* Opens the Pokémon, the way a sprite does everywhere
                        else on the site. Leaving it out of the columns used
                        to be a click here, which meant the one thing a
                        picture of a Pokémon always does was the one thing
                        this picture did not — it is in the menu below now. */}
                    <PokemonLink
                      id={m.id}
                      className={`ev-open${off.has(m.id) ? ' is-off' : ''}`}
                      title={`Open ${m.pokemon.name}`}
                    >
                      <Sprite pokemon={m.pokemon} width={SPRITE_W} height={SPRITE_H} />
                    </PokemonLink>
                    <GearPicker
                      pokemon={m.pokemon}
                      usual={usualAbility(m.id, m.pokemon)}
                      gear={gear[m.id]} onChange={(g) => give(m.id, g)}
                      assume={credit(m.id)}
                      onAssume={(next) => setAssume((prev) => ({ ...prev, [m.id]: next }))}
                      learnset={learnsets?.[m.id]}
                      moves={moves}
                      played={played}
                      named={extra[m.id]}
                      onNamed={(next) => names(m.id, next)}
                      carrying={opponents.find((o) => o.id === m.id)?.moves}
                      out={off.has(m.id)}
                      onHide={(next) => setOff((prev) => {
                        const now = new Set(prev)
                        if (next) now.add(m.id)
                        else now.delete(m.id)
                        return now
                      })}
                    />
                  </span>
                ))}
              </div>
            )}

          </div>
        )}
      </div>

      {/* The headings and their sliders in one grid, the lists in
          another below it, both on the same six columns. Two grids
          rather than six columns of both, so the whole top can stick
          while the lists run under it. */}
      {picked && (
        <div className="ev-cols ev-heads">
          {EV_STATS.map((stat) => (
            <StatHead
              key={stat}
              stat={stat}
              bare={statOfSpread(picked.entry.pokemon, level, bareSpread, stat, myIvs)}
              value={statOfSpread(picked.entry.pokemon, level, spread, stat, myIvs)}
              spread={spread}
              onEvs={(n) => setEvs(stat, n)}
              onNature={(m) => setNature(stat, m)}
            />
          ))}
        </div>
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
            The two attacking columns read from the four moves chosen under the picker,
            taking whichever of them does most to each Pokémon.
            Each Pokémon over there threatens with its most-used set plus the moves the
            format plays that it can learn
            {guessed.length > 0 && (
              <> — {guessed.map((o) => o.pokemon.name).join(', ')} {guessed.length === 1 ? 'has' : 'have'} no
                set on record, so that second list is all there is for {guessed.length === 1 ? 'it' : 'them'}</>
            )}
            . Weather, terrain, screens, boosts and Intimidate are not counted.
            {Object.values(assume).some((a) => a.bulk === 'max+' || a.power === 'max+') && (
              <> A boosting nature is credited to whichever of the pair each
                calculation reads, which no single Pokémon could have both of.</>
            )}
          </p>
        </>
      )}
    </div>
  )
}
