import type { Move, Pokemon } from '../data/types'

/**
 * What a move's dice actually looked like, rather than what the move list says.
 *
 * A Hurricane in rain cannot miss. A Blizzard in snow cannot miss. A burn
 * rolled at a Fire type was never a roll at all, and nor was a critical hit
 * against Shell Armor. The listed numbers are the starting point and the
 * battle is what turns them into odds.
 *
 * Everything here is read off the log, never guessed. Where the log does not
 * say — which of two abilities a Pokémon brought, what it was holding — the
 * modifier is simply not applied, because a wrong correction is worse than a
 * missing one. `parseReplay` says what it knows; this says what follows.
 */

/** One side of a roll, as much of it as the log gave away. */
export interface Fighter {
  species: Pokemon | null
  /** Null where the log never said, which is most of the time. */
  ability: string | null
  item: string | null
  /** Its types now, Tera and forme changes included. */
  types: string[]
  status: string | null
  /** Only the two stages that bear on whether a move lands. */
  accuracy: number
  evasion: number
}

export interface Field {
  weather: string
  terrain: string
  gravity: boolean
  /** Whether the target's side is behind a Safeguard. */
  safeguard: boolean
}

export interface Shot {
  move: Move
  attacker: Fighter
  target: Fighter
  field: Field
}

const is = (what: string | null, ...names: string[]) =>
  what != null && names.some((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '')
    === what.toLowerCase().replace(/[^a-z0-9]/g, ''))

const RAIN = /rain|primordial/i
const SUN = /sun|desolate/i
const SAND = /sand/i
const SNOW = /snow|hail/i

/** Gen 6 onwards, where a stage difference lands. Index 6 is no change. */
const STAGES = [3 / 9, 3 / 8, 3 / 7, 3 / 6, 3 / 5, 3 / 4, 1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3, 3]

/**
 * How likely the move was to land, from 0 to 1.
 *
 * Weather first, because the three weather moves do not modify their accuracy
 * so much as replace it, and then the usual chain: stages, then the abilities
 * and items that are known.
 */
export function hitChance(shot: Shot): number {
  const { move, attacker, target, field } = shot
  if (is(attacker.ability, 'No Guard') || is(target.ability, 'No Guard')) return 1
  if (move.accuracy === true) return 1

  let base = move.accuracy / 100
  if (move.name === 'Thunder' || move.name === 'Hurricane') {
    if (RAIN.test(field.weather)) return 1
    if (SUN.test(field.weather)) base = 0.5
  }
  if (move.name === 'Blizzard' && SNOW.test(field.weather)) return 1

  // Accuracy drops on the mover and evasion raised on the target are the
  // same ladder read from either end, which is why they are one number.
  let steps = attacker.accuracy - target.evasion
  if (is(target.ability, 'Keen Eye', 'Illuminate', 'Minds Eye') && steps < 0) steps = 0
  if (is(attacker.ability, 'Unaware')) steps = attacker.accuracy
  let chance = base * STAGES[Math.min(12, Math.max(0, steps + 6))]

  if (field.gravity) chance *= 5 / 3
  if (is(attacker.ability, 'Compound Eyes', 'Compoundeyes')) chance *= 1.3
  if (is(attacker.ability, 'Victory Star')) chance *= 1.1
  if (is(attacker.ability, 'Hustle') && move.category === 'Physical') chance *= 0.8
  if (is(target.ability, 'Sand Veil') && SAND.test(field.weather)) chance *= 0.8
  if (is(target.ability, 'Snow Cloak') && SNOW.test(field.weather)) chance *= 0.8
  if (is(target.ability, 'Tangled Feet')) chance *= 1 // only while confused, which is not tracked
  if (is(attacker.item, 'Wide Lens')) chance *= 1.1
  if (is(target.item, 'Bright Powder', 'Brightpowder', 'Lax Incense')) chance *= 0.9

  return Math.min(1, Math.max(0, chance))
}

