import type { Award, PokemonTotals } from '../data/league'

/**
 * Extends each award from its podium to the whole league.
 *
 * The sheet names three to five winners per award and stops. Every one of them
 * is a ranking underneath, though — the columns beside each podium say which
 * numbers were being weighed — so the rest of the order can be worked out and
 * shown, rather than leaving 130-odd Pokémon unplaced.
 *
 * Each rule below was checked against the podium the league actually picked,
 * using the values the sheet recorded beside it. A rule that could not
 * reproduce its own podium would be a guess about what the award means, and is
 * not worth showing; `rankForAward` falls back to the podium alone in that case.
 *
 * Two of them are not what the column headers suggest, which is exactly why
 * they were checked:
 *
 *   - "Most Efficient Sweepers" is not the site's K/D. That treats a Pokémon
 *     which has never fainted as infinite, so all three deathless ones would
 *     top the list — but the league put Regice first on 6.00. Its own write-up
 *     says why: zero deaths count as one. `12 / max(2,1)` is 6, `4 / max(0,1)`
 *     is 4, and the podium falls out exactly.
 *   - "The Unkillable Menaces" is ranked by kills, like the Bloodthirsty award,
 *     and would be the same table — except that every Pokémon the league named
 *     has never fainted. It is a ranking of the deathless, and the column
 *     header does not say so.
 */

export interface AwardRule {
  /** Which Pokémon the award is even about. Most are about all of them. */
  only?: (t: PokemonTotals) => boolean
  /** Highest first, unless the podium says otherwise. */
  compare: (a: PokemonTotals, b: PokemonTotals) => number
  /** The column the table should mark as the one being ranked by. */
  highlight: 'kills' | 'deaths' | 'diff' | 'kd' | 'killsPerGame' | 'gamesPlayed'
  /** How the order reads, in words, for the line above the table. */
  note: string
}

/** Kills per death, counting a Pokémon that never fainted as having died once. */
const perLife = (t: PokemonTotals) => t.kills / Math.max(t.deaths, 1)

const RULES: Record<string, AwardRule> = {
  'most bloodthirsty killer': {
    compare: (a, b) => b.kills - a.kills || b.diff - a.diff,
    highlight: 'kills',
    note: 'Most KOs',
  },
  'that one friend you can always rely on': {
    compare: (a, b) => b.diff - a.diff || b.kills - a.kills,
    highlight: 'diff',
    note: 'Best differential',
  },
  'most efficient sweepers': {
    compare: (a, b) => perLife(b) - perLife(a) || b.kills - a.kills,
    highlight: 'kd',
    note: 'Most KOs per life lost — a Pokémon that never fainted counts as one',
  },
  'the unkillable menaces': {
    only: (t) => t.deaths === 0,
    compare: (a, b) => b.kills - a.kills || a.gamesPlayed - b.gamesPlayed,
    highlight: 'deaths',
    note: 'Never fainted, most KOs first',
  },
  'the contract killers': {
    compare: (a, b) => b.killsPerGame - a.killsPerGame || b.kills - a.kills,
    highlight: 'killsPerGame',
    note: 'Most KOs per game',
  },
  "the president's most secret service": {
    compare: (a, b) => a.diff - b.diff || b.deaths - a.deaths,
    highlight: 'diff',
    note: 'Worst differential — the ones who took the hits',
  },
}

const key = (title: string) =>
  title.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()

export const ruleFor = (award: Award): AwardRule | null => RULES[key(award.title)] ?? null

/**
 * The award's full order over everything that played.
 *
 * Returns null when there is no rule for this award, which is the honest answer
 * for one whose ordering has not been worked out — the caller shows the podium
 * the sheet gave instead of inventing a list.
 */
export function rankForAward(award: Award, totals: PokemonTotals[]): PokemonTotals[] | null {
  const rule = ruleFor(award)
  if (!rule) return null
  return totals.filter(rule.only ?? (() => true)).sort(rule.compare)
}
