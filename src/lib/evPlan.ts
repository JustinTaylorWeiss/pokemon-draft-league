import type {
  LearnsetDex, Move, MoveDex, Pokemon, SetDex, StatKey, TypeChart, TypeName,
} from '../data/types'
import { damage, koCurve, statOf, type Side } from './damage'
import { statAtLevel } from './stats'

/**
 * What each EV is actually buying, against the team on the other side.
 *
 * EVs are spent in the dark. Sixty of them is a real decision and a spread
 * sheet cannot tell you whether it changes anything, because what it changes
 * is not a number on your Pokémon — it is a number on theirs: the hit you now
 * survive, the one you now score, the Pokémon you now move before. This works
 * those out, one list per stat, from the two teams already on screen.
 *
 * Every threshold is the least you can spend to reach it, rounded up to the
 * four EVs that actually do something.
 */

/** EVs come in fours; a fifth does nothing until the fourth after it. */
export const EV_STEP = 4
export const EV_MAX = 252
export const EV_BUDGET = 508

export const EV_STATS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

/**
 * An offensive row's live reading: what this move is doing to that Pokémon
 * right now, with the sliders where they are.
 *
 * The defensive and Speed columns are lists of thresholds — outcomes you can
 * buy, priced. The two attacking columns are not, any more: the four moves
 * are chosen, so there is one pairing per Pokémon over there and the useful
 * thing to show is what it does and how that moves as you spend, rather than
 * a threshold per move per hit count.
 */
export interface Shot {
  /** Percent of the target's HP: the worst roll, and the best. */
  low: number
  high: number
  /** Hits to knock out on the worst roll — the guaranteed count. */
  hits: number
  /** And on the best, which is the one `chance` gives the odds of. */
  soonest: number
  /**
   * Attacking rows: the fewest hits any spread at all could guarantee.
   *
   * The bound of "could I do better", answered over every EV and every
   * nature rather than over what is left in the budget. Where the guaranteed
   * count already equals it, this stat has nothing more to give against that
   * Pokémon and the row says so.
   */
  peak?: number
}

export interface Threshold {
  /** The least EVs in this stat that buy it, given everything else as it is. */
  evs: number
  /** The Pokémon on the other side this is about. */
  target: string
  targetName: string
  /** The move, for every column but Speed. */
  move?: string
  moveName?: string
  /** And its type, which is how its name is coloured. */
  moveType?: TypeName
  /** Hits to knock out, before and after. Speed rows leave these out. */
  from?: number
  to?: number
  /** Speed rows: the number to beat. */
  outspeed?: number
  /** Speed rows: which investment of theirs this number belongs to. */
  tier?: string
  /** Speed rows no amount of EVs reaches. One per Pokémon, listed apart. */
  unreachable?: boolean
  /**
   * What the stat has to reach, whatever it costs to get there.
   *
   * The requirement, not a reading of the current spread: a row that another
   * stat has already paid for still needs the same number, and a stat already
   * past it still needed it. It does not move when the sliders do.
   */
  statAt?: number
  /**
   * How likely the outcome is as things stand — not at the threshold, now.
   *
   * The hit count is the guaranteed one, and on its own it is half the
   * story: ninety-two EVs that turn a guaranteed 2HKO into a guaranteed
   * 3HKO have bought very little if the 2HKO still lands seven times in
   * eight, and have bought the matchup if it never lands at all.
   *
   * Moves with the slider, so the number falls as you defend and rises as
   * you invest. `at` is the hit count it refers to: the one being escaped on
   * a defensive row, the one being reached on an attacking one.
   */
  chance?: number
  at?: number
  /** The items and abilities this row's number depends on, if any. */
  via?: string[]
  /**
   * Speed rows: the least EVs that match their number exactly.
   *
   * A tie is its own outcome and neither of the other two. It is not a win —
   * the turn order is a coin flip — and it is not nothing, because it is
   * usually four EVs short of a win and worth knowing you are standing on it.
   */
  tieAt?: number
  /** Attack and Special Attack rows: what it is doing to them as things stand. */
  shot?: Shot
  /**
   * Which sweep of the other side this row belongs to: 0 for each Pokémon's
   * best move, 1 for its second, and so on.
   *
   * The list is ordered by it, and the column draws a line where it changes.
   */
  pass?: number
}

