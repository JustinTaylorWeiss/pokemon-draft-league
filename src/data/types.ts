/** Shapes of the JSON produced by scripts/build-data.mjs. Gen 9 only. */

export type TypeName =
  | 'Bug' | 'Dark' | 'Dragon' | 'Electric' | 'Fairy' | 'Fighting'
  | 'Fire' | 'Flying' | 'Ghost' | 'Grass' | 'Ground' | 'Ice'
  | 'Normal' | 'Poison' | 'Psychic' | 'Rock' | 'Steel' | 'Stellar' | 'Water'

export interface BaseStats {
  hp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
}

export interface Pokemon {
  /** National dex number. Alt formes share the number of their base species. */
  num: number
  name: string
  types: TypeName[]
  baseStats: BaseStats
  bst: number
  /** Keyed "0"/"1" for normal slots and "H" for the hidden ability. */
  abilities: Record<string, string>
  heightm: number
  weightkg: number
  /** Chance of each gender, e.g. { M: 0.5, F: 0.5 }. Absent means an even split. */
  genderRatio?: { M: number; F: number }
  /** "N" genderless, "M" male-only, "F" female-only. */
  gender?: string
  /** Generation the species debuted in, not the games it is legal in. */
  gen: number
  /** Smogon singles tier: OU, UU, Uber, ZU, LC, NFE... Null if untiered. */
  tier: string | null
  doublesTier: string | null
  baseSpecies?: string
  forme?: string
  otherFormes?: string[]
  prevo?: string
  evos?: string[]
  eggGroups?: string[]
}

export type StatKey = keyof BaseStats

export interface Move {
  name: string
  type: TypeName
  category: 'Physical' | 'Special' | 'Status'
  basePower: number
  /** `true` means the move bypasses accuracy checks entirely. */
  accuracy: number | true
  pp: number
  priority: number
  target: string
  shortDesc: string
  /** Present only when the move does the thing; absent otherwise. */
  boosts?: Partial<Record<StatKey | 'accuracy' | 'evasion', number>>
  status?: string
  volatileStatus?: string
  sideCondition?: string
  slotCondition?: string
  weather?: string
  terrain?: string
  selfSwitch?: boolean
  forceSwitch?: boolean
  drain?: [number, number]
  recoil?: [number, number]
  heal?: [number, number]
  sound?: boolean
  contact?: boolean
  reflectable?: boolean
  wind?: boolean
  pivot?: boolean
}

export interface Ability {
  name: string
  shortDesc: string
}

export interface TypeChart {
  types: TypeName[]
  /** chart[attacking][defending] -> damage multiplier (0, 0.5, 1, or 2). */
  chart: Record<TypeName, Record<TypeName, number>>
}

/**
 * Move id -> how it is learned, with the leading generation digit stripped.
 * "M" = TM, "L45" = level 45, "E" = egg move, "T" = tutor, "S0" = event.
 */
export type Learnset = Record<string, string[]>

/** The most-used moveset for a Pokémon, per Showdown usage or Smogon analyses. */
/** A full spread as a teambuilder would show it. Names are for display. */
export interface SetSpread {
  name: string
  moves: string[]
  item?: string
  ability?: string
  nature?: string
  teraType?: string
  level?: number
  evs: Partial<Record<StatKey, number>>
  ivs?: Partial<Record<StatKey, number>>
}

export interface CommonSet {
  /** Union of every move across the spreads, as ids, for the coverage panel. */
  moves: string[]
  source: 'usage' | 'smogon'
  format: string
  spreads: SetSpread[]
}

export type SetDex = Record<string, CommonSet>

export type PokemonDex = Record<string, Pokemon>
export type MoveDex = Record<string, Move>
export type AbilityDex = Record<string, Ability>
export type LearnsetDex = Record<string, Learnset>
