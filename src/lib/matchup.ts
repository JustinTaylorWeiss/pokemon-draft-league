import type {
  Learnset, Move, MoveDex, Pokemon, TypeChart, TypeName,
} from '../data/types'

/** The 18 battle types. Stellar is excluded — nothing is defensively Stellar. */
export const BATTLE_TYPES: TypeName[] = [
  'Normal', 'Grass', 'Water', 'Fire', 'Electric', 'Ground', 'Rock', 'Flying',
  'Ice', 'Fighting', 'Poison', 'Bug', 'Psychic', 'Dark', 'Ghost', 'Dragon',
  'Steel', 'Fairy',
]

/**
 * Abilities that change how much damage a type deals. Only the ones that key
 * purely off the attacking type belong here — anything conditional on weather,
 * contact, or move flags is left out rather than modelled half-way.
 */
const ABILITY_DEFENSE: Record<string, Partial<Record<TypeName, number>>> = {
  Levitate: { Ground: 0 },
  'Earth Eater': { Ground: 0 },
  'Water Absorb': { Water: 0 },
  'Storm Drain': { Water: 0 },
  'Dry Skin': { Water: 0, Fire: 1.25 },
  'Volt Absorb': { Electric: 0 },
  'Lightning Rod': { Electric: 0 },
  'Motor Drive': { Electric: 0 },
  'Flash Fire': { Fire: 0 },
  'Well-Baked Body': { Fire: 0 },
  'Sap Sipper': { Grass: 0 },
  'Thick Fat': { Fire: 0.5, Ice: 0.5 },
  Heatproof: { Fire: 0.5 },
  'Water Bubble': { Fire: 0.5 },
  Fluffy: { Fire: 2 },
  'Purifying Salt': { Ghost: 0.5 },
}

/** Abilities that soften any super-effective hit rather than a specific type. */
const SUPER_EFFECTIVE_REDUCERS = new Set(['Filter', 'Solid Rock', 'Prism Armor'])

/**
 * Damage multiplier for one attacking type against one Pokémon.
 * `useAbilities` mirrors DraftZone's toggle: off gives raw type math.
 */
export function defensiveMultiplier(
  chart: TypeChart,
  attacking: TypeName,
  pokemon: Pokemon,
  useAbilities = true,
): number {
  let mult = pokemon.types.reduce(
    (acc, def) => acc * (chart.chart[attacking]?.[def] ?? 1),
    1,
  )
  if (!useAbilities) return mult

  const abilities = Object.values(pokemon.abilities)

  // Wonder Guard overrides everything else it could stack with.
  if (abilities.includes('Wonder Guard')) return mult > 1 ? mult : 0

  for (const name of abilities) {
    const mod = ABILITY_DEFENSE[name]?.[attacking]
    if (mod !== undefined) {
      // An immunity wins outright; other modifiers scale the type result.
      if (mod === 0) return 0
      mult *= mod
    }
  }
  if (mult > 1 && abilities.some((a) => SUPER_EFFECTIVE_REDUCERS.has(a))) mult *= 0.75

  return mult
}

export interface DefensiveRow {
  id: string
  pokemon: Pokemon
  multipliers: Record<TypeName, number>
}

export interface DefensiveSummary {
  /** How many team members are weak to each type. */
  weaks: Record<TypeName, number>
  /** How many resist or are immune to it. */
  resists: Record<TypeName, number>
  /** resists - weaks. Positive means the team handles that type well. */
  delta: Record<TypeName, number>
}

export function defensiveChart(
  chart: TypeChart,
  team: { id: string; pokemon: Pokemon }[],
  useAbilities = true,
): { rows: DefensiveRow[]; summary: DefensiveSummary } {
  const rows = team.map(({ id, pokemon }) => ({
    id,
    pokemon,
    multipliers: Object.fromEntries(
      BATTLE_TYPES.map((t) => [t, defensiveMultiplier(chart, t, pokemon, useAbilities)]),
    ) as Record<TypeName, number>,
  }))

  const blank = () => Object.fromEntries(BATTLE_TYPES.map((t) => [t, 0])) as Record<TypeName, number>
  const weaks = blank()
  const resists = blank()
  const delta = blank()

  for (const t of BATTLE_TYPES) {
    for (const row of rows) {
      if (row.multipliers[t] > 1) weaks[t]++
      else if (row.multipliers[t] < 1) resists[t]++
    }
    delta[t] = resists[t] - weaks[t]
  }

  return { rows, summary: { weaks, resists, delta } }
}

/**
 * Attacking types a Pokémon actually has moves for, split by damage category.
 * A Pokémon with only Status moves of a type does not get coverage credit.
 *
 * `minPower` matters more than it looks: universal TMs mean almost every
 * Pokémon can technically learn a weak move of half the types, so counting
 * everything reports 100% coverage for the whole team and tells you nothing.
 * The default keeps moves a team would realistically click.
 */
export function attackingTypes(
  learnset: Learnset | undefined,
  moves: MoveDex,
  minPower = 60,
): { physical: Set<TypeName>; special: Set<TypeName> } {
  const physical = new Set<TypeName>()
  const special = new Set<TypeName>()
  if (!learnset) return { physical, special }

  for (const moveId of Object.keys(learnset)) {
    const move = moves[moveId]
    if (!move || move.basePower < minPower) continue
    if (move.category === 'Physical') physical.add(move.type)
    else if (move.category === 'Special') special.add(move.type)
  }
  return { physical, special }
}

export interface CoverageResult {
  id: string
  pokemon: Pokemon
  physical: Set<TypeName>
  special: Set<TypeName>
  /** Opposing ids this Pokémon can hit super-effectively. */
  hits: string[]
  /** Opposing ids nothing in its movepool hits for extra damage. */
  misses: string[]
  /** hits / total, as a whole percentage. */
  percent: number
}

