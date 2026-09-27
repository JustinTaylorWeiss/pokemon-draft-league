import type { LearnsetDex, Move, MoveDex, Pokemon, SetDex, StatKey, TypeChart } from '../data/types'
import { damage, statOf, type Side } from './damage'
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

export interface Threshold {
  /** The least EVs in this stat that buy it, given everything else as it is. */
  evs: number
  /** The Pokémon on the other side this is about. */
  target: string
  targetName: string
  /** The move, for every column but Speed. */
  move?: string
  moveName?: string
  /** Hits to knock out, before and after. Speed rows leave these out. */
  from?: number
  to?: number
  /** Speed rows: the number to beat. */
  outspeed?: number
  /** Speed rows: which investment of theirs this number belongs to. */
  tier?: string
  /** Speed rows no amount of EVs reaches. One per Pokémon, listed apart. */
  unreachable?: boolean
  /** What the stat reads at that many EVs — the number, not the price. */
  statAt?: number
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
const SPEED_TIERS: { label: string; evs: number; nature: number }[] = [
  { label: 'IVs only', evs: 0, nature: 1 },
  { label: 'nature', evs: 0, nature: 1.1 },
  { label: 'max EVs', evs: EV_MAX, nature: 1 },
  { label: 'max EVs + nature', evs: EV_MAX, nature: 1.1 },
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
  pokemon: Pokemon, level: number, s: Spread, item?: string, ability?: string,
): Side {
  return { pokemon, level, evs: s.evs, natureBy: s.nature, item, ability }
}

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
/** As many moves as a Pokémon has slots, which is as many as it can threaten with. */
const THREAT_MOVES = 4
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
): Opponent[] {
  return members.map(({ id, pokemon }) => {
    const set = sets?.[id]
    const spread = set?.spreads?.[0]
    const evs: Partial<Record<StatKey, number>> = spread?.evs ?? {}
    const physical = pokemon.baseStats.atk >= pokemon.baseStats.spa

    const side: Side = spread
      ? { pokemon, level, evs, nature: spread.nature, item: spread.item, ability: spread.ability }
      : {
        pokemon,
        level,
        evs: { [physical ? 'atk' : 'spa']: EV_MAX, spe: EV_MAX },
        ability: Object.values(pokemon.abilities)[0],
      }

    const known = (set?.moves ?? [])
      .map((m) => moveDex[m])
      .filter((m): m is Move => Boolean(m) && m.category !== 'Status' && m.basePower > 0)
    const moves = known.length ? known : likelyMoves(pokemon, learnsets?.[id], moveDex, played)

    return { id, pokemon, side, moves, guessed: !known.length }
  })
}

interface PlanInput {
  /** The Pokémon whose EVs are being chosen. */
  pokemon: Pokemon
  /** Its own moves, for the two attacking columns. */
  moves: Move[]
  item?: string
  ability?: string
  spread: Spread
  opponents: Opponent[]
  chart: TypeChart
  level: number
  doubles: boolean
}

/**
 * Every threshold in one stat, given the rest of the spread as it stands.
 *
 * Scanned rather than solved. The damage formula floors at four separate
 * points and the stat formula at two more, so the relationship between an EV
 * and a hit is a staircase with no closed form — and there are only 64 steps
 * to try, which is nothing.
 *
 * The scan reports every step it finds, not just the first: a stat can cross
 * from a 2HKO to a 3HKO and on to a 4HKO inside the range, and both are worth
 * knowing before deciding where to stop.
 */
function scan(stat: StatKey, at: (evs: number) => number): { evs: number; from: number; to: number }[] {
  const base = at(0)
  if (!Number.isFinite(base)) return []
  const found: { evs: number; from: number; to: number }[] = []
  const better = stat === 'atk' || stat === 'spa'
    ? (a: number, b: number) => a < b
    : (a: number, b: number) => a > b

  const worthSaying = stat === 'atk' || stat === 'spa'
    ? (step: { to: number }) => step.to <= MEANINGFUL_HITS
    : (step: { from: number }) => step.from <= MEANINGFUL_HITS

  let last = base
  for (let ev = EV_STEP; ev <= EV_MAX; ev += EV_STEP) {
    const now = at(ev)
    if (Number.isFinite(now) && better(now, last)) {
      const step = { evs: ev, from: last, to: now }
      if (worthSaying(step)) found.push(step)
      last = now
    }
  }
  return found
}

/** The plan: one list of thresholds per stat, in EV order. */
export type Plan = Record<StatKey, Threshold[]>

