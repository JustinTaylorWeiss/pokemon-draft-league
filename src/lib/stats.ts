import type { Pokemon, StatKey } from '../data/types'

/**
 * Gen 3+ stat formula at any level. Reduces exactly to the level-100 form, so
 * it stays verified against DraftZone's speed tiers: Dragapult 252+ -> 421,
 * Iron Valiant 252+ with Quark Drive -> 546, and Amoonguss on the 0 EV / 0 IV /
 * negative-nature spread -> 58.
 */
export function statAtLevel(
  base: number, ev = 252, nature = 1, isHp = false, iv = 31, level = 100,
): number {
  const common = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100)
  // Shedinja is the one species whose HP is a flat 1 at every level.
  if (isHp) return base === 1 ? 1 : common + level + 10
  return Math.floor((common + 5) * nature)
}

/** The level-100 case, which is what the matchup tools work in. */
export function statAt100(base: number, ev = 252, nature = 1, isHp = false, iv = 31): number {
  return statAtLevel(base, ev, nature, isHp, iv, 100)
}

/** Abilities that multiply Speed. Only listed as filter rows if a team has one. */
const SPEED_ABILITIES: Record<string, number> = {
  'Quark Drive': 1.5,
  Protosynthesis: 1.5,
  'Swift Swim': 2,
  Chlorophyll: 2,
  'Sand Rush': 2,
  'Slush Rush': 2,
  'Surge Surfer': 2,
  Unburden: 2,
  'Quick Feet': 1.5,
}

/** Speed multipliers any Pokémon can pick up, so these rows are always offered. */
const UNIVERSAL_MODIFIERS: Record<string, number> = {
  'Choice Scarf': 1.5,
  'Iron Ball': 0.5,
  Paralysis: 0.5,
  Tailwind: 2,
}

/** EV/IV/nature spreads, widest first so the list reads top-down. */
export const SPEED_SPREADS: { key: string; ev: number; iv: number; nature: number }[] = [
  { key: '252+', ev: 252, iv: 31, nature: 1.1 },
  { key: '252', ev: 252, iv: 31, nature: 1 },
  { key: '0', ev: 0, iv: 31, nature: 1 },
  { key: '0- 0ivs', ev: 0, iv: 0, nature: 0.9 },
]

/** Boost stages as the integer fractions the games actually use. */
export const SPEED_STAGES: { key: string; num: number; den: number }[] = [
  { key: '-1', num: 2, den: 3 },
  { key: '+1', num: 3, den: 2 },
  { key: '+2', num: 2, den: 1 },
]

export const UNIVERSAL_MODIFIER_KEYS = Object.keys(UNIVERSAL_MODIFIERS)

/** Rows to show in the filter: stages, spreads, then whatever applies here. */
export function speedFilterRows(entries: { pokemon: Pokemon }[]): {
  stages: string[]
  spreads: string[]
  modifiers: string[]
} {
  const abilities = new Set<string>()
  for (const { pokemon } of entries) {
    for (const name of applicableAbilities(pokemon)) abilities.add(name)
  }
  return {
    stages: SPEED_STAGES.map((s) => s.key),
    spreads: SPEED_SPREADS.map((s) => s.key),
    // Alphabetical, matching how DraftZone orders this block.
    modifiers: [...UNIVERSAL_MODIFIER_KEYS, ...abilities].sort((a, b) => a.localeCompare(b)),
  }
}

/**
 * The rows that start switched on. Both sides get the same defaults — an
 * ability row does nothing to a team that has no Pokémon with it, so leaving it
 * on is harmless and keeps the two columns reading symmetrically.
 *
 * Stages and held items/conditions are opt-in, since they are choices a player
 * makes; a Pokémon's own ability is not, so it starts on. The two uninvested
 * spreads stay off, which keeps the default list to the spreads a drafted team
 * actually runs. DraftZone ships those two on — switch them on in the filter to
 * match it.
 */
export function defaultSpeedFilter(entries: { pokemon: Pokemon }[]): Set<string> {
  const rows = speedFilterRows(entries)
  return new Set([
    '252+', '252',
    ...rows.modifiers.filter((m) => !(m in UNIVERSAL_MODIFIERS)),
  ])
}

/** Paradox abilities only fire when Speed is the Pokémon's highest stat. */
function applicableAbilities(pokemon: Pokemon): string[] {
  const highest = (Object.keys(pokemon.baseStats) as StatKey[])
    .reduce((a, b) => (pokemon.baseStats[b] > pokemon.baseStats[a] ? b : a))
  return Object.values(pokemon.abilities).filter((name) => {
    if (!(name in SPEED_ABILITIES)) return false
    const paradox = name === 'Quark Drive' || name === 'Protosynthesis'
    return !paradox || highest === 'spe'
  })
}

