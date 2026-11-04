/**
 * How a Pokémon's dice went against how they should have gone.
 *
 * The replay reader counts the rolls a Pokémon made and how many went its
 * way: accuracy checks it won, critical hits it landed. Put next to the odds
 * on each of those, that answers the question everybody actually argues about
 * after a game — was that fair?
 *
 * The maths is a Poisson binomial — a run of coin flips with different odds
 * on each — worked out exactly rather than approximated, because the counts
 * here are tiny and an approximation over nine Rock Slides is worth nothing.
 *
 * Everything is figured from each move's *listed* numbers, which are what
 * anyone reading a set has in mind. The battle can be harsher or kinder than
 * the list — a sandstorm over a Sand Veil, a Scope Lens, a Pokémon halfway
 * through a Fly — and those land here as luck, because against the listed
 * number that is exactly what they look like.
 */

/** One kind of roll, and how it went. */
export interface Chance {
  /** What to call it where the breakdown is read. */
  label: string
  /** Rolls of this kind. */
  rolls: number
  /** How many of them went the Pokémon's way. */
  good: number
  /** The chance of that happening, per roll, from 0 to 1. */
  chance: number
}

export type Verdict = 'good' | 'bad' | 'even' | 'none'

/** One line of the breakdown: a kind of roll, and how it actually went. */
export interface Part {
  label: string
  rolls: number
  good: number
  expected: number
  /** What that is worth in luck points. See `Score.points`. */
  points: number
}

export interface Score {
  /** Rolls counted across every kind. */
  rolls: number
  /** How many went the Pokémon's way. */
  good: number
  /** How many the odds say should have. */
  expected: number
  /**
   * Luck points: how far above or below an average run of the same dice
   * this one landed.
   *
   * A roll that comes off is worth the inverse of its odds, because that is
   * the part of it nobody was owed. Land a one-in-ten and that is +0.9;
   * land a nine-in-ten and it is +0.1, since nine times in ten it was going
   * to happen anyway. A roll that does not come off costs the odds
   * themselves, so missing a nine-in-ten is −0.9 and failing a one-in-ten
   * is only −0.1.
   *
   * Which makes every kind of luck the same currency — a missed Focus
   * Blast, a critical hit, a flinch — and makes them addable. Nought is an
   * ordinary run of the same dice; the sign says which way it went.
   *
   * It falls straight out of counting what happened against what was
   * expected, so the whole thing is one subtraction.
   */
  points: number
  /**
   * Where this run sits among every run it could have been, as a share:
   * 1 is the luckiest there is, 0 the unluckiest, and half is dead average.
   *
   * The headline number, because it reads the way people expect a
   * percentage to — bigger is better, all the way up.
   *
   * Counted as the chance of doing worse than this, plus half the chance of
   * doing exactly this. The half is what keeps it honest with whole numbers
   * of rolls: without it a flawless run would score 100% against odds that
   * were never certain.
   */
  percentile: number
  /**
   * The chance of a run at least this far from par, in the direction it
   * went. Said in words behind the number, because "two turns up" means
   * different things over ten rolls and over two hundred.
   */
  odds: number
  verdict: Verdict
  /** Each kind that actually rolled, in the order it was given. */
  parts: Part[]
}

/**
 * How far up or down the range a run has to land before it gets called
 * lucky or unlucky: the top or bottom sixth of everything it could have been.
 *
 * Judged on where it sits rather than on how far off expectation it landed,
 * because one roll more or less means different things at different volumes.
 * Two misses where one was expected sounds damning and is a sixth of the way
 * down; five fewer than expected over two hundred rolls sounds like nothing
 * and is a genuinely charmed season.
 */
const LUCKY = 0.85
const UNLUCKY = 0.15

/** Below half a roll's worth of doubt, a clean run is not luck, it is arithmetic. */
const QUIET = 0.5

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: 'Good',
  bad: 'Bad',
  even: 'Average',
  none: '—',
}

/**
 * The chance of each possible number of successes, grown one roll at a time.
 *
 * Rolls that cannot go either way are skipped rather than folded in, which
 * would be a run of multiplications by one — they shift the count, not the
 * shape of it.
 */
