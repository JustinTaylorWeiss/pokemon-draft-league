import type { Move, Pokemon, StatKey, TypeChart, TypeName } from '../data/types'
import { DEFENSIVE_ABILITIES, defensiveMultiplier } from './matchup'
import { natureMultiplier, statAtLevel } from './stats'

/**
 * What a move does to a Pokémon, close enough to decide an EV spread on.
 *
 * Written out rather than taken from a library because the answer this feeds
 * is a threshold: "how much Defense turns a 2HKO into a 3HKO" is a question
 * about one point of damage, and a calculation that is a percent off is a
 * calculation that puts the threshold in the wrong place. So the arithmetic
 * follows the games' own — integer division at every step, and the same
 * rounding rule (`pokeRound`, which breaks ties downward) the cartridge uses.
 *
 * What is modelled: level, base stats, EVs, IVs, natures, STAB, type
 * effectiveness including the defensive abilities the type chart already
 * knows, the spread-move reduction in doubles, the sixteen damage rolls, and
 * the handful of items and abilities that change a number by a lot.
 *
 * Items: the ones that change a number outright — the Orbs and Choice items,
 * the type-boosting plates and their cousins, Assault Vest, Eviolite, Light
 * Ball and Choice Scarf. Not the ones that fire on a condition, nor the
 * ones whose effect ends the moment something lands on it (Air Balloon),
 * (Weakness Policy, Booster Energy, the Berries), which are a turn's events
 * rather than a Pokémon's build.
 *
 * What is not: weather, terrain, screens, stat stages, Intimidate, burn,
 * Tera, and every ability that reads the battle rather than the two Pokémon.
 * Those are turn-by-turn facts and this is a team-building tool; a spread
 * chosen against the neutral case is the spread anyone would choose. The UI
 * says so rather than leaving it to be discovered.
 */

/** Rounds half down, which is what the games do everywhere this appears. */
const pokeRound = (n: number) => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n))

/** Items that change how hard a hit lands, and by how much. */
const ITEM_ATTACK: Record<string, { mult: number; category?: 'Physical' | 'Special' }> = {
  'Life Orb': { mult: 1.3 },
  'Choice Band': { mult: 1.5, category: 'Physical' },
  'Choice Specs': { mult: 1.5, category: 'Special' },
  'Muscle Band': { mult: 1.1, category: 'Physical' },
  'Wise Glasses': { mult: 1.1, category: 'Special' },
}

/**
 * Items that lend a fifth to one type. The plates, the elemental items, and
 * the masks Ogerpon wears — all the same 1.2, all read the same way.
 */
const ITEM_TYPE: Record<string, TypeName> = {
  'Black Glasses': 'Dark', 'Dread Plate': 'Dark',
  Charcoal: 'Fire', 'Flame Plate': 'Fire', 'Hearthflame Mask': 'Fire',
  'Silk Scarf': 'Normal',
  'Draco Plate': 'Dragon', 'Pixie Plate': 'Fairy', 'Earth Plate': 'Ground',
  'Insect Plate': 'Bug', 'Zap Plate': 'Electric', 'Fist Plate': 'Fighting',
  'Sky Plate': 'Flying', 'Meadow Plate': 'Grass', 'Spooky Plate': 'Ghost',
  'Toxic Plate': 'Poison', 'Icicle Plate': 'Ice', 'Stone Plate': 'Rock',
  'Iron Plate': 'Steel', 'Splash Plate': 'Water', 'Mind Plate': 'Psychic',
  'Wellspring Mask': 'Water', 'Cornerstone Mask': 'Rock',
}

/** Which type an item lends its fifth to, for anywhere that groups them. */
export const typeBoosted = (item: string): TypeName | undefined => ITEM_TYPE[item]

/** Items that change how hard a hit is taken. */
const ITEM_DEFENSE: Record<string, { stat: StatKey; mult: number }> = {
  'Assault Vest': { stat: 'spd', mult: 1.5 },
}

/**
 * Every ability and item this calculation actually reads.
 *
 * For the picker that hands them out: offering a Pokémon an ability that
 * changes nothing here is offering it a control that does nothing, and the
 * reader cannot tell which is which by looking. Built from the tables
 * themselves so it cannot drift out of step with them.
 *
 * `itemMatters` is per Pokémon, because two of them are: Eviolite does
 * nothing to something fully grown, and a Light Ball is Pikachu's alone.
 */
export const MODELLED_ABILITIES: ReadonlySet<string> = new Set([
  ...DEFENSIVE_ABILITIES,
  'Adaptability', 'Huge Power', 'Pure Power', 'Fur Coat', 'Ice Scales',
  'Multiscale', 'Shadow Shield',
])

const ALWAYS_MATTERS = new Set([
  ...Object.keys(ITEM_ATTACK),
  ...Object.keys(ITEM_TYPE),
  ...Object.keys(ITEM_DEFENSE),
  'Expert Belt', 'Choice Scarf',
])