/**
 * The four speeds a Pokémon is actually seen at.
 *
 * A usage set gives one spread and the Pokémon in front of you may not be
 * running it — Speed is the stat people change. So rather than one number
 * per opponent, each is read at the four investments anyone actually picks,
 * and the column says what it costs to get past each of them. Outrunning the
 * uninvested version of something is a real and much cheaper win, and a
 * single row hid that it was on offer.
 */
/*
 * Labelled the way the pills under each sprite are, because they say the
 * same thing: 31 is perfect IVs and nothing else, 252 is everything in the
 * stat, and the plus is a boosting nature on top. "max EVs + nature" was
 * three words for what the rest of the panel says in four characters.
 */
const SPEED_TIERS: { label: string; evs: number; nature: number }[] = [
  { label: '31', evs: 0, nature: 1 },
  { label: '31+', evs: 0, nature: 1.1 },
  { label: '252', evs: EV_MAX, nature: 1 },
  { label: '252+', evs: EV_MAX, nature: 1.1 },
]

export interface Spread {
  evs: Record<StatKey, number>
  /** Per stat: 1.1, 1, or 0.9. Held per stat rather than as a nature name so
   *  the plus and the minus can be chosen where they are being read. */
  nature: Record<StatKey, number>
}

export const emptySpread = (): Spread => ({
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  nature: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
})

export const spent = (s: Spread) => EV_STATS.reduce((n, k) => n + s.evs[k], 0)

/**
 * This panel's Pokémon as a combatant.
 *
 * The reader picks a plus and a minus stat here rather than a nature by name,
 * so the multipliers go on the side directly. `damage` prefers them over a
 * name, which means the two can never be read as disagreeing.
 */
export function sideFrom(
  pokemon: Pokemon, level: number, s: Spread,
  item?: string, ability?: string, ivs?: Partial<Record<StatKey, number>>,
): Side {
  return { pokemon, level, evs: s.evs, natureBy: s.nature, item, ability, ivs }
}

/** A Pokémon's IVs where any of them has been dropped below 31. */
export const IV_MAX = 31
export const lowered = (ivs?: Partial<Record<StatKey, number>>): [StatKey, number][] =>
  EV_STATS.filter((k) => (ivs?.[k] ?? IV_MAX) < IV_MAX).map((k) => [k, ivs?.[k] ?? IV_MAX])

/**
 * What to credit the other side with, where you do not want to take their
 * usage set's word for it.
 *
 * A set is one spread off a ladder and the Pokémon across from you is
 * whatever its coach built. Asking "does this hold up against a max-invested
 * version" is the question a spread is actually chosen to answer, and the
 * set cannot be asked it.
 *
 * Three states, and the first of them is `ivs`: perfect IVs and nothing
 * else, no EVs and no nature. Not the set's spread — a set is a guess, and
 * a guess at the bottom of a scale of guesses is the one place it does not
 * belong. From there, everything, and everything with the nature on it.
 *
 * `max+` puts the boosting nature on whichever stat is being tested, both
 * defences or both attacks. No real Pokémon has both, and no real Pokémon
 * needs to: each calculation only reads one of them, and the assumption is
 * about that one.
 */
export type Assume = 'ivs' | 'max' | 'max+'
export interface Assumptions {
  /** HP takes no nature, so it has no `max+`. */
  hp: 'ivs' | 'max'
  bulk: Assume
  power: Assume
}

export const ASSUME_BARE: Assumptions = { hp: 'ivs', bulk: 'ivs', power: 'ivs' }

export interface Opponent {
  id: string
  pokemon: Pokemon
  side: Side
  /** The damaging moves it is known or likely to be carrying. */
  moves: Move[]
  /** True when there was no usage set and the movepool stood in for one. */
  guessed: boolean
}

/** Below this a move is not the thing anyone is building a spread against. */
const THREAT_POWER = 60
/**
 * How many distinct threats to credit a Pokémon with.
 *
 * More than the four slots it has, because the four it has are not known.
 * A usage set is one build and the Pokémon across from you is whatever its
 * coach made; a spread chosen against only the set's moves is chosen against
 * a guess dressed as a fact. Six is the point where the list stops being
 * things it plausibly runs.
 */