function spreadOf(trials: { rolls: number; chance: number }[]): number[] {
  let spread = [1]
  for (const trial of trials) {
    const p = Math.min(1, Math.max(0, trial.chance))
    if (p >= 1 || p <= 0) continue
    for (let n = 0; n < trial.rolls; n += 1) {
      const next = new Array<number>(spread.length + 1).fill(0)
      for (let k = 0; k < spread.length; k += 1) {
        next[k] += spread[k] * (1 - p)
        next[k + 1] += spread[k] * p
      }
      spread = next
    }
  }
  return spread
}

export function scoreOf(chances: Chance[]): Score {
  // Clamped, because a reader that credits an effect to the wrong move can
  // hand a kind more successes than it had rolls, and the spread below has
  // nowhere to put the extra.
  const live = chances.filter((c) => c.rolls > 0)
    .map((c) => ({ ...c, good: Math.min(Math.max(0, c.good), c.rolls) }))
  const rolls = live.reduce((n, c) => n + c.rolls, 0)
  const good = live.reduce((n, c) => n + c.good, 0)
  const expected = live.reduce((n, c) => n + c.rolls * c.chance, 0)

  /*
   * The spread covers the rolls that could go either way, so it counts
   * successes among those alone. The certain ones are a floor every run has,
   * and come off before reading the result's place in it.
   */
  const certain = live.filter((c) => c.chance >= 1).reduce((n, c) => n + c.rolls, 0)
  const spread = spreadOf(live)
  const at = good - certain
  let worse = 0
  for (let k = 0; k < at && k < spread.length; k += 1) worse += spread[k]
  const exact = at >= 0 && at < spread.length ? spread[at] : 0
  const percentile = Math.min(1, Math.max(0, worse + exact / 2))

  /*
   * Nothing to say where there was next to no chance of anything going
   * wrong and nothing did: calling one click of a 95% move "average" is a
   * verdict on a coin that was never really flipped. A roll that went the
   * wrong way is always worth judging, however unlikely it was.
   */
  const doubt = live.reduce((n, c) => n + c.rolls * (1 - c.chance), 0)
  const idle = rolls === 0 || (good >= rolls && doubt < QUIET)
  const verdict: Verdict = idle ? 'none'
    : percentile >= LUCKY ? 'good'
      : percentile <= UNLUCKY ? 'bad'
        : 'even'

  /*
   * Gathered by name for the breakdown, because the rolls come in one per
   * move — a reader wants "accuracy: 18 of 20", not twelve lines of it. The
   * spread above still used each move's own odds.
   */
  const parts: Part[] = []
  for (const c of live) {
    const held = parts.find((p) => p.label === c.label)
    if (held) {
      held.rolls += c.rolls
      held.good += c.good
      held.expected += c.rolls * c.chance
    } else {
      parts.push({
        label: c.label, rolls: c.rolls, good: c.good, expected: c.rolls * c.chance, points: 0,
      })
    }
  }
  for (const part of parts) part.points = part.good - part.expected

  // How unusual a run this far from par is, read from the tail it fell in.
  let odds = 0
  if (good >= expected) {
    for (let k = Math.max(0, at); k < spread.length; k += 1) odds += spread[k]
  } else {
    for (let k = 0; k <= at && k < spread.length; k += 1) odds += spread[k]
  }

  return {
    rolls, good, expected, points: good - expected, percentile,
    odds: Math.min(1, Math.max(0, odds)), verdict, parts,
  }
}

/** `56%`, and the two edges said as edges rather than rounded to a certainty. */
export function oddsLabel(odds: number): string {
  if (odds >= 0.995) return '>99%'
  if (odds < 0.005) return '<1%'
  return `${Math.round(odds * 100)}%`
}

/**
 * Luck points, signed, which is what a Luck column shows.
 *
 * Always signed and always to a decimal, because a bare `2` next to a bare
 * `-3` in the same column reads as a count of something rather than as a
 * distance from where an average run would have been.
 */
export function pointsLabel(points: number): string {
  const rounded = Math.round(points * 10) / 10
  if (Object.is(rounded, -0) || rounded === 0) return '0.0'
  return `${rounded > 0 ? '+' : '\u2212'}${Math.abs(rounded).toFixed(1)}`
}

/** What a Luck column shows, or nothing where nothing was in doubt. */
export const luckLabel = (luck: { points: number; verdict: Verdict }): string =>
  luck.verdict === 'none' ? VERDICT_LABEL.none : pointsLabel(luck.points)