/**
 * Every item that can be handed out, in one list.
 *
 * Taken from what the calculation reads rather than from the item dex, which
 * only holds what this format's usage sets happen to reference — Expert Belt
 * is a legal, ordinary held item that no set in that sample was wearing, and
 * a picker built off the dex could never offer it. Everything here is a
 * standard item; nothing the regulation bans reads as anything anyway,
 * because the maths has no rule for it.
 */
export const GIVEABLE_ITEMS: readonly string[] = [
  ...ALWAYS_MATTERS, 'Eviolite', 'Light Ball',
].sort((a, b) => a.localeCompare(b))
/*
 * Two of them are conditional and `itemMatters` decides those per Pokemon,
 * along with the four that belong to one species: Ogerpon's three masks were
 * being offered to everything, and a Light Ball is Pikachu's alone.
 */

/** Items only one Pokémon can hold at all. */
const SPECIES_ONLY: Record<string, string> = {
  'Wellspring Mask': 'Ogerpon',
  'Hearthflame Mask': 'Ogerpon',
  'Cornerstone Mask': 'Ogerpon',
  'Light Ball': 'Pikachu',
}

export function itemMatters(item: string, pokemon: Pokemon): boolean {
  const only = SPECIES_ONLY[item]
  if (only) return (pokemon.baseSpecies ?? pokemon.name) === only
  if (item === 'Eviolite') return Boolean(pokemon.evos?.length)
  return ALWAYS_MATTERS.has(item)
}

export interface Side {
  pokemon: Pokemon
  level: number
  /** Only the stats that matter here need filling in; the rest read as 0. */
  evs: Partial<Record<StatKey, number>>
  /** Undefined is neutral, which is the honest default for an unknown spread. */
  nature?: string
  /**
   * Nature as a multiplier per stat, for a caller choosing the plus and the
   * minus directly rather than picking a nature by name. Wins over `nature`,
   * so the two can never be read as disagreeing.
   */
  natureBy?: Partial<Record<StatKey, number>>
  item?: string
  ability?: string
  /**
   * A stat handed over outright, skipping the EVs, the nature and everything
   * else that would have produced it.
   *
   * For asking the question the other way round: not "what does this spread
   * do" but "what would this stat have to be". The answer to that is a
   * number, not a spread, and it does not change when the spread does.
   */
  flat?: Partial<Record<StatKey, number>>
}

/** A stat as it actually is, for one side. Speed included, for the tier list. */
export function statOf(side: Side, stat: StatKey): number {
  const given = side.flat?.[stat]
  if (given != null) return given
  const base = side.pokemon.baseStats[stat]
  const ev = side.evs[stat] ?? 0
  const nature = side.natureBy?.[stat] ?? natureMultiplier(side.nature, stat)
  const raw = statAtLevel(base, ev, nature, stat === 'hp', 31, side.level)
  if (stat === 'hp') return raw

  const ability = side.ability ?? ''
  // Doubling abilities land on the raw stat, before anything else reads it.
  if (stat === 'atk' && (ability === 'Huge Power' || ability === 'Pure Power')) return raw * 2
  if (stat === 'def' && ability === 'Fur Coat') return raw * 2
  if (stat === 'spd' && ability === 'Ice Scales') return raw * 2

  // Pikachu's, and nothing else's: it doubles both attacking stats. Read
  // through `baseSpecies ?? name`, because the plain one has no baseSpecies —
  // it is the base — and checking only that field missed every Pikachu but
  // the costumed ones.
  if (side.item === 'Light Ball' && (side.pokemon.baseSpecies ?? side.pokemon.name) === 'Pikachu'
    && (stat === 'atk' || stat === 'spa')) return raw * 2
  // Only for something that has not finished growing, which is what it is for.
  if (side.item === 'Eviolite' && (stat === 'def' || stat === 'spd')
    && side.pokemon.evos?.length) return Math.floor(raw * 1.5)
  if (side.item === 'Choice Scarf' && stat === 'spe') return Math.floor(raw * 1.5)

  const item = side.item ? ITEM_DEFENSE[side.item] : undefined
  if (item && item.stat === stat) return Math.floor(raw * item.mult)
  return raw
}

export interface Hit {
  /** Every roll, lowest first. Empty when the move cannot damage at all. */
  rolls: number[]
  /** The defender's HP, so a caller can talk in fractions of it. */
  hp: number
  /** Hits to knock out if every roll is the lowest, and if every roll is the highest. */
  worstCase: number
  bestCase: number
}

/** A move that does nothing to this target — immune, or not a damaging move. */
const NO_HIT = (hp: number): Hit => ({ rolls: [], hp, worstCase: Infinity, bestCase: Infinity })