/** Crit stages, and what each is worth from Gen 6 on. */
const CRIT = [1 / 24, 1 / 8, 1 / 2, 1]

/**
 * How likely a critical hit was, or null where it was never a roll — a move
 * that always crits, or a target that cannot be crit.
 */
export function critChance(shot: Shot): number | null {
  const { move, attacker, target } = shot
  if (move.category === 'Status') return null
  if (move.willCrit) return null
  if (is(target.ability, 'Battle Armor', 'Shell Armor')) return null
  if (is(attacker.ability, 'Merciless') && target.status === 'psn') return null

  let stage = (move.critRatio ?? 1) - 1
  if (is(attacker.ability, 'Super Luck')) stage += 1
  if (is(attacker.item, 'Scope Lens', 'Razor Claw')) stage += 1
  if (is(attacker.item, 'Leek') && /^Farfetch/.test(attacker.species?.name ?? '')) stage += 2
  if (is(attacker.item, 'Lucky Punch') && attacker.species?.name === 'Chansey') stage += 2
  return CRIT[Math.min(CRIT.length - 1, Math.max(0, stage))]
}

/** Types that cannot take a given status at all. */
const IMMUNE: Record<string, string[]> = {
  brn: ['Fire'],
  par: ['Electric'],
  psn: ['Poison', 'Steel'],
  tox: ['Poison', 'Steel'],
  frz: ['Ice'],
  slp: [],
}

/** Abilities that turn a given status away. */
const WARDS: Record<string, string[]> = {
  brn: ['Water Veil', 'Water Bubble', 'Thermal Exchange', 'Comatose', 'Purifying Salt'],
  par: ['Limber', 'Comatose', 'Purifying Salt'],
  psn: ['Immunity', 'Pastel Veil', 'Comatose', 'Purifying Salt'],
  tox: ['Immunity', 'Pastel Veil', 'Comatose', 'Purifying Salt'],
  frz: ['Magma Armor', 'Comatose', 'Purifying Salt'],
  slp: ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Comatose', 'Purifying Salt'],
}

/**
 * How likely the extra effect was, or null where it was never a roll.
 *
 * The chance on the move is only the start of it. Sheer Force trades the
 * effect away for damage and Shield Dust refuses it outright; a status has
 * to find a Pokémon that can take it; a stat drop has to find one whose
 * stats can be dropped.
 */
export function procChance(shot: Shot): number | null {
  const { move, attacker, target, field } = shot
  const listed = move.secondaryChance
  if (!listed) return null
  if (is(attacker.ability, 'Sheer Force')) return null
  if (is(target.ability, 'Shield Dust')) return null
  if (is(target.item, 'Covert Cloak')) return null

  const kind = move.secondaryKind
  if (kind === 'flinch' && is(target.ability, 'Inner Focus', 'Own Tempo')) return null
  if (kind === 'status') {
    const status = move.secondaryStatus ?? ''
    if (target.status) return null
    /*
     * Corrosion poisons the two types that cannot be poisoned, which is
     * the whole of what it does. The type is all it beats: an Immunity
     * Pokémon stays clean whoever asked, so the wards below still hold.
     */
    const corroding = is(attacker.ability, 'Corrosion') && (status === 'psn' || status === 'tox')
    if (!corroding && (IMMUNE[status] ?? []).some((t) => target.types.includes(t))) return null
    if (is(target.ability, ...(WARDS[status] ?? []))) return null
    if (field.safeguard) return null
    if (/misty/i.test(field.terrain)) return null
    if (/electric/i.test(field.terrain) && status === 'slp') return null
  }
  if (move.secondaryDrops
    && is(target.ability, 'Clear Body', 'White Smoke', 'Full Metal Body', 'Mirror Armor')) {
    return null
  }

  let chance = listed / 100
  if (is(attacker.ability, 'Serene Grace')) chance *= 2
  return Math.min(1, Math.max(0, chance))
}