const THREAT_MOVES = 6
/**
 * Hits beyond this are not a decision anyone makes. Turning a 2HKO into a
 * 3HKO is the whole game; turning an 11HKO into a 12HKO is a line of noise
 * between the reader and the two that matter.
 */
const MEANINGFUL_HITS = 4
/**
 * Moves a Pokémon can learn but does not threaten with on the turn it is in
 * front of you. Only used when guessing — a usage set that really runs Sky
 * Attack is telling the truth and is left alone.
 */
const NOT_A_THREAT = /cannot move next turn|charges|first turn|turn 1/i

/**
 * What a Pokémon with no usage set is likely to be hitting with.
 *
 * Most of this league's board has no set at all — Megas do not appear in the
 * formats the usage comes from — and a Pokémon that threatens nothing makes
 * the defensive columns empty for exactly the Pokémon they are most needed
 * for. So its movepool stands in: the hardest thing it can throw of each
 * type, best four, its own types counted at the extra half they are worth.
 *
 * One per type, because four Fire moves is one threat listed four times.
 */
function likelyMoves(
  pokemon: Pokemon,
  learnset: Record<string, unknown> | undefined,
  moveDex: MoveDex,
  played: string[] | null,
): Move[] {
  if (!learnset) return []
  /*
   * Weighted three ways: by the stat that throws it, so a physical attacker
   * is not credited with the special move that happens to have the bigger
   * number; by same-type, which is the half again it is worth; and by how
   * often the move is actually clicked.
   *
   * That last one is the difference between a plausible set and a technically
   * correct one. Garchomp can learn Double-Edge, and on raw damage it wins
   * the Normal slot — but it sits 84th of 121 in usage where Stone Edge sits
   * 15th, and nobody has ever run it. The weight runs from 2 at the top of
   * the list to 1 at the bottom, which is enough to settle a near-tie and not
   * enough to hand every Pokémon the same four moves.
   */
  const rank = new Map((played ?? []).map((id, i) => [id, i]))
  const popularity = (id: string) => {
    const at = rank.get(id)
    return at == null ? 1 : 2 - at / Math.max(1, (played?.length ?? 1) - 1)
  }
  const score = (m: Move, id: string) =>
    m.basePower
    * (pokemon.types.includes(m.type) ? 1.5 : 1)
    * pokemon.baseStats[m.category === 'Physical' ? 'atk' : 'spa']
    * popularity(id)

  const pick = (ids: string[]) => {
    const best = new Map<string, { move: Move; score: number }>()
    for (const id of ids) {
      const move = moveDex[id]
      if (!move || move.category === 'Status' || move.basePower < THREAT_POWER) continue
      if (NOT_A_THREAT.test(move.shortDesc)) continue
      const key = `${move.category}:${move.type}`
      const held = best.get(key)
      const now = score(move, id)
      if (!held || now > held.score) best.set(key, { move, score: now })
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, THREAT_MOVES)
      .map((x) => x.move)
  }

  const learnable = Object.keys(learnset)
  /*
   * From the moves the format actually plays, where it can learn any of
   * them. The movepool alone answers "what is the biggest number it could
   * throw", which is how Garchomp comes out threatening with Double-Edge —
   * a move it can learn and nobody has ever clicked. Narrowed to what people
   * run first, the same scoring picks Earthquake.
   *
   * The whole pool is still the fallback: a Pokémon whose movepool and the
   * played list do not overlap is rare, and an empty column would be worse
   * than an unlikely one.
   */
  if (played?.length) {
    const inPlay = new Set(played)
    const chosen = pick(learnable.filter((id) => inPlay.has(id)))
    if (chosen.length) return chosen
  }
  return pick(learnable)
}

/** How many moves a set holds. Four, everywhere, forever. */
export const SET_SIZE = 4

/**
 * The four this Pokémon is usually seen throwing.
 *
 * Its most-used set first, in the order that set lists them, and then topped
 * up from what the format plays that it can learn. Two reasons for the
 * topping up: a set is four moves and some of them are Protect and Tailwind,
 * so the damaging half can be one or two; and a few hundred Pokémon have no
 * usage set at all, for whom the played list is the only thing there is.
 *
 * Damaging only. These four exist to fill the Attack and Special Attack
 * columns, and a status move puts nothing in either.
 */
