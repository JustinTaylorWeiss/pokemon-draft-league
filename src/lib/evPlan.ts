import type {
  LearnsetDex, Move, MoveDex, Pokemon, SetDex, StatKey, TypeChart, TypeName,
} from '../data/types'
import { damage, koCurve, statOf, type Field, type Side, type Status } from './damage'
import { natureMultiplier, statAtLevel, RULES, type Rules } from './stats'

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

/*
 * The Gen 9 numbers, still the default everywhere outside this panel.
 * Champions spends a smaller pool of whole points; `RULES` in stats.ts
 * holds both and the panel passes whichever is picked.
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
   * The best guaranteed count this column could ever reach: fewest when
   * landing a hit, most when taking one.
   *
   * The bound of "could this stat do better", answered at 252 EVs and a
   * boosting nature — everything there is to spend on it — with the rest of
   * the spread as it stands. Where `hits` already equals it, the column has
   * nothing more to give against that Pokémon and the row says so.
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
   * best move, 1 for its second, and so on, and -1 for one named by hand.
   *
   * The list is ordered by it, and the column draws a line where it changes.
   * Named moves come first because they were asked for: somebody typed
   * "what if they bring Ice Beam" and the answer should not be four rows
   * down among the ones nobody asked about.
   */
  pass?: number
  /** Named by hand rather than guessed at. Sorted and labelled apart. */
  added?: boolean
  /** Speed rows: the build this Pokémon is reckoned to be running. */
  expected?: boolean
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
 * Labelled in the numbers actually being spent: nothing in the stat, and
 * everything the stat will take — 252 EVs under Gen 9 and 32 SP under
 * Champions. The plus is a boosting nature.
 *
 * "Nothing" is 31 under Gen 9, meaning perfect IVs and no EVs on top, and
 * 0 under Champions, which has no IVs to be perfect. Calling both of them
 * 31 would have put "31" and "32" side by side meaning untrained and
 * fully trained.
 */
