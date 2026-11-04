/**
 * How a Pokémon's accuracy rolls went against how they should have gone.
 *
 * The replay reader counts, per move, how many accuracy checks it made and how
 * many it lost. Put next to the move's listed accuracy, that answers the
 * question everybody actually argues about after a game: was that fair?
 *
 * The maths is a Poisson binomial — a run of coin flips with different odds on
 * each — worked out exactly rather than approximated, because the counts here
 * are tiny and an approximation over nine Rock Slides is worth nothing.
 *
 * It is figured from each move's *listed* accuracy, which is the number anyone
 * reading a set has in mind. Every move counts, a Fake Out as much as a Focus
 * Blast: one that cannot miss expects no misses and lands exactly on that, so
 * it moves nothing. The odds of a run come out the same whether those rolls
 * are in or out.
 *
 * Where the battle is harsher than the list — a sandstorm over a Sand Veil, a
 * Bright Powder, something halfway through a Fly — that lands here as bad
 * luck, because from the listed number that is exactly what it looks like. A
 * Fake Out that missed missed something the list says cannot be missed, and
 * saying so is the right answer even though the reason is elsewhere.
 */

/** One move's accuracy record. */
export interface Rolled {
  /** Accuracy checks it made, counted per target. */
  rolls: number
  /** How many of them it lost. */
  misses: number
  /**
   * Listed accuracy out of a hundred, `true` for a move that cannot miss, and
   * null for one the dataset does not carry — which is left out of the sums
   * rather than guessed at.
   */
  accuracy: number | true | null
}

export type Verdict = 'good' | 'bad' | 'even' | 'none'

export interface Luck {
  /** Accuracy rolls counted, which is all of them bar moves of unknown accuracy. */
  rolls: number
  misses: number
  /** Misses the listed accuracies say to expect over those rolls. */
  expected: number
  /**
   * Where this run sits among every run it could have been, as a share:
   * 1 is the luckiest there is, 0 the unluckiest, and half is dead average.
   *
   * The headline number, because it reads the way people expect a
   * percentage to — bigger is better, all the way up. The tail probability
   * below cannot do that: a 1% run and a 99th-percentile run are both
   * "1% likely", one of them because it was wonderful and the other
   * because it was dreadful.
   *
   * Counted as the chance of missing more than this, plus half the chance
   * of missing exactly this. The half is what keeps it honest with whole
   * numbers of misses: without it a flawless run would score 100% against
   * odds that were never certain.
   */
  percentile: number
  /**
   * The chance of a run this good or this bad: the probability of missing at
   * most this many when ahead of expectation, and at least this many when
   * behind. Never the probability of exactly this many, which is small for
   * everything and so says nothing. Said in words behind the percentage.
   */
  odds: number
  verdict: Verdict
}

/**
 * How far up or down the range a run has to land before it gets called
 * lucky or unlucky: the top or bottom sixth of everything it could have been.
 *
 * Judged on where it sits rather than on how far off expectation it landed,
 * because a whole miss means different things at different volumes. Two
 * misses where one was expected sounds damning and is a sixth of the way
 * down; five fewer than expected over two hundred rolls sounds like nothing
 * and is a genuinely charmed season.
 */
const LUCKY = 0.85
const UNLUCKY = 0.15

/** Below half a miss expected, a clean run is not luck, it is arithmetic. */
const QUIET = 0.5

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: 'Good',
  bad: 'Bad',
  even: 'Average',
  none: '—',
}

export function luckOf(shots: Rolled[]): Luck {
  // The chance of exactly k misses so far, grown one roll at a time.
  let spread = [1]
  let rolls = 0
  let misses = 0
  let expected = 0

  for (const shot of shots) {
    if (shot.accuracy == null || shot.rolls <= 0) continue
    const miss = shot.accuracy === true ? 0 : Math.min(1, Math.max(0, 1 - shot.accuracy / 100))
    rolls += shot.rolls
    misses += shot.misses
    expected += shot.rolls * miss
    // A move that cannot miss leaves the spread where it is, and folding it
    // in anyway would be a run of multiplications by one.
    if (miss <= 0) continue
    for (let n = 0; n < shot.rolls; n += 1) {
      const next = new Array<number>(spread.length + 1).fill(0)
      for (let k = 0; k < spread.length; k += 1) {
        next[k] += spread[k] * (1 - miss)
        next[k + 1] += spread[k] * miss
      }
      spread = next
    }
  }

  const chance = (k: number) => (k >= 0 && k < spread.length ? spread[k] : 0)
  let worse = 0
  for (let k = misses + 1; k < spread.length; k += 1) worse += spread[k]
  const percentile = Math.min(1, Math.max(0, worse + chance(misses) / 2))

  // Which tail to read is decided by which side of expectation the result
  // landed, so the number always answers "how unusual is this, in the
  // direction it went".
  let odds = 0
  if (misses <= expected) {
    for (let k = 0; k <= misses && k < spread.length; k += 1) odds += spread[k]
  } else {
    for (let k = misses; k < spread.length; k += 1) odds += spread[k]
  }
  odds = Math.min(1, Math.max(0, odds))

  /*
   * Nothing to say where there was next to no chance of missing and nothing
   * did: calling one click of a 95% move "average" is a verdict on a coin
   * that was never really flipped. A miss is always worth judging, however
   * unlikely the listed accuracy says it was.
   */
  const idle = rolls === 0 || (misses === 0 && expected < QUIET)
  const verdict: Verdict = idle ? 'none'
    : percentile >= LUCKY ? 'good'
      : percentile <= UNLUCKY ? 'bad'
        : 'even'

  return { rolls, misses, expected, percentile, odds, verdict }
}

/** `56%`, and the two edges said as edges rather than rounded to a certainty. */
export function oddsLabel(odds: number): string {
  if (odds >= 0.995) return '>99%'
  if (odds < 0.005) return '<1%'
  return `${Math.round(odds * 100)}%`
}

/** What the Luck column shows: the percentile, or nothing worth saying. */
export const luckLabel = (luck: Luck): string =>
  luck.verdict === 'none' ? VERDICT_LABEL.none : oddsLabel(luck.percentile)

/** The whole story in a sentence, behind the percentage. */
export function luckNote(luck: Luck): string {
  if (!luck.rolls) return 'Nothing here rolled for accuracy.'
  if (luck.verdict === 'none') {
    return `${luck.rolls} accuracy ${luck.rolls === 1 ? 'roll' : 'rolls'}, `
      + 'none of which could realistically have missed.'
  }
  const ahead = luck.misses <= luck.expected
  const named = { good: 'Good luck', bad: 'Bad luck', even: 'Average luck', none: '' }[luck.verdict]
  return `${named}, ${oddsLabel(luck.percentile)} of the way up the range. `
    + `${luck.rolls} accuracy ${luck.rolls === 1 ? 'roll' : 'rolls'}, `
    + `${luck.misses} missed, ${luck.expected.toFixed(1)} expected — missing `
    + `${luck.misses} or ${ahead ? 'fewer' : 'more'} comes up `
    + `${oddsLabel(luck.odds)} of the time.`
}