export function usualMoves(
  pokemon: Pokemon,
  set: { moves: string[] } | undefined,
  learnset: Record<string, unknown> | undefined,
  moveDex: MoveDex,
  played: string[] | null,
  limit = SET_SIZE,
): Move[] {
  const out: Move[] = []
  const seen = new Set<string>()
  const take = (m: Move | undefined) => {
    if (!m || seen.has(m.name) || out.length >= limit) return
    if (m.category === 'Status' || m.basePower <= 0) return
    seen.add(m.name)
    out.push(m)
  }
  for (const id of set?.moves ?? []) take(moveDex[id])
  for (const m of likelyMoves(pokemon, learnset, moveDex, played)) take(m)
  return out
}

/**
 * The other team, each member dressed in the set it is most often seen in.
 *
 * A set gives the spread, the item, the ability and the four moves, which is
 * everything a calculation needs and all of it a guess — but a guess off
 * ladder usage beats the two alternatives, which are assuming nothing (and
 * calculating against a Pokémon nobody runs) or assuming the worst (and
 * building a spread against a set that does not exist).
 *
 * Without a set it is read at full investment in whichever attacking stat it
 * is better at, and its movepool stands in for the four moves — the version
 * of it worth surviving.
 */
export function opponentsFrom(
  members: { id: string; pokemon: Pokemon }[],
  sets: SetDex | null,
  moveDex: MoveDex,
  learnsets: LearnsetDex | null,
  played: string[] | null,
  level: number,
  /** Per Pokémon, because they are not all built the same way. */
  assume: Record<string, Assumptions> = {},
  /**
   * Moves to credit every opponent that can learn one with, on top of
   * whatever its set or its movepool already said.
   *
   * A set is four moves and a coach picks them; the one that beats you may
   * not be among the four this Pokémon is usually seen with. Naming it adds
   * it wherever it is legal, which is the question "what if they bring
   * Ice Beam" asked of the whole team at once.
   */
  extra: string[] = [],
  /** An item, an ability or dropped IVs chosen by hand, over the set's word. */
  gear: Record<string, {
    item?: string; ability?: string; ivs?: Partial<Record<StatKey, number>>
  }> = {},
): Opponent[] {
  return members.map(({ id, pokemon }) => {
    const set = sets?.[id]
    const spread = set?.spreads?.[0]
    const evs: Partial<Record<StatKey, number>> = spread?.evs ?? {}
    const physical = pokemon.baseStats.atk >= pokemon.baseStats.spa

    // No item unless one is given by hand, the same as the Pokémon the
    // spread is being built for: a Choice Band is half again on every
    // physical row and a set's word is not enough to apply it unasked.
    const side: Side = spread
      ? { pokemon, level, evs: { ...evs }, nature: spread.nature, ability: spread.ability }
      : {
        pokemon,
        level,
        evs: { [physical ? 'atk' : 'spa']: EV_MAX, spe: EV_MAX },
        ability: Object.values(pokemon.abilities)[0],
      }

    const worn = gear[id]
    if (worn?.item !== undefined) side.item = worn.item || undefined
    if (worn?.ability !== undefined) side.ability = worn.ability || undefined
    if (worn?.ivs) side.ivs = worn.ivs

    /*
     * Built as asked, not as its set was. Every one of these five stats is
     * set outright — the bare state zeroes the EVs and levels the nature
     * rather than leaving the set's numbers in place, so what the columns
     * read is what the pickers say and nothing behind them.
     */
    const credit = assume[id] ?? ASSUME_BARE
    side.evs = { ...side.evs, hp: credit.hp === 'max' ? EV_MAX : 0 }
    for (const [choice, stats] of [
      [credit.bulk, ['def', 'spd']],
      [credit.power, ['atk', 'spa']],
    ] as [Assume, StatKey[]][]) {
      const evs = choice === 'ivs' ? 0 : EV_MAX
      const nature = choice === 'max+' ? 1.1 : 1
      side.evs = { ...side.evs, ...Object.fromEntries(stats.map((k) => [k, evs])) }
      side.natureBy = { ...side.natureBy, ...Object.fromEntries(stats.map((k) => [k, nature])) }
    }

    const known = (set?.moves ?? [])
      .map((m) => moveDex[m])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0)

    /*
     * Its set, and the rest of what the format plays that it can learn.
     *
     * The set alone was too thin to build against: Indeedee's carries one
     * damaging move and Hawlucha's two, so a Pokémon with a set threatened
     * less than one without, which had its whole movepool to guess from. The
     * played list is the same standing-in either way; the set's moves simply
     * win where both name the same type and category.
     */
    const byKey = new Map<string, Move>()
    for (const m of likelyMoves(pokemon, learnsets?.[id], moveDex, played)) {
      byKey.set(`${m.category}:${m.type}`, m)
    }
    for (const m of known) byKey.set(`${m.category}:${m.type}`, m)
    const usual = [...byKey.values()]

    const own = learnsets?.[id]
    const named = extra
      .filter((mv) => own?.[mv])
      .map((mv) => moveDex[mv])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0)
    const byName = new Map(usual.map((m) => [m.name, m]))
    for (const m of named) byName.set(m.name, m)

    return { id, pokemon, side, moves: [...byName.values()], guessed: !known.length }
  })
}

