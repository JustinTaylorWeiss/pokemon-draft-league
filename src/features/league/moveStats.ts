import { useEffect, useState } from 'react'
import type { MoveTally } from '../../data/league'
import type { MoveDex } from '../../data/types'
import { loadMoves, toId } from '../../data/load'
import {
  luckOf, oddsLabel, scoreOf,
  type Chance, type Luck, type Rolled, type Score,
} from '../../lib/luck'

/**
 * What the two move breakdowns — a match's and a Pokémon's season — both need
 * to turn stored tallies into the two columns people read them for.
 */

/**
 * Damage per click, which is the number that compares two moves.
 *
 * A total says how much work a move did and so rewards whatever was pressed
 * most; this says how hard it hits. One decimal while that still means
 * something, and whole points once it does not.
 */
export function perUse(tally: MoveTally): number {
  if (!tally.used) return 0
  const each = tally.damage / tally.used
  return each >= 10 ? Math.round(each) : Math.round(each * 10) / 10
}

/** Listed accuracy, `true` for a move that cannot miss, null for one the dataset lacks. */
export function accuracyOf(moves: MoveDex | null, name: string): number | true | null {
  return moves?.[toId(name)]?.accuracy ?? null
}

/** Every move's accuracy record, ready for the luck sums. */
export function shotsOf(tallies: MoveTally[], moves: MoveDex | null): Rolled[] {
  return tallies.map((t) => ({
    rolls: t.rolls,
    misses: t.misses,
    accuracy: accuracyOf(moves, t.name),
  }))
}

export const luckFor = (tallies: MoveTally[], moves: MoveDex | null): Luck =>
  luckOf(shotsOf(tallies, moves))

/** Adds one game's tallies into a running list, by move name. */
export function addTallies(into: MoveTally[], from: MoveTally[]): void {
  for (const move of from) {
    const held = into.find((x) => x.name === move.name)
    if (!held) { into.push({ ...move }); continue }
    held.used += move.used
    held.kos += move.kos
    held.damage += move.damage
    held.rolls += move.rolls
    held.misses += move.misses
    held.crits += move.crits
    held.procs += move.procs
    held.live += move.live
    held.liveEarly += move.liveEarly
    held.liveClean += move.liveClean
  }
}

/** Most used first, which is the order a set reads in. */
export const byUse = (a: MoveTally, b: MoveTally) =>
  b.used - a.used || b.kos - a.kos || a.name.localeCompare(b.name)

/**
 * The move dataset, fetched the first time something that needs it is opened.
 *
 * It is 140KB to fill in two columns, and most readers never open a
 * breakdown, so the league tab does not carry it just to draw itself.
 */
export function useMoveDex(wanted: boolean): MoveDex | null {
  const [moves, setMoves] = useState<MoveDex | null>(null)
  useEffect(() => {
    if (!wanted || moves) return
    let live = true
    // A breakdown without accuracies is still worth reading, so a failure
    // here leaves those two columns blank rather than taking the panel down.
    loadMoves().then((all) => { if (live) setMoves(all) }, () => {})
    return () => { live = false }
  }, [wanted, moves])
  return moves
}

/** Base critical-hit odds, and what a high-crit move raises them to. */
const CRIT_ODDS: Record<number, number> = { 1: 1 / 24, 2: 1 / 8, 3: 1 / 2, 4: 1 }

/** Hits that landed, which is what a crit and a secondary each roll off. */
const landed = (tally: MoveTally) => Math.max(0, tally.rolls - tally.misses)

/**
 * Every roll a Pokémon made, for the overall luck score.
 *
 * Two kinds, because two are all the log can be honest about:
 *
 *  - Accuracy, which is written down every time it fails.
 *  - Critical hits, which are written down every time they land, and whose
 *    odds are one in twenty-four unless the move says otherwise. Status
 *    moves are left out: they never crit, and counting their hits as crit
 *    rolls had the league running a third under expectation.
 *
 *  - Secondary effects: a flinch, a burn, a stat knocked down.
 *
 * What each is out of matters as much as the chance. A hit that knocked the
 * target out had nowhere to put a burn; a flinch only ever shows on a target
 * that was still to move, and only if it lived long enough to try. The
 * reader counts those three narrowing denominators, and the move's own kind
 * says which one to read — without them the league came out at two thirds of
 * what the listed chances called for, which is a measure of the reading
 * rather than of the season.
 */
export function chancesOf(tallies: MoveTally[], moves: MoveDex | null): Chance[] {
  const out: Chance[] = []
  for (const tally of tallies) {
    const move = moves?.[toId(tally.name)]
    if (!move) continue
    if (tally.rolls > 0) {
      out.push({
        label: 'Accuracy',
        rolls: tally.rolls,
        good: tally.rolls - tally.misses,
        chance: move.accuracy === true ? 1 : move.accuracy / 100,
      })
    }
    const hits = landed(tally)
    if (hits > 0 && move.category !== 'Status' && !move.willCrit) {
      out.push({
        label: 'Critical hits',
        rolls: hits,
        good: tally.crits,
        chance: CRIT_ODDS[move.critRatio ?? 1] ?? CRIT_ODDS[1],
      })
    }
    const could = move.secondaryKind === 'flinch' ? tally.liveEarly
      : move.secondaryKind === 'status' ? tally.liveClean
        : tally.live
    /*
     * Only where the effect is a chance. A Fake Out flinches every time and
     * a Salt Cure always sticks, so neither is luck — and the handful the
     * reader fails to spot (a Covert Cloak, a confusion that needed the
     * target to have a stat raised) would read as an impossibility and put
     * an otherwise ordinary Pokémon at the bottom of the league.
     */
    if (move.secondaryChance && move.secondaryChance < 100 && could > 0) {
      out.push({
        label: 'Extra effects',
        rolls: could,
        good: tally.procs,
        chance: move.secondaryChance / 100,
      })
    }
  }
  return out
}

export const scoreFor = (tallies: MoveTally[], moves: MoveDex | null): Score =>
  scoreOf(chancesOf(tallies, moves))



/**
 * The overall luck score written out, for the tooltip behind the number.
 *
 * Newlines rather than markup: this goes in a `title`, which is the only
 * tooltip that works the same on a phone's long-press, a keyboard focus and
 * a mouse without a line of script behind it.
 */
export function scoreNote(score: Score): string {
  if (!score.rolls) return 'Nothing this Pokémon did was a roll of the dice.'
  const named = {
    good: 'Good luck', bad: 'Bad luck', even: 'Average luck',
    none: 'Nothing here could really have gone either way',
  }[score.verdict]
  const head = score.verdict === 'none'
    ? `${named}: ${score.rolls} rolls, none of them in doubt.`
    : `${named} — ${oddsLabel(score.percentile)} of the way up the range of runs`
      + ' this Pokémon could have had.'
  const lines = score.parts.map((part) =>
    `${part.label}: ${part.good} of ${part.rolls}, ${part.expected.toFixed(1)} expected`)
  return [head, ...lines].join('\n')
}
