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
 * reading a set has in mind, and only moves that can miss by that number are
 * counted at all. A Fake Out does miss occasionally — a sandstorm over a Sand
 * Veil, a Bright Powder, something halfway through a Fly — but the listed
 * number says it cannot, so against the listed number there is no comparison
 * to draw. Rating those the unluckiest Pokémon in the league, which is where
 * counting them lands, says more about the model than about the season.
 *
 * Where the field makes a 90% move worse than 90% it does land here as bad
 * luck, because from the listed number that is exactly what it looks like.
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
  /** Rolls counted — only those on a move that can miss by its listed accuracy. */
  rolls: number
  misses: number
  /** Misses the listed accuracies say to expect over those rolls. */
  expected: number
  /**
   * The chance of a run this good or this bad: the probability of missing at
   * most this many when ahead of expectation, and at least this many when
   * behind. Never the probability of exactly this many, which is small for
   * everything and so says nothing.
   */
  odds: number
  verdict: Verdict
}

/**
 * How unlikely a run has to be before it gets called lucky or unlucky:
 * less than one time in five.
 *
 * Judged on the odds rather than on how far off expectation it landed,
 * because a whole miss means different things at different volumes. Two
 * misses where one was expected sounds damning and happens a quarter of the
 * time; five fewer than expected over two hundred rolls sounds like nothing
 * and is a genuinely charmed season.
 */
const UNUSUAL = 0.2

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
    // A move the list says cannot miss is left out whole — rolls, misses and
    // all. See the note at the top: it has no odds to be measured against.
    if (miss <= 0) continue
    rolls += shot.rolls
    misses += shot.misses
    expected += shot.rolls * miss
    for (let n = 0; n < shot.rolls; n += 1) {
      const next = new Array<number>(spread.length + 1).fill(0)
      for (let k = 0; k < spread.length; k += 1) {
        next[k] += spread[k] * (1 - miss)
        next[k + 1] += spread[k] * miss
      }
      spread = next
    }
  }

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
    : odds > UNUSUAL ? 'even'
      : misses < expected ? 'good'
        : misses > expected ? 'bad'
          : 'even'

  return { rolls, misses, expected, odds, verdict }
}

/** `56%`, and `<1%` rather than `0%` for something the listed odds call impossible. */
export function oddsLabel(odds: number): string {
  if (odds >= 0.995) return '>99%'
  if (odds < 0.005) return '<1%'
  return `${Math.round(odds * 100)}%`
}

/** The whole story in a sentence, for the tooltip behind the one-word verdict. */
export function luckNote(luck: Luck): string {
  if (!luck.rolls) return 'Nothing here could miss by its listed accuracy.'
  const ahead = luck.misses <= luck.expected
  return `${luck.rolls} ${luck.rolls === 1 ? 'roll' : 'rolls'} on moves that can miss, `
    + `${luck.misses} missed, ${luck.expected.toFixed(1)} expected. `
    + `Missing ${luck.misses} or ${ahead ? 'fewer' : 'more'} comes up `
    + `${oddsLabel(luck.odds)} of the time.`
}