export interface SpeedTier {
  id: string
  pokemon: Pokemon
  /** "252+", "252", "0", "0- 0ivs" — EVs, IVs and nature. */
  investment: string
  /** Stage label ("+1") when one is applied. */
  stage: string | null
  /** Every multiplier stacked onto this row, in the order applied. */
  modifiers: string[]
  speed: number
}

/**
 * Every speed a Pokémon can sit at under the enabled filters, so you can read
 * off who outruns whom.
 *
 * Modifiers stack rather than replacing each other — DraftZone lists a Choice
 * Scarf under Tailwind as its own tier, so a Pokémon contributes one row per
 * combination of the multipliers switched on for its side. Each step floors
 * separately, which is what the games do and what reproduces DraftZone's
 * numbers exactly (546 -> Tailwind 1092 -> Scarf 1638).
 */
export function speedTiers(
  entries: { id: string; pokemon: Pokemon; enabled: Set<string> }[],
): SpeedTier[] {
  const tiers: SpeedTier[] = []

  for (const { id, pokemon, enabled } of entries) {
    const base = pokemon.baseStats.spe
    const mods = [
      ...UNIVERSAL_MODIFIER_KEYS.filter((k) => enabled.has(k)),
      ...applicableAbilities(pokemon).filter((k) => enabled.has(k)),
    ]
    // No stage is always an option; the enabled ones are alternatives to it and
    // to each other, since a Pokémon cannot be at +1 and +2 at once.
    const stages = [null, ...SPEED_STAGES.filter((s) => enabled.has(s.key))]

    for (const spread of SPEED_SPREADS) {
      if (!enabled.has(spread.key)) continue
      const raw = statAt100(base, spread.ev, spread.nature, false, spread.iv)

      for (const stage of stages) {
        const staged = stage ? Math.floor((raw * stage.num) / stage.den) : raw

        // Every subset of the enabled multipliers, bit i meaning "mods[i] on".
        for (let mask = 0; mask < 1 << mods.length; mask++) {
          const applied: string[] = []
          let speed = staged
          for (let i = 0; i < mods.length; i++) {
            if (!(mask & (1 << i))) continue
            applied.push(mods[i])
            speed = Math.floor(speed * (UNIVERSAL_MODIFIERS[mods[i]] ?? SPEED_ABILITIES[mods[i]]))
          }
          tiers.push({
            id, pokemon, investment: spread.key, stage: stage?.key ?? null,
            modifiers: applied, speed,
          })
        }
      }
    }
  }

  return tiers.sort((a, b) => b.speed - a.speed)
}

/**
 * What each nature does, so a set can show "Adamant (+Atk, -SpA)" and the
 * stat line can apply the 1.1/0.9 it implies. The five missing names are the
 * neutral ones, which is why this is a lookup that can legitimately miss.
 */
export const NATURES: Record<string, { plus: StatKey; minus: StatKey }> = {
  Adamant: { plus: 'atk', minus: 'spa' },
  Bold: { plus: 'def', minus: 'atk' },
  Brave: { plus: 'atk', minus: 'spe' },
  Calm: { plus: 'spd', minus: 'atk' },
  Careful: { plus: 'spd', minus: 'spa' },
  Gentle: { plus: 'spd', minus: 'def' },
  Hasty: { plus: 'spe', minus: 'def' },
  Impish: { plus: 'def', minus: 'spa' },
  Jolly: { plus: 'spe', minus: 'spa' },
  Lax: { plus: 'def', minus: 'spd' },
  Lonely: { plus: 'atk', minus: 'def' },
  Mild: { plus: 'spa', minus: 'def' },
  Modest: { plus: 'spa', minus: 'atk' },
  Naive: { plus: 'spe', minus: 'spd' },
  Naughty: { plus: 'atk', minus: 'spd' },
  Quiet: { plus: 'spa', minus: 'spe' },
  Rash: { plus: 'spa', minus: 'spd' },
  Relaxed: { plus: 'def', minus: 'spe' },
  Sassy: { plus: 'spd', minus: 'spe' },
  Timid: { plus: 'spe', minus: 'atk' },
}

/** The 1.1 / 0.9 / 1 multiplier a nature applies to one stat. */
export function natureMultiplier(nature: string | undefined, stat: StatKey): number {
  const effect = nature ? NATURES[nature] : undefined
  if (!effect) return 1
  if (effect.plus === stat) return 1.1
  if (effect.minus === stat) return 0.9
  return 1
}

export const BST_ORDER: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
export const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD', spe: 'SPE',
}

export function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return {
    average: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    median: sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    max: sorted[sorted.length - 1],
  }
}
