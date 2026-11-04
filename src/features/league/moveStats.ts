import { useEffect, useState } from 'react'
import type { MoveTally } from '../../data/league'
import type { MoveDex } from '../../data/types'
import { loadMoves, toId } from '../../data/load'
import { luckOf, type Luck, type Rolled } from '../../lib/luck'

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
