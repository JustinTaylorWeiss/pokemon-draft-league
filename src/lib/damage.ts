import type { Move, Pokemon, StatKey, TypeChart, TypeName } from '../data/types'
import { DEFENSIVE_ABILITIES, VARIABLE_POWER, defensiveMultiplier } from './matchup'
import { natureMultiplier, statAtLevel, type Rules } from './stats'

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
 * effectiveness including the defensive abilities the type chart knows, the
 * spread-move reduction in doubles, the sixteen damage rolls, stat stages, a
 * burn, a critical hit, screens and Helping Hand, the weather and the
 * terrain — both the stat they lend and the moves that exist because of
 * them — and every ability and item in the two menus.
 *
 * Items: the ones that change a number outright. The Orbs and Choice items,
 * all eighteen type boosters and the plates beside them, Assault Vest,
 * Eviolite, Light Ball, Choice Scarf, an Air Balloon's Ground immunity, a
 * Booster Energy switching the paradox pair on, a Float Stone's halved
 * weight, and the seventeen berries that take half off one kind of hit.
 *
 * What is not: Tera. Intimidate, which is a stage the reader can set
 * itself rather than something to apply unasked. And the items whose whole
 * effect is what happens after the damage — Leftovers, a Focus Sash, a
 * Rocky Helmet, a Sitrus Berry — which are a turn's events rather than a
 * Pokémon's build, and would answer a different question than the one this
 * page asks. The UI says all of that rather than leaving it to be found.
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
  // The plates, one to a type.
  'Dread Plate': 'Dark', 'Flame Plate': 'Fire', 'Draco Plate': 'Dragon',
  'Pixie Plate': 'Fairy', 'Earth Plate': 'Ground', 'Insect Plate': 'Bug',
  'Zap Plate': 'Electric', 'Fist Plate': 'Fighting', 'Sky Plate': 'Flying',
  'Meadow Plate': 'Grass', 'Spooky Plate': 'Ghost', 'Toxic Plate': 'Poison',
  'Icicle Plate': 'Ice', 'Stone Plate': 'Rock', 'Iron Plate': 'Steel',
  'Splash Plate': 'Water', 'Mind Plate': 'Psychic',
  /*
   * And the older items that do the same thing, which are what the sets in
   * this format actually hold — a Spell Tag on Aegislash, a Mystic Water on
   * Basculegion. Three of the eighteen were here and the plates beside them
   * covered the gap for nothing, since nobody in the league holds a plate.
   */
  'Black Glasses': 'Dark', Charcoal: 'Fire', 'Silk Scarf': 'Normal',
  'Dragon Fang': 'Dragon', 'Fairy Feather': 'Fairy', 'Soft Sand': 'Ground',
  'Silver Powder': 'Bug', Magnet: 'Electric', 'Black Belt': 'Fighting',
  'Sharp Beak': 'Flying', 'Miracle Seed': 'Grass', 'Spell Tag': 'Ghost',
  'Poison Barb': 'Poison', 'Never-Melt Ice': 'Ice', 'Hard Stone': 'Rock',
  'Metal Coat': 'Steel', 'Mystic Water': 'Water', 'Twisted Spoon': 'Psychic',
  // Ogerpon's, which are the same fifth again.
  'Hearthflame Mask': 'Fire', 'Wellspring Mask': 'Water', 'Cornerstone Mask': 'Rock',
}

/**
 * The berries that take half off one super-effective hit.
 *
 * Only ever against a move the holder is weak to, and only the once — which
 * this cannot know, so it reads as the first hit of a sequence, which is the
 * one anybody is asking about.
 */
const RESIST_BERRY: Record<string, TypeName> = {
  'Occa Berry': 'Fire', 'Passho Berry': 'Water', 'Wacan Berry': 'Electric',
  'Rindo Berry': 'Grass', 'Yache Berry': 'Ice', 'Chople Berry': 'Fighting',
  'Kebia Berry': 'Poison', 'Shuca Berry': 'Ground', 'Coba Berry': 'Flying',
  'Payapa Berry': 'Psychic', 'Tanga Berry': 'Bug', 'Charti Berry': 'Rock',
  'Kasib Berry': 'Ghost', 'Haban Berry': 'Dragon', 'Colbur Berry': 'Dark',
  'Babiri Berry': 'Steel', 'Roseli Berry': 'Fairy',
  // The one that answers a Normal move, and only from full health.
  'Chilan Berry': 'Normal',
}

/** Which type an item lends its fifth to, for anywhere that groups them. */
export const typeBoosted = (item: string): TypeName | undefined => ITEM_TYPE[item]

/**
 * How much an item is worth, beside its name in a list.
 *
 * The number and nothing else. "Muscle Band" and "Choice Band" are a tenth
 * and a half apart and nothing about the two names says which; what each one
 * applies to is the name's job, and for a type booster the group it is
 * listed under has already said it.
 */