export function planFor(input: PlanInput): Plan {
  const { pokemon, moves, item, ability, spread, opponents, chart, level, doubles } = input
  const out: Plan = { hp: [], atk: [], def: [], spa: [], spd: [], spe: [] }

  /** What the stat itself reads there, which is the other half of the price. */
  const reads = (stat: StatKey, evs: number) =>
    statAtLevel(pokemon.baseStats[stat], evs, spread.nature[stat], stat === 'hp', 31, level)

  /** Me, with one stat moved to the value being tried and the rest as they are. */
  const meAt = (stat: StatKey, evs: number): Side =>
    sideFrom(pokemon, level, { evs: { ...spread.evs, [stat]: evs }, nature: spread.nature }, item, ability)

  for (const o of opponents) {
    // ---- taking hits: HP, Defense, Special Defense ----
    for (const move of o.moves) {
      const stats: StatKey[] = move.category === 'Physical' ? ['hp', 'def'] : ['hp', 'spd']
      for (const stat of stats) {
        for (const step of scan(stat, (evs) => damage(o.side, meAt(stat, evs), move, chart, doubles).worstCase)) {
          out[stat].push({
            ...step, target: o.id, targetName: o.pokemon.name,
            move: move.name, moveName: move.name, statAt: reads(stat, step.evs),
          })
        }
      }
    }

    // ---- landing them: Attack, Special Attack ----
    for (const move of moves) {
      const stat: StatKey = move.category === 'Physical' ? 'atk' : 'spa'
      for (const step of scan(stat, (evs) => damage(meAt(stat, evs), o.side, move, chart, doubles).worstCase)) {
        out[stat].push({
          ...step, target: o.id, targetName: o.pokemon.name,
          move: move.name, moveName: move.name, statAt: reads(stat, step.evs),
        })
      }
    }

    // ---- getting there first, at each speed they might be built to ----
    const base = o.pokemon.baseStats.spe
    let firstMissed: { label: string; speed: number } | null = null
    const priced: { label: string; speed: number; need: number }[] = []
    for (const tier of SPEED_TIERS) {
      const theirs = statAtLevel(base, tier.evs, tier.nature, false, 31, level)
      let need: number | null = null
      for (let ev = 0; ev <= EV_MAX; ev += EV_STEP) {
        if (statOf(meAt('spe', ev), 'spe') > theirs) { need = ev; break }
      }
      // Only the cheapest one out of reach is worth saying. The ones above it
      // are out of reach for the same reason and add nothing.
      if (need == null) { firstMissed ??= { label: tier.label, speed: theirs }; continue }
      priced.push({ label: tier.label, speed: theirs, need })
    }

    /*
     * Tiers that cost the same are one row, named for the highest of them.
     *
     * Four rows all reading "0 EVs" is four ways of saying the same thing —
     * and for anything slow enough, all four tiers cost nothing, which filled
     * the column with Pokémon there was no decision to make about. One row
     * saying it is beaten at any spread says all of it.
     */
    const all = priced.length === SPEED_TIERS.length
    for (let i = 0; i < priced.length; i++) {
      const cost = priced[i].need
      let last = i
      while (last + 1 < priced.length && priced[last + 1].need === cost) last++
      const top = priced[last]
      out.spe.push({
        evs: cost,
        target: o.id,
        targetName: o.pokemon.name,
        outspeed: top.speed,
        tier: all && i === 0 && last === priced.length - 1 ? 'any spread' : top.label,
        statAt: reads('spe', cost),
      })
      i = last
    }

    // Named even when it cannot be done: "this one cannot be caught" answers
    // the same question, and leaving it out looks like it was forgotten.
    if (firstMissed) {
      out.spe.push({
        evs: Infinity, target: o.id, targetName: o.pokemon.name,
        outspeed: firstMissed.speed, tier: firstMissed.label, unreachable: true,
      })
    }
  }

  for (const stat of EV_STATS) {
    // Infinity sorts last on its own, which puts the out-of-reach rows after
    // everything buyable without a second rule.
    out[stat].sort((a, b) => a.evs - b.evs || a.targetName.localeCompare(b.targetName))
  }
  return out
}

/** The stat as the panel should print it, for the readout under each slider. */
export function statOfSpread(pokemon: Pokemon, level: number, s: Spread, stat: StatKey): number {
  return statAtLevel(pokemon.baseStats[stat], s.evs[stat], s.nature[stat], stat === 'hp', 31, level)
}