const speedTiers = (rules: Rules): { label: string; evs: number; nature: number }[] => {
  const most = RULES[rules].max
  const bare = RULES[rules].ivs ? '31' : '0'
  return [
    { label: bare, evs: 0, nature: 1 },
    { label: `${bare}+`, evs: 0, nature: 1.1 },
    { label: `${most}`, evs: most, nature: 1 },
    { label: `${most}+`, evs: most, nature: 1.1 },
  ]
}

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
  rules: Rules = 'gen9',
): Side {
  return { pokemon, level, evs: s.evs, natureBy: s.nature, item, ability, ivs, rules }
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
 * Three states: `ivs` is perfect IVs and no more, the floor of what it
 * could be; `max` and `max+` are the ceiling. Which one a Pokémon starts
 * on is read off the spread usage says it runs, because one across from
 * you is far likelier to be built the way it is usually built than to have
 * nothing anywhere.
 *
 * One answer per stat, not one per pair. Defense and Special Defense used
 * to move together, and so did Attack and Special Attack, which is wrong
 * about almost every Pokémon that gets built: an Incineroar invests in
 * Attack and not Special Attack, and in HP and Defense and not Special
 * Defense. Asking about the pair meant either crediting it with a spread
 * nobody runs or crediting it with nothing.
 *
 * Nothing stops all four being given a boosting nature, which no single
 * Pokémon could have. The panel says so where it happens rather than
 * refusing the combination, because each calculation only reads one of
 * them and "what if it were +Def" is a fair question to ask of a Pokémon
 * you are also asking "what if it were +SpD" about.
 */
/**
 * The same shape as the spread being chosen on this side, because it is the
 * same thing: EVs in each stat and a nature bending two of them.
 *
 * It was three states per stat — bare, maxed, maxed with a nature — which
 * could not say 96 Defense, and 96 Defense is what half the format runs.
 * Declared here as an alias so every reader of these still calls them what
 * they are: not a spread you are choosing, a spread you are crediting.
 *
 * Nothing holds one to 508. A spread over the budget is not a build, but
 * the question these answer is often "what if it were max in this one",
 * asked of one stat at a time, and refusing the combination would refuse
 * the question. The panel prints the total so an impossible one shows.
 */
export type Assumptions = Spread

/**
 * The spread a Pokémon is most often seen in, where usage has one worth
 * believing.
 *
 * Five of the 604 sets carry 252 in every stat, which is Showdown's
 * placeholder for a Pokémon nobody has run rather than a spread: 1260 EVs
 * is not a build. Anything over the legal 508 is thrown out, and those
 * Pokémon fall back to the bare floor like the ones with no set at all.
 */
export function usualSpread(
  set: { spreads?: { evs?: Partial<Record<StatKey, number>>; nature?: string }[] } | undefined,
): { evs: Partial<Record<StatKey, number>>; nature?: string } | undefined {
  const spread = set?.spreads?.[0]
  if (!spread?.evs) return undefined
  const total = Object.values(spread.evs).reduce((n, v) => n + (v ?? 0), 0)
  if (total > EV_BUDGET) return undefined
  return { evs: spread.evs, nature: spread.nature }
}

/**
 * How usage says it is built, or nothing where usage has nothing.
 *
 * Usage is recorded in EVs, because it comes from Showdown. Under
 * Champions the same spread is the same shares of the same maxima in
 * smaller numbers, so each stat is scaled by the ratio of the two: 252
 * EVs and 32 SP are both everything, and 96 EVs is 12 SP.
 */
export function assumeFrom(
  set: Parameters<typeof usualSpread>[0], rules: Rules = 'gen9',
): Assumptions {
  const built = usualSpread(set)
  const out = emptySpread()
  if (!built) return out
  const scale = RULES[rules].max / EV_MAX
  for (const k of EV_STATS) {
    out.evs[k] = Math.round((built.evs[k] ?? 0) * scale)
    out.nature[k] = k === 'hp' ? 1 : natureMultiplier(built.nature, k)
  }
  return out
}

export interface Opponent {
  id: string
  pokemon: Pokemon
  side: Side
  /** The damaging moves it is known or likely to be carrying. */
  moves: Move[]
  /**
   * Of those, the ones named by hand rather than guessed at from its set
   * and the format. They are asked for, so they are listed apart.
   */
  named: string[]
  /** The Speed investment it is reckoned to run, for marking one of the tiers. */
  speed: { evs: number; nature: number }
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

/**
 * One roll as a share of the HP it is landing on, to a tenth, truncated.
 *
 * In whole numbers rather than by dividing and rounding after, because a
 * tenth is the unit every calculator quotes and floating point would put
 * an exact 36% at 35.9 often enough to notice.
 */
const share = (roll: number, hp: number) => (hp ? Math.floor((roll * 1000) / hp) / 10 : 0)

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
   * Moves to credit one Pokémon with, on top of whatever its set or its
   * movepool already said, keyed by which Pokémon.
   *
   * A set is four moves and a coach picks them; the one that beats you may
   * not be among the four this Pokémon is usually seen with. Named per
   * Pokémon rather than across the team, because "what if this one has Ice
   * Beam" is the question actually being asked — crediting it to everything
   * over there that can learn it answers a wider one nobody wanted.
   */
  extra: Record<string, string[]> = {},
  /** An item, an ability or dropped IVs chosen by hand, over the set's word. */
  gear: Record<string, {
    item?: string; ability?: string; ivs?: Partial<Record<StatKey, number>>
  }> = {},
  /** Which training system the numbers are spent in. */
  rules: Rules = 'gen9',
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
      ? { pokemon, level, rules, evs: { ...evs }, nature: spread.nature, ability: spread.ability }
      : {
        pokemon,
        level,
        rules,
        evs: { [physical ? 'atk' : 'spa']: RULES[rules].max, spe: RULES[rules].max },
        ability: Object.values(pokemon.abilities)[0],
      }

    const worn = gear[id]
    if (worn?.item !== undefined) side.item = worn.item || undefined
    if (worn?.ability !== undefined) side.ability = worn.ability || undefined
    if (worn?.ivs) side.ivs = worn.ivs

    /*
     * Built as asked. Every one of these five stats is set outright, so
     * what the columns read is what the pickers say and nothing behind
     * them — including where the answer is "as its set was", which reads
     * the spread here rather than leaving whatever was on the side.
     */
    const credit = assume[id] ?? assumeFrom(set, rules)
    side.evs = { ...side.evs, ...credit.evs }
    side.natureBy = { ...side.natureBy, ...credit.nature }

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
    const named = (extra[id] ?? [])
      .filter((mv) => own?.[mv])
      .map((mv) => moveDex[mv])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0)
    const byName = new Map(usual.map((m) => [m.name, m]))
    for (const m of named) byName.set(m.name, m)

    return {
      id,
      pokemon,
      side,
      moves: [...byName.values()],
      named: named.map((m) => m.name),
      speed: { evs: credit.evs.spe, nature: credit.nature.spe },
      guessed: !known.length,
    }
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
  /** Which training system the numbers are spent in. Gen 9 unless said. */
  rules?: Rules
  /**
   * What is going on around them, if anything.
   *
   * The screens are named by whose side they are on rather than by whose
   * they are useful against, because that is how a coach says it — and
   * each column picks the one facing the move it is reading.
   */
  field?: PlanField
}

/** Everything around the pair: the sky, the ground, and each side's own. */
export interface PlanField {
  weather?: Field['weather']
  terrain?: Field['terrain']
  mine?: SideField
  theirs?: SideField
}

