import type { Pokemon, StatKey } from '../data/types'

/**
 * The two ways a Pokémon can be trained, and what each calls its numbers.
 *
 * Gen 9 spends EVs: 508 of them, 252 into any one stat, and four buying a
 * point of that stat at level 100. Champions spends SP, which are the
 * points themselves — 66 to spread, 32 into any one stat, one at a time —
 * so where an EV has to be divided and scaled to reach the stat, an SP is
 * already there.
 *
 * Both maxima come to about the same place at level 50, which is where
 * the league reads: 252 EVs is 31 points of stat and 32 SP is 32.
 */
export type Rules = 'champions' | 'gen9'

export const RULES: Record<Rules, {
  label: string
  /** What one of them is called, for a readout. */
  unit: string
  budget: number
  max: number
  step: number
  /**
   * Whether IVs are a thing at all.
   *
   * Champions has none — not "everything is 31", but nothing to breed
   * for and nothing to drop. The stat it gives is the one a perfect
   * Gen 9 Pokémon has, so the maths keeps the same baseline and the
   * panel stops offering six boxes for a number nobody has.
   */
  ivs: boolean
}> = {
  champions: { label: 'Champions', unit: 'SP', budget: 66, max: 32, step: 1, ivs: false },
  gen9: { label: 'Gen 9', unit: 'EVs', budget: 508, max: 252, step: 4, ivs: true },
}

/**
 * Gen 3+ stat formula at any level. Reduces exactly to the level-100 form, so
 * it stays verified against DraftZone's speed tiers: Dragapult 252+ -> 421,
 * Iron Valiant 252+ with Quark Drive -> 546, and Amoonguss on the 0 EV / 0 IV /
 * negative-nature spread -> 58.
 *
 * Under Champions the same formula with the training taken out of the part
 * that scales by level and added after it, because an SP is a point of the
 * stat rather than a quarter of one before scaling.
 */
export function statAtLevel(
  base: number, ev = 252, nature = 1, isHp = false, iv = 31, level = 100,
  rules: Rules = 'gen9',
): number {
  const sp = rules === 'champions'
  // No IVs under Champions: the stat it gives is the one a Gen 9 Pokemon
  // has at 31, so the term stays at its best rather than dropping out.
  const perfect = sp ? 31 : iv
  const common = Math.floor(((2 * base + perfect + (sp ? 0 : Math.floor(ev / 4))) * level) / 100)
    + (sp ? ev : 0)
  // Shedinja is the one species whose HP is a flat 1 at every level.
  if (isHp) return base === 1 ? 1 : common + level + 10
  return Math.floor((common + 5) * nature)
}

/** The level-100 case, which is what the matchup tools work in. */
export function statAt100(base: number, ev = 252, nature = 1, isHp = false, iv = 31): number {
  return statAtLevel(base, ev, nature, isHp, iv, 100)
}

/** Abilities that multiply Speed. Only offered on a Pokémon that has one. */
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

/** The one held item anyone gives a Pokémon for Speed. */
const CHOICE_SCARF = 1.5

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
  /** What is in the stat and which way the nature bends it: "32+", "0−". */
  investment: string
  /** Every multiplier stacked onto this row, in the order applied. */
  modifiers: string[]
  speed: number
}

/**
 * How one Pokémon is built for Speed: what it has in the stat, which way
 * its nature bends it, and the two things that double or halve what comes
 * out — a Choice Scarf and, where it has one, its own ability.
 */
export interface SpeedBuild {
  /** SP under Champions, EVs under Gen 9. */
  ev: number
  /** 1.1, 1 or 0.9. */
  nature: number
  scarf: boolean
  ability: boolean
}

export const bareBuild = (): SpeedBuild => ({ ev: 0, nature: 1, scarf: false, ability: false })

/**
 * The one ability this Pokémon has that changes its Speed, if it has one.
 *
 * At most one is offered because none of them stack in practice and a
 * Pokémon brings a single ability to a battle — the old filter listed them
 * as rows anyone could switch on for a whole side, which credited a
 * Pokémon with an ability it does not have.
 */
export function speedAbility(pokemon: Pokemon): string | null {
  return applicableAbilities(pokemon)[0] ?? null
}

/**
 * What that build comes to.
 *
 * Each step floors separately, which is what the games do and what
 * reproduced DraftZone's numbers exactly (546 -> Tailwind 1092 -> Scarf
 * 1638). IVs are perfect where the rules have them; a Pokémon nobody is
 * building to be slow has no reason to be read at zero.
 */
export function speedOf(
  pokemon: Pokemon, build: SpeedBuild, level = 50, rules: Rules = 'gen9',
): number {
  let speed = statAtLevel(pokemon.baseStats.spe, build.ev, build.nature, false, 31, level, rules)
  if (build.scarf) speed = Math.floor(speed * CHOICE_SCARF)
  const ability = speedAbility(pokemon)
  if (build.ability && ability) speed = Math.floor(speed * SPEED_ABILITIES[ability])
  return speed
}

/** One row per Pokémon, at the build it has been given, fastest first. */
export function speedRows(
  entries: { id: string; pokemon: Pokemon; build: SpeedBuild }[],
  level = 50,
  rules: Rules = 'gen9',
): SpeedTier[] {
  return entries
    .map(({ id, pokemon, build }) => ({
      id,
      pokemon,
      investment: `${build.ev}${build.nature > 1 ? '+' : build.nature < 1 ? '\u2212' : ''}`,
      modifiers: [
        ...(build.scarf ? ['Choice Scarf'] : []),
        ...(build.ability && speedAbility(pokemon) ? [speedAbility(pokemon) as string] : []),
      ],
      speed: speedOf(pokemon, build, level, rules),
    }))
    .sort((a, b) => b.speed - a.speed)
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