interface PlanInput {
  /** The Pokémon whose EVs are being chosen. */
  pokemon: Pokemon
  /** Its own moves, for the two attacking columns. */
  moves: Move[]
  item?: string
  ability?: string
  /** Any of its own dropped below 31. */
  ivs?: Partial<Record<StatKey, number>>
  spread: Spread
  opponents: Opponent[]
  chart: TypeChart
  level: number
  doubles: boolean
}

/** The plan: one list of thresholds per stat, in EV order. */
export type Plan = Record<StatKey, Threshold[]>

export function planFor(input: PlanInput): Plan {
  const { pokemon, moves, item, ability, ivs, spread, opponents, chart, level, doubles } = input
  const out: Plan = { hp: [], atk: [], def: [], spa: [], spd: [], spe: [] }

  /**
   * The least this stat can be and still do it — the other half of the price.
   *
   * Searched over the stat rather than over EVs, because that is the question
   * being asked: "Defense 64" is true of every spread that gets there and
   * stays true when the spread changes, where "44 EVs" is only true of this
   * one. Binary, since a hit count only moves one way as a stat rises.
   */

  /** Me, with one stat moved to the value being tried and the rest as they are. */
  const meAt = (stat: StatKey, evs: number): Side =>
    sideFrom(
      pokemon, level,
      { evs: { ...spread.evs, [stat]: evs }, nature: spread.nature },
      item, ability, ivs,
    )
  /** And me exactly as the sliders have me, for the live odds. */
  const meNow = sideFrom(pokemon, level, spread, item, ability, ivs)
  /**
   * The best this Pokémon could ever be built into: everything everywhere,
   * every nature boosting.
   *
   * Not a legal spread and it does not need to be. It is the bound of the
   * question "could any spread do better than this", which is the one thing
   * an attacking row goes green for.
   */
  const bound = (evs: number, nature: number) => sideFrom(
    pokemon,
    level,
    {
      evs: Object.fromEntries(EV_STATS.map((k) => [k, evs])) as Record<StatKey, number>,
      nature: Object.fromEntries(EV_STATS.map((k) => [k, nature])) as Record<StatKey, number>,
    },
    item,
    ability,
    ivs,
  )
  const bestMe = bound(EV_MAX, 1.1)


  /**
   * One reading of a pairing, from whoever is throwing to whoever is taking.
   *
   * The same four facts in both directions — the move, the roll range as a
   * share of the defender's HP, the guaranteed hit count and the soonest one
   * with its odds — because it is the same question asked from either end.
   */
  const readMove = (from: Side, to: Side, move: Move): Threshold & { shot: Shot } => {
    const live = damage(from, to, move, chart, doubles)
    const curve = koCurve(live, MEANINGFUL_HITS)
    return {
      // No price. Both halves of the panel used to carry one — "this many
      // EVs buys that hit count" — and neither shows it now: see ShotRow.
      evs: 0,
      target: '',
      targetName: '',
      move: move.name,
      moveName: move.name,
      moveType: move.type,
      at: live.bestCase,
      chance: curve[live.bestCase - 1] ?? 0,
      via: live.via,
      shot: {
        low: live.hp ? ((live.rolls[0] ?? 0) / live.hp) * 100 : 0,
        high: live.hp ? ((live.rolls[live.rolls.length - 1] ?? 0) / live.hp) * 100 : 0,
        hits: live.worstCase,
        soonest: live.bestCase,
      },
    }
  }

  /**
   * The worst of several, for the columns that show one row per Pokémon.
   *
   * Which move they would actually click: soonest to the knockout, and the
   * bigger number where two are equally soon.
   */
  const worstOf = (from: Side, to: Side, candidates: Move[]) => {
    let best: (Threshold & { shot: Shot }) | null = null
    for (const move of candidates) {
      const row = readMove(from, to, move)
      if (!best
        || row.shot.soonest < best.shot.soonest
        || (row.shot.soonest === best.shot.soonest && row.shot.high > best.shot.high)) {
        best = row
      }
    }
    return best
  }

  for (const o of opponents) {
    /*
     * ---- taking hits: HP, Defense, Special Defense ----
     *
     * One row per Pokémon over there, the same as the attacking columns and
     * for the same reason: with both sides' moves settled, the question is
     * flat. What is the worst thing this one can throw at me, what does it
     * do, and how does that move as I spend.
     *
     * Defense reads their physical moves and Special Defense their special
     * ones; HP reads everything, because it is the stat that answers both
     * and the row worth seeing there is whichever hurts most.
     */
    for (const stat of ['hp', 'def', 'spd'] as const) {
      const category = stat === 'def' ? 'Physical' : stat === 'spd' ? 'Special' : null
      const theirs = category ? o.moves.filter((m) => m.category === category) : o.moves
      const row = worstOf(o.side, meNow, theirs)
      if (!row) continue
      out[stat].push({ ...row, target: o.id, targetName: o.pokemon.name })
    }

    /*
     * ---- landing them: Attack, Special Attack ----
     *
     * One row per Pokémon over there, not one per move per hit count.
     *
     * The four moves are chosen now, so the question has flattened: not
     * "which of everything it could learn threatens this one" but "what does
     * my set do to each of them, and how does that move as I spend". So each
     * row is a live reading — the roll range and the odds of the knockout —
     * with the next breakpoint priced beside it, which is the one threshold
     * still worth naming.
     *
     * The move shown is the one it would actually click: fewest hits to the
     * knockout, and the bigger number where two need the same count.
     */
    /*
     * Every move in the set against every Pokémon over there, not the best
     * one against each.
     *
     * The four are chosen by hand, so all four are moves this Pokémon is
     * carrying and every one of them is a click someone might make. Which
     * is strongest against a given target is the thing the numbers are
     * there to answer, and answering it in advance by showing only the
     * winner hides what the other three would have done.
     */
    for (const stat of ['atk', 'spa'] as const) {
      const category = stat === 'atk' ? 'Physical' : 'Special'
      for (const move of moves.filter((m) => m.category === category)) {
        // Everything everywhere, every nature boosting. Not a legal spread
        // and it does not need to be: it is the bound of "could any spread
        // do better than this", which is what the row goes green for.
        const peak = damage(bestMe, o.side, move, chart, doubles).worstCase
        const row = readMove(meNow, o.side, move)
        out[stat].push({
          ...row,
          target: o.id,
          targetName: o.pokemon.name,
          shot: { ...row.shot, peak },
        })
      }
    }

    // ---- getting there first, at each speed they might be built to ----
    let firstMissed: { label: string; speed: number } | null = null
    const catchable: { label: string; speed: number; need: number; tie?: number }[] = []
    // Through `statOf`, not the bare formula: a Choice Scarf is half again
    // on Speed and the tiers were reading straight past it, so an opponent
    // given one was outrun on paper and not in the game.
    const scarfed = o.side.item === 'Choice Scarf' ? [o.side.item] : []
    for (const tier of SPEED_TIERS) {
      const theirs = statOf(
        { ...o.side, evs: { ...o.side.evs, spe: tier.evs }, natureBy: { spe: tier.nature } },
        'spe',
      )
      let need: number | null = null
      for (let ev = 0; ev <= EV_MAX; ev += EV_STEP) {
        if (statOf(meAt('spe', ev), 'spe') > theirs) { need = ev; break }
      }
      // Only the cheapest one out of reach is worth saying. The ones above it
      // are out of reach for the same reason and add nothing.
      if (need == null) { firstMissed ??= { label: tier.label, speed: theirs }; continue }
      let tie: number | undefined
      for (let ev = 0; ev <= EV_MAX; ev += EV_STEP) {
        if (statOf(meAt('spe', ev), 'spe') === theirs) { tie = ev; break }
      }
      catchable.push({ label: tier.label, speed: theirs, need, tie })
    }

    /*
     * Tiers that cost the same are one row, named for the highest of them.
     *
     * Four rows all reading "0 EVs" is four ways of saying the same thing —
     * and for anything slow enough, all four tiers cost nothing, which filled
     * the column with Pokémon there was no decision to make about. One row
     * named for the highest tier it covers says all of it: 252+ means you
     * are past it however it was built, which is the same claim "any
     * spread" made and in the notation the rest of the panel uses.
     */
    for (let i = 0; i < catchable.length; i++) {
      const cost = catchable[i].need
      let last = i
      while (last + 1 < catchable.length && catchable[last + 1].need === cost) last++
      const top = catchable[last]
      out.spe.push({
        evs: cost,
        target: o.id,
        targetName: o.pokemon.name,
        outspeed: top.speed,
        tier: top.label,
        statAt: top.speed + 1,
        tieAt: top.tie,
        via: scarfed,
      })
      i = last
    }

    // Named even when it cannot be done: "this one cannot be caught" answers
    // the same question, and leaving it out looks like it was forgotten.
    if (firstMissed) {
      out.spe.push({
        evs: Infinity, target: o.id, targetName: o.pokemon.name,
        outspeed: firstMissed.speed, tier: firstMissed.label, unreachable: true,
        via: scarfed,
      })
    }
  }

  for (const stat of EV_STATS) {
    /*
     * Cheapest first, and among equals the one still most likely to happen.
     *
     * Two rows at 44 EVs are not the same row: one where the hit still lands
     * nine times in ten is the reason to spend them, and one where it lands
     * once in twenty is nearly bought already. The odds break the tie in the
     * direction of what still needs attention, and the name breaks that.
     *
     * Infinity sorts last on its own, which puts the out-of-reach rows after
     * everything buyable without a second rule.
     */
    /*
     * Readings sort in passes: the best move against each Pokémon, then the
     * second best against each, and so on down.
     *
     * Not by Pokémon. The attacking columns carry a row per move, and four
     * rows about one Pokémon stacked together make the column a set of
     * blocks to be compared across — where the question being asked is
     * "what is my best answer to each of them", which is the first pass
     * read straight down. The rows you would click are the top six.
     *
     * Within a pass, by how near the knockout is: theirs going down the
     * attacking columns, mine going down the defensive ones, where every
     * Pokémon has one row and there is only ever one pass.
     *
     * Speed is still a list of purchases and sorts by what each costs.
     */
    if (stat !== 'spe') {
      const nearest = (a: Threshold, b: Threshold) =>
        (a.shot?.soonest ?? Infinity) - (b.shot?.soonest ?? Infinity)
        || (a.shot?.hits ?? Infinity) - (b.shot?.hits ?? Infinity)
        || (b.shot?.high ?? 0) - (a.shot?.high ?? 0)
        || (a.moveName ?? '').localeCompare(b.moveName ?? '')
      const pass = new Map<Threshold, number>()
      const byTarget = new Map<string, Threshold[]>()
      for (const r of out[stat]) {
        const held = byTarget.get(r.target)
        if (held) held.push(r)
        else byTarget.set(r.target, [r])
      }
      for (const rows of byTarget.values()) {
        rows.sort(nearest)
        rows.forEach((r, i) => { pass.set(r, i); r.pass = i })
      }
      out[stat].sort((a, b) => (pass.get(a) ?? 0) - (pass.get(b) ?? 0)
        || nearest(a, b)
        || a.targetName.localeCompare(b.targetName))
      continue
    }
    out[stat].sort((a, b) => a.evs - b.evs
      || (b.chance ?? 0) - (a.chance ?? 0)
      || a.targetName.localeCompare(b.targetName))
  }
  return out
}

/** The stat as the panel should print it, for the readout under each slider. */
export function statOfSpread(
  pokemon: Pokemon, level: number, s: Spread, stat: StatKey,
  ivs?: Partial<Record<StatKey, number>>,
): number {
  return statAtLevel(
    pokemon.baseStats[stat], s.evs[stat], s.nature[stat], stat === 'hp',
    ivs?.[stat] ?? IV_MAX, level,
  )
}