const ITEM_EFFECT: Record<string, string> = {
  'Life Orb': '×1.3',
  'Choice Band': '×1.5',
  'Choice Specs': '×1.5',
  'Muscle Band': '×1.1',
  'Wise Glasses': '×1.1',
  'Expert Belt': '×1.2',
  'Assault Vest': '×1.5',
  Eviolite: '×1.5',
  'Light Ball': '×2',
  'Choice Scarf': '×1.5',
}

export const itemEffect = (item: string): string =>
  (ITEM_TYPE[item] ? '×1.2' : RESIST_BERRY[item] ? '×0.5 once' : ITEM_EFFECT[item] ?? '')

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
/**
 * Abilities that lend an offensive stat half again, or a third, for moves
 * of one type. Fire Mane is Mega Pyroar's and the reason it is a Mega.
 */
const TYPE_POWER: Record<string, { type: TypeName; mult: number }> = {
  'Fire Mane': { type: 'Fire', mult: 1.5 },
  "Dragon's Maw": { type: 'Dragon', mult: 1.5 },
  'Rocky Payload': { type: 'Rock', mult: 1.5 },
  Steelworker: { type: 'Steel', mult: 1.5 },
  Transistor: { type: 'Electric', mult: 1.3 },
}

/**
 * The -ate abilities: a Normal move becomes another type and gains a
 * fifth. Both halves matter, and the type more — a Pixilate Return off
 * Mega Gardevoir is Fairy, which is what it is for.
 */
const ATE: Record<string, TypeName> = {
  Aerilate: 'Flying',
  Pixilate: 'Fairy',
  Refrigerate: 'Ice',
  Galvanize: 'Electric',
  Dragonize: 'Dragon',
}

/**
 * Abilities that lend to a kind of move rather than to a type. Each reads
 * one flag the build now records, and nothing else does.
 */
const MOVE_POWER: Record<string, { flag: keyof Move; mult: number }> = {
  'Iron Fist': { flag: 'punch', mult: 1.2 },
  'Strong Jaw': { flag: 'bite', mult: 1.5 },
  'Mega Launcher': { flag: 'pulse', mult: 1.5 },
  Sharpness: { flag: 'slicing', mult: 1.5 },
}

/**
 * The four Ruin abilities, each taking a quarter off one stat of every
 * Pokémon that does not share it — so they read across the pair, which
 * is what makes them something this can model at all.
 */
const RUIN: Record<string, StatKey> = {
  'Sword of Ruin': 'def',
  'Beads of Ruin': 'spd',
  'Tablets of Ruin': 'atk',
  'Vessel of Ruin': 'spa',
}

