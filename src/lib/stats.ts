import type { Pokemon, StatKey } from '../data/types'

/**
 * Gen 3+ stat formula at level 100 with 31 IVs. Verified against DraftZone's
 * speed tiers: Dragapult 252+ -> 421, Iron Valiant 252+ with Quark Drive -> 546.
 */
export function statAt100(base: number, ev = 252, nature = 1, isHp = false): number {
  if (isHp) return base === 1 ? 1 : 2 * base + 31 + Math.floor(ev / 4) + 110
  return Math.floor((2 * base + 31 + Math.floor(ev / 4) + 5) * nature)
}

/** Abilities that multiply Speed, and what has to be true for them to apply. */
const SPEED_ABILITIES: Record<string, { mult: number; note: string }> = {
  'Quark Drive': { mult: 1.5, note: 'Quark Drive' },
  Protosynthesis: { mult: 1.5, note: 'Protosynthesis' },
  'Swift Swim': { mult: 2, note: 'Swift Swim' },
  Chlorophyll: { mult: 2, note: 'Chlorophyll' },
  'Sand Rush': { mult: 2, note: 'Sand Rush' },
  'Slush Rush': { mult: 2, note: 'Slush Rush' },
  'Surge Surfer': { mult: 2, note: 'Surge Surfer' },
  Unburden: { mult: 2, note: 'Unburden' },
  'Quick Feet': { mult: 1.5, note: 'Quick Feet' },
  Steadfast: { mult: 1, note: '' },
}

export interface SpeedTier {
  id: string
  pokemon: Pokemon
  /** "252+", "252", "0" — EV investment plus nature. */
  investment: string
  /** Ability applied on top, if any. */
  ability: string | null
  speed: number
}

/**
 * Every speed a Pokémon can realistically sit at, so you can read off who
 * outruns whom. Quark Drive and Protosynthesis only boost Speed when Speed is
 * the highest stat, which is why they are conditional rather than always on.
 */
export function speedTiers(entries: { id: string; pokemon: Pokemon }[]): SpeedTier[] {
  const tiers: SpeedTier[] = []

  for (const { id, pokemon } of entries) {
    const base = pokemon.baseStats.spe
    const investments: [string, number, number][] = [
      ['252+', 252, 1.1],
      ['252', 252, 1],
      ['0', 0, 1],
    ]

    // Paradox abilities only kick in if Speed is the Pokémon's highest stat.
    const highest = (Object.keys(pokemon.baseStats) as StatKey[])
      .reduce((a, b) => (pokemon.baseStats[b] > pokemon.baseStats[a] ? b : a))
    const boosters = Object.values(pokemon.abilities)
      .map((name) => ({ name, info: SPEED_ABILITIES[name] }))
      .filter((a) => a.info && a.info.mult > 1)
      .filter((a) => {
        const paradox = a.name === 'Quark Drive' || a.name === 'Protosynthesis'
        return !paradox || highest === 'spe'
      })

    for (const [label, ev, nature] of investments) {
      const raw = statAt100(base, ev, nature)
      tiers.push({ id, pokemon, investment: label, ability: null, speed: raw })
      for (const b of boosters) {
        tiers.push({
          id, pokemon, investment: label, ability: b.name,
          speed: Math.floor(raw * b.info!.mult),
        })
      }
    }
  }

  return tiers.sort((a, b) => b.speed - a.speed)
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