/** What one side has put up around itself, and what it is carrying. */
export interface SideField {
  reflect?: boolean
  lightScreen?: boolean
  tailwind?: boolean
  helpingHand?: boolean
  crit?: boolean
  /** A flat multiplier on what this side's moves do. 1, or absent, is off. */
  multiplier?: number
  /** What this side is suffering from, which both sides' numbers can read. */
  status?: Status
}

/** The plan: one list of thresholds per stat, in EV order. */
export type Plan = Record<StatKey, Threshold[]>

export function planFor(input: PlanInput): Plan {
  const {
    pokemon, moves, item, ability, ivs, spread, chart, level, doubles,
  } = input
  const rules = input.rules ?? 'gen9'
  const most = RULES[rules].max
  const step = RULES[rules].step
  const around = input.field ?? {}
  /*
   * Reading a hit landing on me, and reading one landing on them.
   *
   * A screen belongs to whoever is behind it and a Helping Hand to
   * whoever is throwing, so each direction takes one from each side.
   */
  const taking: Field = {
    weather: around.weather,
    terrain: around.terrain,
    reflect: around.mine?.reflect,
    lightScreen: around.mine?.lightScreen,
    helpingHand: around.theirs?.helpingHand,
    crit: around.theirs?.crit,
    multiplier: around.theirs?.multiplier,
  }
  const landing: Field = {
    weather: around.weather,
    terrain: around.terrain,
    reflect: around.theirs?.reflect,
    lightScreen: around.theirs?.lightScreen,
    helpingHand: around.mine?.helpingHand,
    crit: around.mine?.crit,
    multiplier: around.mine?.multiplier,
  }
  /*
   * A status belongs to the Pokémon rather than to the turn around it, so
   * it is put on the side rather than passed in the field — and it has to
   * be on both, because a burn reads from the attacker and Marvel Scale
   * from the defender and the same Pokémon is each in turn.
   */
  const ailing = (side: Side, status: Status | undefined): Side =>
    (status ? { ...side, status } : side)
  const myStatus = around.mine?.status
  const theirStatus = around.theirs?.status
  const opponents = theirStatus
    ? input.opponents.map((o) => ({ ...o, side: ailing(o.side, theirStatus) }))
    : input.opponents
  /** Tailwind doubles a side's Speed, which only the Speed column reads. */
  const myWind = around.mine?.tailwind ? 2 : 1
  const theirWind = around.theirs?.tailwind ? 2 : 1
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
    ailing(sideFrom(
      pokemon, level,
      { evs: { ...spread.evs, [stat]: evs }, nature: spread.nature },
      item, ability, ivs, rules,
    ), myStatus)
  /** And me exactly as the sliders have me, for the live odds. */
  const meNow = ailing(sideFrom(pokemon, level, spread, item, ability, ivs, rules), myStatus)
  /**
   * The most one stat can do, everything else as the sliders have it.
   *
   * The bound of "could this column do better than it is doing" — the
   * whole of the stat and a boosting nature on it, all there is to spend.
   * Per stat rather than everything at once, because that is the question
   * each column is asking: a Defense row wants to know what Defense can
   * still buy, not what Defense and HP together could.
   */
  const meMax = (stat: StatKey): Side => ailing(sideFrom(
    pokemon,
    level,
    {
      evs: { ...spread.evs, [stat]: most },
      nature: { ...spread.nature, [stat]: 1.1 },
    },
    item,
    ability,
    ivs,
    rules,
  ), myStatus)


  /**
   * One reading of a pairing, from whoever is throwing to whoever is taking.
   *
   * The same four facts in both directions — the move, the roll range as a
   * share of the defender's HP, the guaranteed hit count and the soonest one
   * with its odds — because it is the same question asked from either end.
   */
  const readMove = (from: Side, to: Side, move: Move): Threshold & { shot: Shot } => {
    const live = damage(from, to, move, chart, doubles, to === meNow ? taking : landing)
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
      /*
       * Truncated to a tenth, in whole numbers, which is what every
       * damage calculator prints — 30.9677% of its HP is quoted as 30.9
       * and not 31. Rounding it put both ends of the range a tenth above
       * the figure anyone would be comparing against.
       */
      shot: {
        low: share(live.rolls[0] ?? 0, live.hp),
        high: share(live.rolls[live.rolls.length - 1] ?? 0, live.hp),
        hits: live.worstCase,
        soonest: live.bestCase,
      },
    }
  }

  for (const o of opponents) {
    /*
     * ---- taking hits: HP, Defense, Special Defense ----
     *
     * Every move they have against me, the same as the attacking columns
     * and for the same reason: with both sides' moves settled the question
     * is flat, and answering it only for their best line answers less than
     * was asked. A Flare Blitz you always survive and a Knock Off you do
     * not are two different facts about the same Incineroar. The one that
     * hurts most is still the row read first, because the list is sorted
     * so it is.
     *
     * Defense reads their physical moves and Special Defense their special
     * ones; HP reads everything, because it is the stat that answers both.
     */
    for (const stat of ['hp', 'def', 'spd'] as const) {
      const category = stat === 'def' ? 'Physical' : stat === 'spd' ? 'Special' : null
      const theirs = category ? o.moves.filter((m) => m.category === category) : o.moves
      for (const move of theirs) {
        // The most hits this stat alone could ever make it take. Where the
        // row already reads that number, the column has nothing left to
        // give against that move and says so.
        const peak = damage(o.side, meMax(stat), move, chart, doubles, taking).worstCase
        const row = readMove(o.side, meNow, move)
        out[stat].push({
          ...row,
          target: o.id,
          targetName: o.pokemon.name,
          added: o.named.includes(move.name),
          shot: { ...row.shot, peak },
        })
      }
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
        // The fewest hits this stat alone could ever guarantee, which is
        // what the row goes green for.
        const peak = damage(meMax(stat), o.side, move, chart, doubles, landing).worstCase
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
    let firstMissed: { label: string; speed: number; expected?: boolean } | null = null
    const catchable: {
      label: string; speed: number; need: number; tie?: number; expected?: boolean
    }[] = []
    // Through `statOf`, not the bare formula: a Choice Scarf is half again
    // on Speed and the tiers were reading straight past it, so an opponent
    // given one was outrun on paper and not in the game.
    const scarfed = o.side.item === 'Choice Scarf' ? [o.side.item] : []
    /*
     * Whichever tier its credited Speed lands on is the one it is
     * reckoned to be. That row is marked and sorted first; the rest stay,
     * because "what if it is faster than that" is the question the column
     * exists to answer, and what it is credited with is an opinion.
     */
    // Exact, because the four tiers are the four investments anyone picks
    // and a spread sitting between two of them is not either of them.
    const sameTier = (t: { evs: number; nature: number }) =>
      o.speed.evs === t.evs && o.speed.nature === t.nature
    // A tailwind doubles a side's Speed, so the number to beat and the
    // number you are beating it with are each read behind their own.
    const mySpeed = (ev: number) => statOf(meAt('spe', ev), 'spe') * myWind
    for (const tier of speedTiers(rules)) {
      const theirs = statOf(
        { ...o.side, evs: { ...o.side.evs, spe: tier.evs }, natureBy: { spe: tier.nature } },
        'spe',
      ) * theirWind
      let need: number | null = null
      for (let ev = 0; ev <= most; ev += step) {
        if (mySpeed(ev) > theirs) { need = ev; break }
      }
      // Only the cheapest one out of reach is worth saying. The ones above it
      // are out of reach for the same reason and add nothing.
      if (need == null) {
        firstMissed ??= { label: tier.label, speed: theirs, expected: sameTier(tier) }
        continue
      }
      let tie: number | undefined
      for (let ev = 0; ev <= most; ev += step) {
        if (mySpeed(ev) === theirs) { tie = ev; break }
      }
      catchable.push({
        label: tier.label, speed: theirs, need, tie, expected: sameTier(tier),
      })
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
        // Named for the highest it covers, and marked if any of the tiers
        // it swallowed was the one this Pokemon is reckoned to run.
        tier: top.label,
        expected: catchable.slice(i, last + 1).some((t) => t.expected),
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
        expected: firstMissed.expected,
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
        // Named moves are not one of the sweeps; they sit above all of
        // them and do not push the guessed ones down a place.
        let n = 0
        for (const r of rows) {
          const at = r.added ? -1 : n++
          pass.set(r, at)
          r.pass = at
        }
      }
      out[stat].sort((a, b) => (pass.get(a) ?? 0) - (pass.get(b) ?? 0)
        || nearest(a, b)
        || a.targetName.localeCompare(b.targetName))
      continue
    }
    out[stat].sort((a, b) => Number(b.expected ?? false) - Number(a.expected ?? false)
      || a.evs - b.evs
      || (b.chance ?? 0) - (a.chance ?? 0)
      || a.targetName.localeCompare(b.targetName))
  }
  return out
}

/** The stat as the panel should print it, for the readout under each slider. */
export function statOfSpread(
  pokemon: Pokemon, level: number, s: Spread, stat: StatKey,
  ivs?: Partial<Record<StatKey, number>>, rules: Rules = 'gen9',
): number {
  return statAtLevel(
    pokemon.baseStats[stat], s.evs[stat], s.nature[stat], stat === 'hp',
    ivs?.[stat] ?? IV_MAX, level, rules,
  )
}