export const MODELLED_ABILITIES: ReadonlySet<string> = new Set([
  ...DEFENSIVE_ABILITIES,
  ...Object.keys(TYPE_POWER),
  ...Object.keys(MOVE_POWER),
  ...Object.keys(ATE),
  ...Object.keys(RUIN),
  'Adaptability', 'Huge Power', 'Pure Power', 'Fur Coat', 'Ice Scales',
  'Multiscale', 'Shadow Shield', 'Tough Claws', 'Technician',
  'Normalize', 'Liquid Voice', 'Neuroforce', 'Tinted Lens', 'Aura Guard',
  'Punk Rock', 'Soundproof', 'Bulletproof', 'Reckless', 'Parental Bond', 'Gorilla Tactics',
  'Hustle', 'Protean', 'Mold Breaker',
  /*
   * These four were read by the arithmetic and missing from this list, so
   * the picker would not hand them out and the panel called them no
   * effect — a Guts Conkeldurr with a Flame Orb read as an ordinary one.
   */
  'Guts', 'Toxic Boost', 'Flare Boost', 'Marvel Scale',
  'Sheer Force', 'Infiltrator', 'Shell Armor', 'Battle Armor',
  'Light Metal', 'Heavy Metal',
  // Switched on by the sky or the ground rather than by anything either
  // Pokemon did, which is why they only read once a field is set.
  'Protosynthesis', 'Quark Drive', 'Solar Power', 'Sand Force',
  'Orichalcum Pulse', 'Hadron Engine', 'Flower Gift',
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
  ...ALWAYS_MATTERS, ...Object.keys(RESIST_BERRY),
  'Eviolite', 'Light Ball', 'Air Balloon', 'Booster Energy', 'Float Stone',
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
  /** What it is suffering from, where that changes a number here. */
  status?: Status
  /** Stat stages, −6 to +6, as a Swords Dance or an Intimidate leaves them. */
  boosts?: Partial<Record<StatKey, number>>
  /**
   * A stat handed over outright, skipping the EVs, the nature and everything
   * else that would have produced it.
   *
   * For asking the question the other way round: not "what does this spread
   * do" but "what would this stat have to be". The answer to that is a
   * number, not a spread, and it does not change when the spread does.
   */
  flat?: Partial<Record<StatKey, number>>
  /**
   * IVs, where any of them is not the 31 everything is assumed to have.
   *
   * Worth having for the two that are deliberately dropped: a zero in
   * Attack takes a third off what Foul Play and confusion do, and a zero in
   * Speed is how anything gets under a Trick Room. Both change a number
   * here, so both belong in the arithmetic rather than in a footnote.
   */
  ivs?: Partial<Record<StatKey, number>>
  /** Which training system its numbers are spent in. Gen 9 unless said. */
  rules?: Rules
}

/** A stat as it actually is, for one side. Speed included, for the tier list. */
export function statOf(side: Side, stat: StatKey): number {
  const given = side.flat?.[stat]
  if (given != null) return given
  const base = side.pokemon.baseStats[stat]
  const ev = side.evs[stat] ?? 0
  const nature = side.natureBy?.[stat] ?? natureMultiplier(side.nature, stat)
  const raw = statAtLevel(
    base, ev, nature, stat === 'hp', side.ivs?.[stat] ?? 31, side.level, side.rules,
  )
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
  /**
   * The items and abilities that changed this number, named as they were
   * applied.
   *
   * Collected here rather than worked out again by whoever displays it: the
   * rules for when a Choice Band counts and when a plate does are in this
   * function, and a second copy of them elsewhere is a second copy that can
   * be wrong. A row saying "3HKO" is a different row when a Life Orb is the
   * reason.
   */
  via: string[]
  /** The defender's HP, so a caller can talk in fractions of it. */
  hp: number
  /** Hits to knock out if every roll is the lowest, and if every roll is the highest. */
  worstCase: number
  bestCase: number
}

/**
 * What is going on around the two of them.
 *
 * Left out of this calculation for a long time on the grounds that a
 * spread is chosen against the neutral case — which is true of the spread
 * and false of the turn it is chosen for. Half this format is played
 * under a terrain somebody set on purpose, and a Reflect changes every
 * physical row on the page by a third.
 *
 * `reflect` and `lightScreen` are the defender's, because a screen only
 * ever matters to the side behind it; `helpingHand` is the attacker's,
 * for the same reason the other way round.
 */
export interface Field {
  weather?: 'Sun' | 'Rain' | 'Sand' | 'Snow'
  terrain?: 'Electric' | 'Grassy' | 'Psychic' | 'Misty'
  reflect?: boolean
  lightScreen?: boolean
  helpingHand?: boolean
  /** The attacker's, like the Helping Hand. */
  crit?: boolean
  /** Both screens at once, and the defender's like them. */
  auroraVeil?: boolean
  /** An ally's, taking a quarter off what the defender takes. Doubles only. */
  friendGuard?: boolean
  /** The attacker's, doubling one Electric move. */
  charge?: boolean
  /** Nobody's item does anything. */
  magicRoom?: boolean
  /** Defense and Special Defense trade places, for both Pokémon. */
  wonderRoom?: boolean
}

/** What a stat stage multiplies by, as the fraction the games divide with. */
export function stageOf(stage: number): { num: number; den: number } {
  const n = Math.max(-6, Math.min(6, Math.trunc(stage)))
  return n >= 0 ? { num: 2 + n, den: 2 } : { num: 2, den: 2 - n }
}

/**
 * What a Pokémon is suffering from, as far as damage is concerned.
 *
 * Badly poisoned is not here: everything below treats it exactly as
 * poisoned, and the difference — the climbing chip each turn — is about
 * what happens between hits, which nothing on this page reads. A control
 * that changed no number is worse than no control.
 */
export type Status = 'Burn' | 'Poison' | 'Paralysis' | 'Sleep' | 'Freeze'

/**
 * Moves whose power the data cannot state, because it is a question about
 * the two Pokémon rather than a number.
 *
 * Showdown ships these as base power 0 and computes them in the battle, so
 * everything here that reads `basePower` saw a 0 and treated them as not
 * damaging: the move pickers would not offer Grass Knot, and the engine
 * would have given it no rolls if they had.
 *
 * Only the ones this page can actually work out are listed. A weight or a
 * Speed it knows; a held item, a party, a stockpile or a damage roll that
 * has not happened yet it does not, so Fling, Beat Up, Spit Up and the
 * counter-attacks stay out and stay unofferable rather than reading zero.
 *
 * The HP-dependent ones are here because this page has an answer for them:
 * every reading is a first hit with both sides whole, which is the same
 * assumption Multiscale is applied under a few lines below. At full HP
 * Reversal is 20 and Hard Press is 100, and they do not drift because
 * nothing here advances a turn.
 */
function weightPower(kg: number): number {
  if (kg >= 200) return 120
  if (kg >= 100) return 100
  if (kg >= 50) return 80
  if (kg >= 25) return 60
  if (kg >= 10) return 40
  return 20
}

function ratioPower(heavy: number, light: number): number {
  if (heavy >= light * 5) return 120
  if (heavy >= light * 4) return 100
  if (heavy >= light * 3) return 80
  if (heavy >= light * 2) return 60
  return 40
}

/**
 * What the move is worth against this defender, where the data says 0.
 *
 * Returns the move's own base power for everything else, so it can stand
 * in for `move.basePower` everywhere without a condition at the call site.
 */
/**
 * Whether the ground reaches it, which is what every terrain asks first.
 *
 * Flying types and Levitate float, and so does an Air Balloon. An Iron
 * Ball drags any of them back down, which is most of the reason anybody
 * holds one.
 */
const grounded = (side: Side) => {
  if (side.item === 'Iron Ball') return true
  if (side.item === 'Air Balloon') return false
  return !side.pokemon.types.includes('Flying') && side.ability !== 'Levitate'
}

/** The type each weather lends Weather Ball, which takes the sky's own. */
const SKYBALL: Record<string, TypeName> = {
  Sun: 'Fire',
  Rain: 'Water',
  Sand: 'Rock',
  Snow: 'Ice',
}

/** The three weathers the sun is not, which is what Solar Beam minds. */
const OVERCAST = new Set(['Rain', 'Sand', 'Snow'])

/** The type each terrain lends Terrain Pulse, which takes the ground's own. */
const PULSE: Record<string, TypeName> = {
  Electric: 'Electric',
  Grassy: 'Grass',
  Psychic: 'Psychic',
  Misty: 'Fairy',
}

/**
 * What a move that takes its type from its surroundings actually is.
 *
 * Terrain Pulse takes the ground's, and needs to be standing on it.
 * Weather Ball takes the sky's, and the sky reaches everybody.
 */
export function thrownType(move: Move, attacker: Side, field: Field): TypeName {
  if (move.name === 'Terrain Pulse') {
    return (grounded(attacker) && PULSE[field.terrain ?? '']) || move.type
  }
  if (move.name === 'Weather Ball') return SKYBALL[field.weather ?? ''] ?? move.type
  return move.type
}

/**
 * What it weighs, which two abilities and one item argue about.
 *
 * Only four moves ask, and for those four it is the whole answer: a Light
 * Metal Metagross is 275kg rather than 550 and a Grass Knot into it drops
 * a bracket.
 */
const weightOf = (side: Side) => {
  const raw = side.pokemon.weightkg
  if (side.ability === 'Light Metal') return raw / 2
  if (side.ability === 'Heavy Metal') return raw * 2
  if (side.item === 'Float Stone') return raw / 2
  return raw
}

/**
 * Whether the paradox machinery is running.
 *
 * Protosynthesis wants its sun and Quark Drive wants its current, and
 * neither cares who put it there.
 */
const paradoxOn = (side: Side, field: Field) => {
  if (side.ability !== 'Protosynthesis' && side.ability !== 'Quark Drive') return false
  // A Booster Energy is the point of the item: it does the sun's job, or
  // the current's, anywhere at all. Eleven of this format's sets hold one.
  if (side.item === 'Booster Energy') return true
  return side.ability === 'Protosynthesis'
    ? field.weather === 'Sun' : field.terrain === 'Electric'
}

/**
 * The stat it is proudest of, which is the one those two lift.
 *
 * Read off the spread rather than the species, because that is what the
 * games read: the best stat after its investment and its nature, not the
 * best base stat. Speed is in the running and takes a half rather than a
 * third, but Speed is not a number this page multiplies anything by, so
 * what matters here is only whether Speed won — in which case nothing
 * else did.
 */
function bestStat(side: Side): StatKey | null {
  const keys: StatKey[] = ['atk', 'def', 'spa', 'spd', 'spe']
  let best: StatKey | null = null
  let top = -1
  for (const key of keys) {
    const value = statOf(side, key)
    if (value > top) { top = value; best = key }
  }
  return best
}

export function basePowerOf(
  move: Move,
  attacker: Side,
  defender: Side,
  field: Field = {},
): number {
  switch (move.name) {
    case 'Grass Knot':
    case 'Low Kick':
      return weightPower(weightOf(defender))
    case 'Heavy Slam':
    case 'Heat Crash':
      return ratioPower(weightOf(attacker), weightOf(defender))
    /*
     * Both read the two Speeds, and both have to cope with a zero: a
     * Pokémon cannot have 0 Speed in a real battle, but a caller handing
     * over a flat stat can say anything, and the games' own answer to
     * the division is the floor either way.
     */
    case 'Gyro Ball': {
      const mine = statOf(attacker, 'spe')
      if (mine <= 0) return 1
      return Math.min(150, Math.floor((25 * statOf(defender, 'spe')) / mine) + 1)
    }
    case 'Electro Ball': {
      const theirs = statOf(defender, 'spe')
      if (theirs <= 0) return 150
      const ratio = statOf(attacker, 'spe') / theirs
      if (ratio >= 4) return 150
      if (ratio >= 3) return 120
      if (ratio >= 2) return 80
      if (ratio >= 1) return 60
      return 40
    }
    // Both sides whole, which is what every reading here assumes.
    case 'Flail':
    case 'Reversal':
      return 20
    case 'Hard Press':
      return 100
    case 'Crush Grip':
      return 120

    /*
     * The five a terrain is worth more to than the third it lends every
     * move of its own type, and the one that needs a terrain at all.
     *
     * Rising Voltage asks about the target rather than the user: the
     * question is whether the thing being hit is standing in the current.
     * The rest ask about the user, and Steel Roller has nothing to roll
     * over on bare ground.
     */
    case 'Rising Voltage':
      return field.terrain === 'Electric' && grounded(defender) ? 140 : 70
    case 'Expanding Force':
      return field.terrain === 'Psychic' && grounded(attacker) ? 120 : 80
    case 'Psyblade':
      return field.terrain === 'Electric' && grounded(attacker) ? 120 : 80
    case 'Misty Explosion':
      return field.terrain === 'Misty' && grounded(attacker) ? 150 : 100
    case 'Terrain Pulse':
      return field.terrain && grounded(attacker) ? 100 : 50
    case 'Steel Roller':
      return field.terrain ? 130 : 0

    /*
     * And the moves the sky decides.
     *
     * Solar Beam is drawing on sunlight it has not got, and is halved by
     * any weather that is not sun — clear skies are fine. Weather Ball
     * doubles and takes the sky's own type, which is most of what it is
     * worth: a Water one in rain is same-type off a Politoed and hits a
     * Fire type for four times as much.
     */
    case 'Solar Beam':
    case 'Solar Blade':
      return OVERCAST.has(field.weather ?? '')
        ? pokeRound(move.basePower / 2) : move.basePower
    case 'Weather Ball':
      return field.weather ? 100 : 50

    default:
      return move.basePower
  }
}

/** Whether a move does damage this page can put a number on. */
export const canReadPower = (move: Move) =>
  move.category !== 'Status' && (move.basePower > 0 || VARIABLE_POWER.has(move.name))

/** Doubles against a target that is suffering, by which kinds count. */
const STATUS_POWER: Record<string, 'any' | 'poison'> = {
  Hex: 'any',
  'Infernal Parade': 'any',
  Venoshock: 'poison',
  'Barb Barrage': 'poison',
}

/** Facade reads its own user's, and only these three of them. */
const FACADE_STATUS = new Set<Status>(['Burn', 'Poison', 'Paralysis'])

/** What each weather does to a move of one type. */
const WEATHER: Record<string, Partial<Record<TypeName, number>>> = {
  Sun: { Fire: 1.5, Water: 0.5 },
  Rain: { Water: 1.5, Fire: 0.5 },
}

/** The type each terrain lends a third to, for a Pokémon standing in it. */
const TERRAIN: Record<string, TypeName> = {
  Electric: 'Electric',
  Grassy: 'Grass',
  Psychic: 'Psychic',
}

/** The three Ground moves Grassy Terrain smothers. */
const SMOTHERED = new Set(['Earthquake', 'Bulldoze', 'Magnitude'])

/** A move that does nothing to this target — immune, or not a damaging move. */
const NO_HIT = (hp: number, via: string[] = []): Hit =>
  ({ rolls: [], hp, via, worstCase: Infinity, bestCase: Infinity })

/**
 * The numbers alone, with nothing said about why they are what they are.
 *
 * Split out so `damage` can ask it the same question with one thing taken
 * away, which is how it works out what to credit.
 */
function core(
  attackerIn: Side,
  defenderIn: Side,
  move: Move,
  chart: TypeChart,
  doubles: boolean,
  field: Field = {},
): { rolls: number[]; hp: number } {
  /*
   * Magic Room takes every item off the field, so it is done here rather
   * than at each of the six places an item is read — including the three
   * inside `statOf`, which this function never sees the inside of.
   */
  const attacker = field.magicRoom ? { ...attackerIn, item: undefined } : attackerIn
  const defender = field.magicRoom ? { ...defenderIn, item: undefined } : defenderIn

  const hp = statOf(defender, 'hp')
  // Worked out rather than read, for the ten whose power is a question
  // about the pairing. It gives back `move.basePower` for everything else.
  const stated = basePowerOf(move, attacker, defender, field)
  if (move.category === 'Status' || stated <= 0) return { rolls: [], hp }

  const mine = attacker.ability ?? ''

  /*
   * Mold Breaker reads the defender as though it had no ability at all —
   * which is the whole of what it does, and cheap to say here because
   * everything below already takes the defender's ability from one place.
   */
  const shielded = mine === 'Mold Breaker' ? { ...defender, ability: '' } : defender
  const guard = shielded.ability ?? ''

  /*
   * The type the move actually lands as.
   *
   * Normalize turns everything Normal, the -ate abilities turn Normal into
   * something else, and Liquid Voice turns a sound move into Water. All
   * three change what the type chart says as well as what it hits for,
   * and the chart is read below.
   */
  // The two that take their type from what is around them, read before
  // anything else looks at the type — which for both is the larger half
  // of what the weather or the ground is worth to them.
  const thrown = thrownType(move, attacker, field)
  const kind: TypeName = mine === 'Normalize' ? 'Normal'
    : mine === 'Liquid Voice' && move.sound ? 'Water'
      : thrown === 'Normal' && ATE[mine] ? ATE[mine]
        : thrown
  const ated = mine === 'Normalize' || (move.type === 'Normal' && ATE[mine]) ? 1.2 : 1

  /*
   * The one it has, and only that one — an empty string where it has none.
   *
   * Every ability the species could have is the right reading for a draft
   * chart, where "this could be Levitate" is what a coach needs before
   * picking, and the wrong one here, where the Pokémon in front of you has
   * exactly one and it is known. Reading all of them made a Rotom-Heat
   * immune to Ground on the strength of a Levitate it is not running.
   *
   * Empty rather than absent so that taking an ability away means taking it
   * away. Passing nothing would fall back to the whole list, which is how
   * the credit below would conclude that Levitate changed nothing.
   */
  const effect = defensiveMultiplier(chart, kind, shielded.pokemon, true, guard)
  if (effect === 0) return { rolls: [], hp }
  // An Air Balloon is a Ground immunity until something pops it, and
  // nothing here has popped it.
  if (shielded.item === 'Air Balloon' && kind === 'Ground') return { rolls: [], hp }
  // Nothing at all gets through a Soundproof to a sound move, or a
  // Bulletproof to anything thrown.
  if (guard === 'Soundproof' && move.sound) return { rolls: [], hp }
  if (guard === 'Bulletproof' && move.bullet) return { rolls: [], hp }

  const physical = move.category === 'Physical'
  /*
   * The offensive stat, and the defensive one, each with whatever reads
   * only the two Pokémon and the move in front of them: the type-power
   * abilities, the two flat Attack ones, and the Ruin pair that applies
   * from the other side.
   */
  const lends = TYPE_POWER[mine]
  /*
   * The three abilities that want their owner sick. Guts takes any
   * status at all and Toxic Boost only poison, both on the physical
   * side; Flare Boost wants a burn and pays the special side.
   */
  const sick = attacker.status
  /*
   * The paradox pair, and the two legendaries built the same way: in their
   * own weather or their own terrain they lend a third to whichever stat
   * is already their best. Which stat that is has to be worked out rather
   * than assumed — it is the one the spread was built for, and a sheet
   * that moved the investment moves this with it.
   *
   * A Booster Energy switches them on too, and is not modelled: nothing
   * here holds one, and an item cannot be seen from the two sides and the
   * field alone.
   */
  const boosted = paradoxOn(attacker, field) ? bestStat(attacker) : null
  const guardBoost = paradoxOn(shielded, field) ? bestStat(shielded) : null
  const atkMult = (lends && lends.type === kind ? lends.mult : 1)
    * (boosted === (physical ? 'atk' : 'spa') ? 1.3 : 1)
    * (mine === 'Solar Power' && field.weather === 'Sun' && !physical ? 1.5 : 1)
    * (mine === 'Orichalcum Pulse' && field.weather === 'Sun' && physical ? 5461 / 4096 : 1)
    * (mine === 'Hadron Engine' && field.terrain === 'Electric' && !physical ? 5461 / 4096 : 1)
    * (mine === 'Flower Gift' && field.weather === 'Sun' && physical ? 1.5 : 1)
    * (mine === 'Gorilla Tactics' || mine === 'Hustle' ? (physical ? 1.5 : 1) : 1)
    * (mine === 'Guts' && sick && physical ? 1.5 : 1)
    * (mine === 'Toxic Boost' && sick === 'Poison' && physical ? 1.5 : 1)
    * (mine === 'Flare Boost' && sick === 'Burn' && !physical ? 1.5 : 1)
    * (RUIN[guard] === (physical ? 'atk' : 'spa') ? 0.75 : 1)
  /*
   * Sand gives a Rock type half again its Special Defense and Snow gives
   * an Ice type half again its Defense — the only two weathers that touch
   * a stat rather than a move.
   */
  const weathered = (field.weather === 'Sand' && !physical
    && shielded.pokemon.types.includes('Rock'))
    || (field.weather === 'Snow' && physical && shielded.pokemon.types.includes('Ice'))
    ? 1.5 : 1
  // Marvel Scale wants its owner sick too, and pays the physical side.
  const scale = guard === 'Marvel Scale' && shielded.status && physical ? 1.5 : 1
  const defMult = (RUIN[mine] === (physical ? 'def' : 'spd') ? 0.75 : 1) * weathered * scale
    * (guardBoost === (physical ? 'def' : 'spd') ? 1.3 : 1)
  /*
   * Stat stages, applied to the stat before anything else multiplies it,
   * which is where the games apply them.
   *
   * A critical hit ignores the two that would be in its way — the
   * attacker's own drops and the defender's boosts — and keeps the two
   * that help it. That asymmetry is the whole reason a crit through an
   * Intimidate is worth asking about.
   *
   * Wonder Room trades the two defensive stats and leaves the stages
   * where they are, so a physical hit reads Special Defense with the
   * Defense stage still on it.
   */
  const offKey: StatKey = physical ? 'atk' : 'spa'
  const defKey: StatKey = physical ? 'def' : 'spd'
  const offStage = field.crit
    ? Math.max(0, attacker.boosts?.[offKey] ?? 0)
    : attacker.boosts?.[offKey] ?? 0
  const defStage = field.crit
    ? Math.min(0, shielded.boosts?.[defKey] ?? 0)
    : shielded.boosts?.[defKey] ?? 0
  const staged = (raw: number, stage: number) => {
    if (!stage) return raw
    const { num, den } = stageOf(stage)
    return Math.floor((raw * num) / den)
  }
  const readKey: StatKey = field.wonderRoom
    ? (physical ? 'spd' : 'def')
    : defKey

  const atk = Math.floor(staged(statOf(attacker, offKey), offStage) * atkMult)
  const def = Math.max(
    1, Math.floor(staged(statOf(shielded, readKey), defStage) * defMult),
  )

  /*
   * What the move is worth before anything multiplies it.
   *
   * Five moves ask after somebody's health first and double if they like
   * the answer. It happens here rather than among the modifiers below
   * because the games set the base power itself — which is what
   * Technician then reads, so a doubled Facade is a 140 and out of its
   * reach rather than a 70 and inside it.
   */
  const reads = STATUS_POWER[move.name]
  const doubled = (reads === 'any' && shielded.status)
    || (reads === 'poison' && shielded.status === 'Poison')
    || (move.name === 'Facade' && sick && FACADE_STATUS.has(sick))
  const power = doubled ? stated * 2 : stated

  // The games' own order: three integer divisions, then the modifiers.
  let base = Math.floor(
    Math.floor(Math.floor((2 * attacker.level) / 5 + 2) * power * atk / def) / 50,
  ) + 2

  /*
   * A move that hits everything adjacent is hitting two of them in doubles.
   * Expanding Force only becomes one of those on Psychic Terrain, which is
   * also the only time it is worth the extra half — so the quarter off for
   * spreading arrives with the extra half and never without it.
   */
  const spreads = move.target === 'allAdjacentFoes' || move.target === 'allAdjacent'
    || (move.name === 'Expanding Force' && field.terrain === 'Psychic' && grounded(attacker))
  if (doubles && spreads) base = pokeRound(base * 0.75)

  // Protean makes the move's type the user's, so everything is same-type.
  const stab = mine === 'Protean' || attacker.pokemon.types.includes(kind)
    ? (mine === 'Adaptability' ? 2 : 1.5)
    : 1

  const boost = attacker.item ? ITEM_ATTACK[attacker.item] : undefined
  const typed = attacker.item && ITEM_TYPE[attacker.item] === kind ? 1.2 : 1
  const itemMult = (boost && (!boost.category || boost.category === move.category) ? boost.mult : 1)
    * typed
  // Multiscale reads the defender's HP, and here the defender is always at
  // full: these are first-hit questions. Half damage, and it says so.
  const shield = guard === 'Multiscale' || guard === 'Shadow Shield' ? 0.5 : 1
  const belt = attacker.item === 'Expert Belt' && effect > 1 ? 1.2 : 1
  /*
   * Two of the attacker's that read nothing but the move in front of
   * them. Tough Claws is a third again on anything that touches, which
   * is most of what a physical attacker clicks — Mega Aerodactyl has it
   * and every Rock Slide it threw was landing for a third less than it
   * should. Technician is half again under sixty base power, which is
   * the whole reason anything runs a sixty-power move.
   *
   * Both are in the data already: the build records `contact` on every
   * move that has the flag, and base power speaks for itself.
   */
  const claws = mine === 'Tough Claws' && move.contact ? 1.3 : 1
  const tech = mine === 'Technician' && power <= 60 ? 1.5 : 1
  const kindOf = MOVE_POWER[mine]
  const lent = kindOf && move[kindOf.flag] ? kindOf.mult : 1
  // Sand Force lends a third to the three types a sandstorm suits, and
  // only while one is blowing.
  const gritty = mine === 'Sand Force' && field.weather === 'Sand'
    && (kind === 'Rock' || kind === 'Ground' || kind === 'Steel') ? 1.3 : 1
  /*
   * Sheer Force trades a move's extra effect for a third more damage. The
   * trade is the ability, and the reader already knows which moves have
   * something to trade.
   */
  const forced = mine === 'Sheer Force' && move.secondaryChance ? 1.3 : 1
  /*
   * The rest of what reads only this pairing and this move.
   *
   * Parental Bond is two hits, the second quartered, which over a turn
   * comes to a quarter again — the spread of the sixteen rolls is a
   * little tighter than one hit's and the total is what a spread is
   * chosen against, so it is taken as the quarter.
   */
  const bond = mine === 'Parental Bond' ? 1.25 : 1
  const reckless = mine === 'Reckless' && move.recoil ? 1.2 : 1
  const punk = (mine === 'Punk Rock' && move.sound ? 1.3 : 1)
    * (guard === 'Punk Rock' && move.sound ? 0.5 : 1)
  const aura = guard === 'Aura Guard' && move.contact ? 0.5 : 1
  const lens = mine === 'Tinted Lens' && effect < 1 ? 2 : 1
  const force = mine === 'Neuroforce' && effect > 1 ? 1.25 : 1
  /*
   * And what is going on around them.
   *
   * A terrain lends a third to one type, but only to something standing
   * in it — a Flying type or a Levitate is above it. Misty is the other
   * way round and halves Dragon against whatever is standing in it, and
   * Grassy smothers the three Ground moves that shake it.
   *
   * A screen is a third off in doubles rather than half, which is the
   * number the games use with more than one Pokémon out.
   */
  /*
   * Hydro Steam is the exception the sun makes: every other Water move is
   * halved under it and this one is half again, which is a threefold swing
   * from the rule and the whole reason the move exists.
   */
  const sky = move.name === 'Hydro Steam' && field.weather === 'Sun'
    ? 1.5 : WEATHER[field.weather ?? '']?.[kind] ?? 1
  const lifts = TERRAIN[field.terrain ?? ''] === kind && grounded(attacker) ? 1.3 : 1
  const mist = field.terrain === 'Misty' && kind === 'Dragon' && grounded(shielded) ? 0.5 : 1
  const grass = field.terrain === 'Grassy' && SMOTHERED.has(move.name) && grounded(shielded)
    ? 0.5 : 1
  /*
   * A critical hit is half again, and it goes through a screen — which
   * is the other half of what makes one worth asking about. It also
   * ignores stat stages, and there are none of those here.
   */
  // Nothing is crit through a Shell Armor, so asking for one changes
  // nothing rather than half again.
  const crit = field.crit && guard !== 'Shell Armor' && guard !== 'Battle Armor' ? 1.5 : 1
  // An Aurora Veil is both screens at once, so either one standing is
  // the same question: is this side behind something.
  const behind = (physical ? field.reflect : field.lightScreen) || field.auroraVeil
  // Infiltrator walks through a screen, which is the whole of what it does
  // to a damage roll and why anybody runs it on a Dragapult.
  const screen = !field.crit && behind && effect > 0 && mine !== 'Infiltrator'
    ? (doubles ? 2732 / 4096 : 0.5) : 1
  /*
   * A berry that answers one type, and only when that type is coming in
   * hard. Half off, once — which is the hit anybody is asking about.
   */
  const berry = RESIST_BERRY[shielded.item ?? ''] === kind && effect > 1 ? 0.5 : 1
  // The other Pokemon on your side, pushing. Half again, whatever it is.
  const hand = field.helpingHand ? 1.5 : 1
  /*
   * And the other one on theirs, in the way. Friend Guard is an ally's
   * ability, so it needs an ally — in singles there is nobody to have it.
   */
  const friend = field.friendGuard && doubles ? 3072 / 4096 : 1
  // Charge doubles one Electric move and then it is spent.
  const charged = field.charge && kind === 'Electric' ? 2 : 1
  /*
   * A burn halves what the burned Pokémon hits for physically — unless
   * it has Guts, which is the whole point of Guts, and which has already
   * paid it a third again above.
   */
  const burn = sick === 'Burn' && physical && mine !== 'Guts' ? 0.5 : 1
  const after = itemMult * shield * belt * claws * tech * lent * ated * gritty * forced
    * bond * reckless * punk * aura * lens * force
    * sky * lifts * mist * grass * screen * berry * hand * crit * burn
    * friend * charged

  const rolls: number[] = []
  for (let r = 85; r <= 100; r++) {
    let d = Math.floor((base * r) / 100)
    if (stab !== 1) d = pokeRound(d * stab)
    d = Math.floor(d * effect)
    if (after !== 1) d = pokeRound(d * after)
    rolls.push(Math.max(1, d))
  }

  return { rolls, hp }
}

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
  field: Field = {},
): Hit {
  const { rolls, hp } = core(attacker, defender, move, chart, doubles, field)

  /*
   * What gets named is what made a difference — worked out by taking each
   * one away and asking again.
   *
   * Every other rule drifts. Thick Fat halves a Fire move and does nothing
   * to a Water one; it is the defender's ability and never the attacker's,
   * so Venusaur's does not explain how hard its Sludge Bomb hit; an Expert
   * Belt only counts against something it is super effective against. Each
   * of those was a hand-written condition beside its credit, and the list
   * of conditions is exactly as long as the list of things modelled.
   */
  const via: string[] = []
  const unchanged = (a: Side, d: Side) => {
    const other = core(a, d, move, chart, doubles, field)
    return other.hp === hp
      && other.rolls.length === rolls.length
      && other.rolls.every((r, i) => r === rolls[i])
  }
  for (const key of ['ability', 'item'] as const) {
    const what = attacker[key]
    if (what && !via.includes(what) && !unchanged({ ...attacker, [key]: undefined }, defender)) {
      via.push(what)
    }
  }
  for (const key of ['ability', 'item'] as const) {
    const what = defender[key]
    if (what && !via.includes(what) && !unchanged(attacker, { ...defender, [key]: undefined })) {
      via.push(what)
    }
  }

  if (!rolls.length) return NO_HIT(hp, via)
  return {
    rolls,
    hp,
    via,
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