/**
 * For each attacker, which opponents it threatens. `selectedTypes` lets a view
 * narrow the pool to a hypothetical moveset, matching DraftZone's toggleable
 * type chips; omit it to use everything the Pokémon can learn.
 */
export function coverage(
  chart: TypeChart,
  attackers: { id: string; pokemon: Pokemon }[],
  defenders: { id: string; pokemon: Pokemon }[],
  learnsets: Record<string, Learnset>,
  moves: MoveDex,
  useAbilities = true,
  selectedTypes?: Record<string, Set<TypeName>>,
  minPower = 60,
): CoverageResult[] {
  return attackers.map(({ id, pokemon }) => {
    const { physical, special } = attackingTypes(learnsets[id], moves, minPower)
    const pool = selectedTypes?.[id] ?? new Set([...physical, ...special])

    const hits: string[] = []
    const misses: string[] = []
    for (const def of defenders) {
      const threatened = [...pool].some(
        (t) => defensiveMultiplier(chart, t, def.pokemon, useAbilities) > 1,
      )
      ;(threatened ? hits : misses).push(def.id)
    }

    return {
      id, pokemon, physical, special, hits, misses,
      percent: defenders.length ? Math.round((hits.length / defenders.length) * 100) : 0,
    }
  })
}

/** DraftZone's move categories, rebuilt from Showdown's move properties. */
export const MOVE_TAGS = [
  'CLERIC', 'DISRUPTION', 'FIELD MANIPULATION', 'HAZARD CONTROL', 'MOMENTUM',
  'PRIORITY', 'SETUP', 'SPEED CONTROL', 'SPREAD', 'STATUS', 'SUPPORT',
  'TRAPPING', 'TYPE CHANGING',
] as const

export type MoveTag = (typeof MOVE_TAGS)[number]

const BY_NAME: Record<string, MoveTag[]> = {
  'Heal Bell': ['CLERIC'], Aromatherapy: ['CLERIC'], Wish: ['CLERIC', 'SUPPORT'],
  'Rapid Spin': ['HAZARD CONTROL'], Defog: ['HAZARD CONTROL'], 'Court Change': ['HAZARD CONTROL'],
  'Tidy Up': ['HAZARD CONTROL', 'SETUP'], 'Mortal Spin': ['HAZARD CONTROL'],
  'Stealth Rock': ['HAZARD CONTROL'], Spikes: ['HAZARD CONTROL'],
  'Toxic Spikes': ['HAZARD CONTROL'], 'Sticky Web': ['HAZARD CONTROL', 'SPEED CONTROL'],
  Taunt: ['DISRUPTION'], Encore: ['DISRUPTION'], Disable: ['DISRUPTION'],
  'Knock Off': ['DISRUPTION'], Trick: ['DISRUPTION'], Switcheroo: ['DISRUPTION'],
  Torment: ['DISRUPTION'], Haze: ['DISRUPTION'], 'Clear Smog': ['DISRUPTION'],
  'Trick Room': ['FIELD MANIPULATION', 'SPEED CONTROL'], Gravity: ['FIELD MANIPULATION'],
  'Magic Room': ['FIELD MANIPULATION'], 'Wonder Room': ['FIELD MANIPULATION'],
  Tailwind: ['SPEED CONTROL', 'SUPPORT'], 'Thunder Wave': ['SPEED CONTROL', 'STATUS'],
  'Icy Wind': ['SPEED CONTROL', 'SPREAD'], Electroweb: ['SPEED CONTROL', 'SPREAD'],
  Block: ['TRAPPING'], 'Mean Look': ['TRAPPING'], 'Spirit Shackle': ['TRAPPING'],
  'Anchor Shot': ['TRAPPING'], 'Thousand Waves': ['TRAPPING'], 'Jaw Lock': ['TRAPPING'],
  Soak: ['TYPE CHANGING'], "Forest's Curse": ['TYPE CHANGING'],
  'Trick-or-Treat': ['TYPE CHANGING'], 'Reflect Type': ['TYPE CHANGING'],
  Reflect: ['SUPPORT'], 'Light Screen': ['SUPPORT'], 'Aurora Veil': ['SUPPORT'],
  'Helping Hand': ['SUPPORT'], 'Follow Me': ['SUPPORT'], 'Rage Powder': ['SUPPORT'],
}

const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes', 'all', 'foeSide'])

export function tagsFor(move: Move): MoveTag[] {
  const tags = new Set<MoveTag>(BY_NAME[move.name] ?? [])

  if (move.priority > 0 && move.category !== 'Status') tags.add('PRIORITY')
  if (SPREAD_TARGETS.has(move.target) && move.basePower > 0) tags.add('SPREAD')
  if (move.status) tags.add('STATUS')
  if (move.selfSwitch || move.pivot) tags.add('MOMENTUM')
  if (move.weather || move.terrain) tags.add('FIELD MANIPULATION')
  if (move.heal) tags.add('CLERIC')
  if (move.forceSwitch) tags.add('DISRUPTION')

  // A move that raises the user's own stats is setup; one that lowers the
  // target's is disruption. Showdown stores both under `boosts`.
  if (move.boosts) {
    const values = Object.values(move.boosts)
    const raises = values.some((v) => (v ?? 0) > 0)
    const lowers = values.some((v) => (v ?? 0) < 0)
    if (raises && move.target === 'self') tags.add('SETUP')
    if (lowers && move.target !== 'self') tags.add('DISRUPTION')
    if (move.boosts.spe && move.boosts.spe !== 0) tags.add('SPEED CONTROL')
  }

  return [...tags].sort()
}
