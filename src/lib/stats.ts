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

/** Speed multipliers any Pokémon can pick up, so these rows are always offered. */
const UNIVERSAL_MODIFIERS: Record<string, number> = {
  'Choice Scarf': 1.5,
  'Iron Ball': 0.5,
  Paralysis: 0.5,
  Tailwind: 2,
}

/** EV/IV/nature spreads, widest first so the list reads top-down. */
/**
 * The four investments anyone actually picks, named in whichever numbers
 * are being spent.
 *
 * The last is the minimum-Speed spread, which under Gen 9 means dropping
 * the IVs to nothing as well as the nature. Champions has no IVs, so
 * there is only the nature to drop and the row says so.
 */
export function speedSpreads(
  rules: Rules = 'gen9',
): { key: string; ev: number; iv: number; nature: number }[] {
  const most = RULES[rules].max
  const floorKey = RULES[rules].ivs ? '0- 0ivs' : '0-'
  return [
    { key: `${most}+`, ev: most, iv: 31, nature: 1.1 },
    { key: `${most}`, ev: most, iv: 31, nature: 1 },
    { key: '0', ev: 0, iv: 31, nature: 1 },
    { key: floorKey, ev: 0, iv: RULES[rules].ivs ? 0 : 31, nature: 0.9 },
  ]
}

/** Boost stages as the integer fractions the games actually use. */
export const SPEED_STAGES: { key: string; num: number; den: number }[] = [
  { key: '-1', num: 2, den: 3 },
  { key: '+1', num: 3, den: 2 },
  { key: '+2', num: 2, den: 1 },
]

export const UNIVERSAL_MODIFIER_KEYS = Object.keys(UNIVERSAL_MODIFIERS)

/** Rows to show in the filter: stages, spreads, then whatever applies here. */
export function speedFilterRows(entries: { pokemon: Pokemon }[], rules: Rules = 'gen9'): {
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
    spreads: speedSpreads(rules).map((s) => s.key),
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
export function defaultSpeedFilter(
  entries: { pokemon: Pokemon }[], rules: Rules = 'gen9',
): Set<string> {
  const rows = speedFilterRows(entries, rules)
  const most = RULES[rules].max
  return new Set([
    `${most}+`, `${most}`,
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
  /** What is in the stat and which way the nature bends it: "32+", "0−". */
  investment: string
  /** Stage label ("+1") when one is applied. */
  stage: string | null
  /** Every multiplier stacked onto this row, in the order applied. */
  modifiers: string[]
  speed: number
}

/**
 * How one Pokémon is built for Speed: what it has in the stat, which way
 * its nature bends it, and the three things that multiply what comes out —
 * a Choice Scarf, Tailwind, and where it has one, its own ability.
 */
/**
 * The two held items that change Speed. One control rather than two
 * toggles, because a Pokémon holds one item and a pair of switches that
 * must not both be on is a pair of switches waiting to both be on.
 */
export type SpeedItem = '' | 'Choice Scarf' | 'Iron Ball'
export const SPEED_ITEMS: SpeedItem[] = ['', 'Choice Scarf', 'Iron Ball']

export interface SpeedBuild {
  /** SP under Champions, EVs under Gen 9. */
  ev: number
  /** 1.1, 1 or 0.9. */
  nature: number
  /** Boost stage, −6 to +6. */
  stage: number
  item: SpeedItem
  paralysis: boolean
  tailwind: boolean
  ability: boolean
}

export const bareBuild = (): SpeedBuild => ({
  ev: 0, nature: 1, stage: 0, item: '', paralysis: false, tailwind: false, ability: false,
})

/**
 * What a boost stage multiplies a stat by, as the integer fraction the
 * games use: +n is (2+n)/2 and −n is 2/(2+n), so +6 quadruples and −6
 * quarters. Kept as a fraction rather than a decimal because the result
 * is floored, and 2/3 of 151 is not 0.666 × 151.
 */
export function stageFraction(stage: number): { num: number; den: number } {
  const n = Math.max(-6, Math.min(6, Math.trunc(stage)))
  return n >= 0 ? { num: 2 + n, den: 2 } : { num: 2, den: 2 - n }
}

/** "+2", "−1", or nothing at all when the stage is neutral. */
export function stageLabel(stage: number): string | null {
  if (!stage) return null
  return `${stage > 0 ? '+' : '\u2212'}${Math.abs(stage)}`
}

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
 *
 * Paralysis halves last. The games apply every multiplier as one chain
 * and round once, so a halving and a doubling cancel exactly; flooring
 * in sequence only reproduces that if the halving comes after — Tailwind
 * on a paralysed 151 is 151, and taking the half first makes it 150.
 */
export function speedOf(
  pokemon: Pokemon, build: SpeedBuild, level = 50, rules: Rules = 'gen9',
): number {
  let speed = statAtLevel(pokemon.baseStats.spe, build.ev, build.nature, false, 31, level, rules)
  // The stage is part of the stat, so it lands before anything multiplying it.
  if (build.stage) {
    const { num, den } = stageFraction(build.stage)
    speed = Math.floor((speed * num) / den)
  }
  if (build.item) speed = Math.floor(speed * UNIVERSAL_MODIFIERS[build.item])
  const ability = speedAbility(pokemon)
  const quickFeet = build.ability && ability === 'Quick Feet'
  if (build.ability && ability) speed = Math.floor(speed * SPEED_ABILITIES[ability])
  if (build.tailwind) speed = Math.floor(speed * UNIVERSAL_MODIFIERS.Tailwind)
  // Quick Feet wants the status and then ignores what it does to Speed,
  // which is the whole point of it.
  if (build.paralysis && !quickFeet) {
    speed = Math.floor(speed * UNIVERSAL_MODIFIERS.Paralysis)
  }
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
      stage: stageLabel(build.stage),
      modifiers: [
        ...(build.item ? [build.item] : []),
        ...(build.ability && speedAbility(pokemon) ? [speedAbility(pokemon) as string] : []),
        ...(build.tailwind ? ['Tailwind'] : []),
        ...(build.paralysis ? ['Paralysis'] : []),
      ],
      speed: speedOf(pokemon, build, level, rules),
    }))
    .sort((a, b) => b.speed - a.speed)
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
  /** VGC is played at 50; singles ladders at 100. */
  level = 50,
  rules: Rules = 'gen9',
): SpeedTier[] {
  const tiers: SpeedTier[] = []
  const spreads = speedSpreads(rules)

  for (const { id, pokemon, enabled } of entries) {
    const base = pokemon.baseStats.spe
    const mods = [
      ...UNIVERSAL_MODIFIER_KEYS.filter((k) => enabled.has(k)),
      ...applicableAbilities(pokemon).filter((k) => enabled.has(k)),
    ]
    // No stage is always an option; the enabled ones are alternatives to it and
    // to each other, since a Pokémon cannot be at +1 and +2 at once.
    const stages = [null, ...SPEED_STAGES.filter((s) => enabled.has(s.key))]

    for (const spread of spreads) {
      if (!enabled.has(spread.key)) continue
      const raw = statAtLevel(base, spread.ev, spread.nature, false, spread.iv, level, rules)

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