/**
 * How hard `move` lands, thrown by `attacker` at `defender`.
 *
 * `doubles` only matters for the moves that hit more than one Pokémon, which
 * take a quarter off in a format where there is more than one to hit.
 */
export function damage(
  attacker: Side,
  defender: Side,
  move: Move,
  chart: TypeChart,
  doubles: boolean,
): Hit {
  const hp = statOf(defender, 'hp')
  if (move.category === 'Status' || move.basePower <= 0) return NO_HIT(hp)

  const effect = defensiveMultiplier(chart, move.type, defender.pokemon, true)
  if (effect === 0) return NO_HIT(hp)

  const physical = move.category === 'Physical'
  const atk = statOf(attacker, physical ? 'atk' : 'spa')
  const def = statOf(defender, physical ? 'def' : 'spd')

  // The games' own order: three integer divisions, then the modifiers.
  let base = Math.floor(
    Math.floor(Math.floor((2 * attacker.level) / 5 + 2) * move.basePower * atk / def) / 50,
  ) + 2

  // A move that hits everything adjacent is hitting two of them in doubles.
  const spreads = move.target === 'allAdjacentFoes' || move.target === 'allAdjacent'
  if (doubles && spreads) base = pokeRound(base * 0.75)

  const stab = attacker.pokemon.types.includes(move.type)
    ? (attacker.ability === 'Adaptability' ? 2 : 1.5)
    : 1

  const boost = attacker.item ? ITEM_ATTACK[attacker.item] : undefined
  const typed = attacker.item && ITEM_TYPE[attacker.item] === move.type ? 1.2 : 1
  const itemMult = (boost && (!boost.category || boost.category === move.category) ? boost.mult : 1)
    * typed
  // Multiscale reads the defender's HP, and here the defender is always at
  // full: these are first-hit questions. Half damage, and it says so.
  const shield = defender.ability === 'Multiscale' || defender.ability === 'Shadow Shield' ? 0.5 : 1
  const belt = attacker.item === 'Expert Belt' && effect > 1 ? 1.2 : 1
  const after = itemMult * shield * belt

  const rolls: number[] = []
  for (let r = 85; r <= 100; r++) {
    let d = Math.floor((base * r) / 100)
    if (stab !== 1) d = pokeRound(d * stab)
    d = Math.floor(d * effect)
    if (after !== 1) d = pokeRound(d * after)
    rolls.push(Math.max(1, d))
  }

  return {
    rolls,
    hp,
    // Lowest roll every time is the most hits it can take; highest, the fewest.
    worstCase: Math.ceil(hp / rolls[0]),
    bestCase: Math.ceil(hp / rolls[rolls.length - 1]),
  }
}

/**
 * How many hits it takes, stated the way a player would state it.
 *
 * Guaranteed: the attacker needs every roll to be its worst and still get
 * there. That is the number worth building a spread around — "it might OHKO
 * on a high roll" is not a plan, and neither is a wall that only holds if the
 * dice are kind.
 */
export const hitsToKO = (hit: Hit) => hit.worstCase

/**
 * The odds of it happening in `hits` or fewer, over every sequence of rolls.
 *
 * "Guaranteed" is one end of the story and the other end matters as much:
 * ninety-two EVs that turn a guaranteed 2HKO into a guaranteed 3HKO have
 * bought very little if the 2HKO still lands seven times in eight, and have
 * bought the matchup if it never lands at all. The hit count alone cannot
 * tell those apart.
 *
 * Counted rather than sampled. Each hit is one of sixteen equally likely
 * rolls, so the exact answer is a walk over the distribution of damage so
 * far — capped at the HP, since a Pokémon that is down stays down, which is
 * also what keeps it cheap: a few thousand steps rather than sixteen to the
 * power of the hit count.
 *
 * Every hit count up to `upTo` comes out of the one walk, because each is the
 * one before it carried a step further. Asking separately for the chance at
 * one hit, two and three would be three walks over the same ground.
 */
export function koCurve(hit: Hit, upTo: number): number[] {
  const curve: number[] = []
  if (!hit.rolls.length || upTo < 1) return curve
  const each = 1 / hit.rolls.length
  let alive = new Float64Array(hit.hp)
  alive[0] = 1
  let ko = 0

  for (let h = 0; h < upTo; h++) {
    const next = new Float64Array(hit.hp)
    for (let dealt = 0; dealt < hit.hp; dealt++) {
      const reached = alive[dealt]
      if (!reached) continue
      const share = reached * each
      for (const roll of hit.rolls) {
        const total = dealt + roll
        if (total >= hit.hp) ko += share
        else next[total] += share
      }
    }
    alive = next
    curve.push(ko)
  }
  return curve
}

/** One point off the curve, for a caller that only wants the one. */
export const koChance = (hit: Hit, hits: number) => koCurve(hit, hits)[hits - 1] ?? 0
