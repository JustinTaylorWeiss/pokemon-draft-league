import { useEffect, useState } from 'react'
import type { MoveTally } from '../../data/league'
import type { MoveDex } from '../../data/types'
import { loadMoves, toId } from '../../data/load'
import { oddsLabel, pointsLabel, scoreOf, type Chance, type Score } from '../../lib/luck'

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
    held.expHits += move.expHits
    held.critRolls += move.critRolls
    held.crits += move.crits
    held.expCrits += move.expCrits
    held.procRolls += move.procRolls
    held.procs += move.procs
    held.expProcs += move.expProcs
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

/**
 * Every roll a Pokémon made, for the luck score.
 *
 * Three kinds — accuracy, critical hits, extra effects — and the reader has
 * already done the hard part. Each roll's odds depend on the battle it was
 * made in, which is not something a tally can be asked about afterwards, so
 * the reader works them out as it goes and stores what it expected. All
 * that is left here is to put what happened next to it.
 *
 * A roll the reader found no odds for is simply not here: a move that
 * cannot miss, a target that cannot be crit, an effect a Sheer Force
 * attacker traded away.
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
        expected: tally.expHits,
      })
    }
    if (tally.critRolls > 0) {
      out.push({
        label: 'Critical hits', rolls: tally.critRolls, good: tally.crits, expected: tally.expCrits,
      })
    }
    /*
     * Only where the effect is a chance. A Fake Out flinches every time and
     * a Salt Cure always sticks, so neither is luck — and the handful the
     * reader fails to spot (a confusion that needed the target to have a
     * stat raised) would read as an impossibility and put an otherwise
     * ordinary Pokémon at the bottom of the league.
     */
    if (tally.procRolls > 0 && tally.expProcs < tally.procRolls) {
      out.push({
        label: 'Extra effects', rolls: tally.procRolls, good: tally.procs, expected: tally.expProcs,
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
  if (!score.rolls) return 'Nothing here was a roll of the dice.'
  if (score.verdict === 'none') {
    return `${score.rolls} rolls, none of them really in doubt.`
  }
  const named = { good: 'Good luck', bad: 'Bad luck', even: 'Average luck', none: '' }[score.verdict]
  const head = `${named}: ${pointsLabel(score.points)} against an average run of the same `
    + `dice, which comes up ${oddsLabel(score.odds)} of the time.`
  const lines = score.parts.map((part) =>
    `${part.label}: ${part.good} of ${part.rolls} at ${oddsLabel(part.expected / part.rolls)}, `
    + `${part.expected.toFixed(1)} expected — ${pointsLabel(part.points)}`)
  return [head, ...lines].join('\n')
}
