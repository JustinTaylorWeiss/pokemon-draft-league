import type { MoveDex, PokemonDex } from '../data/types'
import { critChance, hitChance, procChance, type Field, type Fighter } from './odds'

/**
 * Turns a Pokémon Showdown replay into a match report.
 *
 * The replay log carries everything a report needs: both teams from the preview,
 * every knockout, and who scored it. Reading it beats typing it — the numbers
 * come from the battle rather than from someone's memory of the battle.
 *
 * KO attribution works backwards from the kill: a Pokémon faints when a damage
 * line takes it to `0 fnt`, and whoever used the most recent move against it
 * gets the credit. Damage tagged `[from]` — weather, poison, recoil, hazards —
 * has no attacker, so those deaths are recorded with nobody credited rather
 * than blamed on whoever moved last.
 *
 * Four kinds of knockout have no damage line to work backwards from, and all
 * four used to fall to whoever had hit last — several turns earlier, the
 * wrong coach, or nobody:
 *
 *  - Perish Song, where the counter reaches zero and the Pokémon faints. The
 *    singer is remembered and spent when the count runs out.
 *  - Explosion and the rest that take their own user down. Nobody scores
 *    those, where an opponent used to.
 *  - Destiny Bond, which drags the killer down after it. The bond's holder
 *    takes the next faint at the other end.
 *  - Future Sight, which lands a turn and a half after it is thrown, by
 *    which time its thrower may be on the bench.
 *
 * A knockout is never credited across to the same side. A Pokémon that goes
 * down to its partner's Earthquake, its partner's Perish Song or its own
 * Explosion is a death for it and a knockout for nobody.
 *
 * A faint that gets undone is taken back off both records. Revival Blessing
 * puts a fainted Pokémon back in the party, and a knockout that did not stick
 * is not a knockout: the death comes off the Pokémon and the KO comes off
 * whoever was credited with it. Left in, one Pokémon could be knocked out
 * twice — two deaths against a team of six, and a survivor count that reads
 * one short of what was standing at the end.
 */

export interface ReplaySide {
  /** The Showdown username, which is not the league player name. */
  account: string
  /** Team preview, so a Pokémon that never switched in is still listed. */
  team: string[]
  lines: {
    pokemon: string
    kills: number
    deaths: number
    /**
     * Whether it was actually brought — six are previewed and four are played.
     * Not derivable from the numbers: a Pokémon that came in and neither scored
     * nor fainted reads 0/0, exactly like one that sat on the bench.
     */
    brought: boolean
    /** How many times it was brought back after fainting. Nearly always 0. */
    revived: number
    /** What it clicked, and what came of it. Empty for a Pokémon that sat out. */
    moves: MoveTally[]
  }[]
}

/** One move a Pokémon used, and what it did with it. */
export interface MoveTally {
  name: string
  /** Times clicked, including the ones that missed or hit a Protect. */
  used: number
  /** Knockouts where this was the move that did it. */
  kos: number
  /**
   * Damage dealt to the other side, as a share of the target's health.
   *
   * The log reports health out of a hundred, so this is a count of
   * percentage points and 100 is one full Pokémon — it adds across targets,
   * so a spread move that takes half off each of two is 100. Only the other
   * side counts, the same rule knockouts follow.
   */
  damage: number
  /**
   * Accuracy checks this move actually made, counted per target — a spread
   * move that caught two is two.
   *
   * Not the same as `used`. A move a Protect, an immunity or a flat failure
   * swallowed never rolled at all, and counting those as chances to miss
   * would have everyone who clicks into a Protect looking lucky.
   */
  rolls: number
  /** Of those rolls, the ones the log says missed. */
  misses: number
  /**
   * The hits the odds say it should have landed, added up one roll at a
   * time — because the odds are not the same twice. A Hurricane in rain
   * cannot miss and the same Hurricane in sun is a coin flip, and only the
   * battle knows which it was.
   */
  expHits: number
  /** Hits where a critical hit was possible at all. */
  critRolls: number
  /** Critical hits it landed. */
  crits: number
  /** The critical hits those rolls were worth. */
  expCrits: number
  /**
   * Times its extra effect fired on the other side: a burn, a flinch, a
   * stat drop, confusion.
   *
   * Counted once per target per use, whatever the effect was, because a
   * move rolls once for its secondary and not once per line the log
   * prints about it. Recorded for any move at all — whether the effect
   * was a roll or simply what the move does is a question for the move
   * data, which this reader does not have.
   */
  procs: number
  /**
   * Hits where that effect had somewhere to land.
   *
   * Narrower than hits, and in several ways at once. A Pokémon knocked out
   * by the damage cannot then be burned by it. A flinch only ever shows on
   * a target still to move, and only if it lives long enough to try. A burn
   * cannot find a Fire type, a Sheer Force attacker has traded the effect
   * away, and a Covert Cloak refuses it. Counted per target.
   */
  procRolls: number
  /** The effects those rolls were worth. */
  expProcs: number
}

export interface ReplayGame {
  format: string
  /** Won by 'a', 'b', or null if the log has no winner (a tie or an abort). */
  winner: 'a' | 'b' | null
  a: ReplaySide
  b: ReplaySide
  /** How many of the winner's Pokémon were still standing. */
  survivors: number
}

/** A Pokémon, and the move it is being credited for. */
interface Credit { side: string; index: number; move: string }

/** `p1a: Iron Hands` -> { side: 'p1', name: 'Iron Hands' } */
function parseIdent(token: string): { side: string; name: string } | null {
  const match = /^(p[12])[a-z]?:\s*(.+)$/.exec(token.trim())
  return match ? { side: match[1], name: match[2].trim() } : null
}

/**
 * `92/100` -> 92, `0 fnt` -> 0, and nothing for a line that says neither.
 *
 * Health is reported out of a hundred in every one of this league's logs —
 * Showdown hides exact numbers from the other side — so these are
 * percentage points and need no stat to interpret.
 */
function hpOf(token: string): number | null {
  const t = token.trim()
  if (/^0 fnt/.test(t)) return 0
  const m = /^(\d+)\s*\/\s*(\d+)/.exec(t)
  if (!m) return null
  const max = Number(m[2])
  return max > 0 ? (Number(m[1]) / max) * 100 : null
}

/** `Calyrex-Shadow, L50, F` -> `Calyrex-Shadow` */
const speciesOf = (details: string) => details.split(',')[0].trim()

/**
 * Accepts a replay URL or a bare id.
 * `https://replay.pokemonshowdown.com/gen9vgc2024regg-2664804879` -> the id.
 */
export function replayId(input: string): string | null {
  const trimmed = input.trim().replace(/\?.*$/, '').replace(/\/$/, '')
  const match = /([a-z0-9]+-\d+(?:-[a-z0-9]+)?)$/i.exec(trimmed)
  return match ? match[1] : null
}

/** The two datasets the odds need, where the caller has them to hand. */
export interface BattleData {
  moves: MoveDex
  dex: PokemonDex
}

export async function fetchReplay(
  input: string,
  data: BattleData | null = null,
): Promise<ReplayGame> {
  const id = replayId(input)
  if (!id) throw new Error('That does not look like a Showdown replay link.')
  const res = await fetch(`https://replay.pokemonshowdown.com/${id}.json`)
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'No replay with that link — check it is uploaded and not private.'
        : `Showdown returned ${res.status}.`,
    )
  }
  const body = await res.json()
  return parseReplayLog(body.log ?? '', body.format ?? '', body.players ?? [], data)
}

/**
 * Moves that knock their own user out as part of using them.
 *
 * The user's faint has no damage line of its own, so it was credited to
 * whoever had hit them last — an opponent collecting a knockout for a
 * Pokémon that blew itself up, or walked off for a Healing Wish. Nobody
 * scores these.
 */
const SELF_KO = new Set([
  'Explosion', 'Self-Destruct', 'Misty Explosion',
  'Final Gambit', 'Healing Wish', 'Lunar Dance', 'Memento',
])

/** The two that land a turn and a half after they are used. */
const FUTURE = new Set(['Future Sight', 'Doom Desire'])

/**
 * What stops a move before it ever rolls for accuracy.
 *
 * Protect and its relatives, a type or ability immunity, and a move that
 * simply fails. None of these is a chance to miss, so a use swallowed by one
 * is taken back off the roll count rather than left in to flatter whoever
 * clicked into it — in doubles that is a quarter of everything thrown.
 */
const GUARDS = /move:\s*(Protect|Detect|Spiky Shield|Baneful Bunker|Silk Trap|Burning Bulwark|King's Shield|Obstruct|Quick Guard|Wide Guard|Crafty Shield|Mat Block|Max Guard)/i

/** `Urshifu-Rapid-Strike` and `Urshifu-*` are the same Pokémon; so are `Landorus-Therian` and `Landorus`. */
const baseOf = (name: string) => name.split('-')[0].trim().toLowerCase()

/**
 * Finds which team-preview entry a battle Pokémon is, as an index.
 *
 * Team preview hides some formes behind a wildcard — a team may list
 * `Urshifu-*` and then send out `Urshifu-Rapid-Strike`. Counting by name would
 * file that Pokémon's knockouts under a name no line ever reads, so they would
 * silently vanish and the totals would not balance. Matching to a slot, and
 * then letting the battle's more specific name replace the masked one, keeps
 * every knockout attached to the Pokémon that scored it.
 */
function teamIndex(team: string[], species: string): number {
  const exact = team.findIndex((t) => t.toLowerCase() === species.toLowerCase())
  if (exact >= 0) return exact

  const masked = team.findIndex((t) => t.includes('*') && baseOf(t) === baseOf(species))
  if (masked >= 0) {
    team[masked] = species // the concrete forme is what was actually drafted
    return masked
  }

  const sameBase = team.findIndex((t) => baseOf(t) === baseOf(species))
  if (sameBase >= 0) return sameBase

  // Nothing matched — better a line under an unexpected name than a lost one.
  team.push(species)
  return team.length - 1
}

export function parseReplayLog(
  log: string,
  format = '',
  players: string[] = [],
  data: BattleData | null = null,
): ReplayGame {
  const teams: Record<string, string[]> = { p1: [], p2: [] }
  /** How many of the previewed six each side brings; 0 where it is not said. */
  let picked = 0
  const accounts: Record<string, string> = { p1: players[0] ?? 'p1', p2: players[1] ?? 'p2' }
  // Counted per team slot rather than per name, so a forme change cannot
  // scatter one Pokemon's record across two keys.
  const kills: Record<string, Record<number, number>> = { p1: {}, p2: {} }
  const deaths: Record<string, Record<number, number>> = { p1: {}, p2: {} }

  /** Which team slot is in each battle position, which the log does not say directly. */
  const active: Record<string, number> = {}
  /*
   * What each nickname belongs to, learned from the switch that brought it in.
   *
   * Most lines name a Pokémon by its battle position and are resolved
   * through `active`, but a Revival Blessing names one on the bench, which
   * has no position — so that one is looked up by name, and a nickname is
   * not a species. It matched nothing, so the reader filed the nickname as
   * a seventh team member and the revive was applied to that instead of to
   * the Pokémon it belonged to.
   */
  const named: Record<string, Record<string, number>> = { p1: {}, p2: {} }
  /** Team slots that were sent out at any point, by side. */
  const brought: Record<string, Set<number>> = { p1: new Set(), p2: new Set() }
  /** Last attacker to damage each Pokémon, which is who gets the KO. */
  const lastHitBy: Record<string, Credit | null> = {}
  /** Who was credited for each slot's most recent faint, so a revive can take it back. */
  const creditedTo: Record<string, Record<number, Credit | null>> = { p1: {}, p2: {} }
  /** Slots brought back after fainting, and how often. */
  const revived: Record<string, Record<number, number>> = { p1: {}, p2: {} }
  /** What a slot's `detailschange` said it became, until something says why. */
  const becoming: Record<string, string> = {}
  /*
   * Perish Song, which kills without a damage line.
   *
   * Everything else here works backwards from the hit: a Pokémon drops to
   * `0 fnt` on a damage line and whoever moved against it last is credited.
   * Perish Song has no damage line at all — the counter reaches zero and the
   * Pokémon faints — so the credit fell to whoever happened to have hit it
   * last, which could be three turns earlier, the wrong coach, or nobody.
   *
   * So the singer is remembered when the song lands and spent when the
   * counter runs out. Per slot, because the four on the field are counting
   * down separately and a second Perish Song does not re-apply to anything
   * already singing — the first one still owns those.
   */
  let singer: Credit | null = null
  const perishedBy: Record<string, Credit | null> = {}
  /** Slots whose counter has just hit zero, so the next faint is the song's. */
  const perishing = new Set<string>()
  /** Slots about to go down by their own hand, which is nobody's knockout. */
  const selfKO = new Set<string>()
  /**
   * Who is holding a Destiny Bond that has just gone off, and so takes the
   * next Pokémon down the other end with them.
   */
  let bonded: Credit | null = null
  /** Who threw the Future Sight that is still in the air. */
  let future: Credit | null = null
  /*
   * What each Pokémon clicked, and what came of it.
   *
   * Keyed by side, slot and move name. Damage is read off the health the
   * log prints after each hit, against the health it printed before — the
   * lines are percentages, so this is percentage points and needs no stats
   * to work out.
   */
  const clicked: Record<string, Record<number, Record<string, MoveTally>>> = { p1: {}, p2: {} }
  const tally = (c: Credit, name: string): MoveTally => {
    const forSlot = (clicked[c.side][c.index] ??= {})
    return (forSlot[name] ??= {
      name, used: 0, kos: 0, damage: 0, rolls: 0, misses: 0, expHits: 0,
      critRolls: 0, crits: 0, expCrits: 0, procRolls: 0, procs: 0, expProcs: 0,
    })
  }
  /**
   * One side of a roll, as much of it as the log gave away.
   *
   * Everything optional here is genuinely optional: an unknown ability or
   * item simply does not apply, which leaves the listed odds standing.
   */
  function fighterAt(slot: string): Fighter {
    const who = active[slot]
    const side = slot.slice(0, 2)
    const name = who != null ? teams[side]?.[who] : null
    const species = (name && data?.dex[toId(name)]) || null
    const key = `${side}-${who}`
    return {
      species,
      ability: abilityOf[key] ?? onlyAbility(species) ?? null,
      item: itemOf[key] ?? null,
      types: typesOf[slot] ?? species?.types ?? [],
      status: statusOf[slot] ?? null,
      accuracy: stages[slot]?.accuracy ?? 0,
      evasion: stages[slot]?.evasion ?? 0,
    }
  }

  /**
   * What one roll was worth, all three kinds at once.
   *
   * Without the datasets there is nothing to read the odds off, so the move
   * is taken as a certainty and the other two sit out. That is also what a
   * line reported before any of this existed looks like.
   */
  /*
   * Whether a move's effect is an extra at all.
   *
   * Will-O-Wisp's burn, Thunder Wave's paralysis, Parting Shot's two drops:
   * those are the move, not a roll on top of it, and the accuracy roll is
   * what they were riding on. Counted as extras they are a numerator with
   * no denominator under it.
   */
  const isExtra = (move: string) =>
    !data || !!data.moves[toId(move)]?.secondaryChance

  function oddsOf(from: string | null, at: string, move: string) {
    const entry = data?.moves[toId(move)]
    if (!entry || !from) return { hit: 1, crit: null, proc: null }
    const shot = {
      move: entry,
      attacker: fighterAt(from),
      target: fighterAt(at),
      field: { ...field, safeguard: guarded.has(at.slice(0, 2)) },
    }
    return { hit: hitChance(shot), crit: critChance(shot), proc: procChance(shot) }
  }

  /** Health each position is on, out of a hundred, for reading damage off. */
  const health: Record<string, number> = {}
  /** The move being resolved, so the damage lines under it belong to it. */
  let resolving: Credit | null = null
  /** Where the move being resolved was thrown from, to match a miss to it. */
  let thrownFrom: string | null = null
  /*
   * The positions the move being resolved has rolled accuracy against.
   *
   * The log says which targets a move reached — `[spread]` lists them, and
   * a miss names its own — so a chance to miss is counted per target
   * rather than per click. A Rock Slide that catches one and misses the
   * other had two chances and took one of them.
   */
  let rolledAt = new Map<string, number>()
  /** Targets the move being resolved has already been credited a proc on. */
  let proccedAt = new Set<string>()
  /*
   * The battle around the roll, which is half of what decides the odds.
   *
   * A Hurricane in rain cannot miss, a Blizzard in snow cannot miss, a burn
   * cannot find a Fire type and a Safeguard turns one away. All of it is
   * read off the log; none of it is assumed.
   */
  const field: Field = { weather: '', terrain: '', gravity: false, safeguard: false }
  const guarded = new Set<string>()
  /** Accuracy and evasion stages, by position, cleared when somebody leaves. */
  const stages: Record<string, { accuracy: number; evasion: number }> = {}
  /*
   * What the log gave away about each Pokémon, kept by team slot so it
   * survives a switch. Abilities come from an open team sheet where there
   * is one, from the ones the battle announces, and from the dex where a
   * species has only one to choose from. Where none of those says, it
   * stays null and no modifier is applied — a wrong correction is worse
   * than a missing one.
   */
  const abilityOf: Record<string, string> = {}
  const itemOf: Record<string, string> = {}
  /** Types as they stand, which a Terastal or a forme change moves. */
  const typesOf: Record<string, string[]> = {}
  /**
   * Targets the move being resolved has landed on, kept so a knockout can
   * take the hit back off the count of places its extra effect could have
   * gone. Cleared once the turn moves past the move that filled it.
   */
  let struck = new Map<string, { proc: number | null; flinch: boolean }>()
  /** Who has already acted this turn, which is what a flinch turns on. */
  const movedThisTurn = new Set<string>()
  /**
   * Flinch chances still waiting on their target to take a turn.
   *
   * A flinch only ever shows when the Pokémon it landed on comes to move.
   * One knocked out by the other attack that turn never gets there, and
   * the roll goes unreported however it went — so it comes back off at
   * the end of the turn rather than counting as a chance that failed.
   */
  let pendingEarly: { credit: Credit; slot: string; chance: number }[] = []
  /** What each position is suffering, so a second status is not a new roll. */
  const statusOf: Record<string, string> = {}

  let winner: string | null = null

  for (const raw of log.split('\n')) {
    if (!raw.startsWith('|')) continue
    const parts = raw.split('|')
    const kind = parts[1]

    /*
     * Revival Blessing, which Showdown reports as a heal on the benched
     * Pokemon tagged with the move rather than as an event of its own. Matched
     * on the tag wherever it appears in the line, because the line it appears
     * on has changed before and the tag has not.
     *
     * The Pokemon is on the bench, so its slot is not in `active` and has to
     * be found by name — through the nicknames seen on the way in, since
     * the name a log uses is whatever its coach called it.
     */
    if (parts.some((part) => /\[from\]\s*move:\s*Revival Blessing/i.test(part))) {
      const who = parseIdent(parts[2] ?? '')
      // Through the nickname it was switched in under, where there is one.
      const index = who
        ? named[who.side]?.[who.name] ?? teamIndex(teams[who.side], who.name)
        : null
      if (who && index != null && (deaths[who.side][index] ?? 0) > 0) {
        deaths[who.side][index] -= 1
        const credited = creditedTo[who.side][index]
        if (credited) {
          kills[credited.side][credited.index] = Math.max(0, (kills[credited.side][credited.index] ?? 0) - 1)
          // And off the move that was credited with it, or a Pokemon's
          // knockouts and its moves' would stop adding up to each other.
          const was = tally(credited, credited.move)
          was.kos = Math.max(0, was.kos - 1)
        }
        creditedTo[who.side][index] = null
        revived[who.side][index] = (revived[who.side][index] ?? 0) + 1
      }
      continue
    }

    /*
     * Where the accuracy ladder stands, noted in passing rather than in the
     * chain below. A stat knocked down is also how a move's extra effect
     * announces itself, and a branch of its own here would swallow the line
     * before the effect could be counted — which is what it did, and took
     * every Snarl, Icy Wind and Electroweb in the league with it.
     */
    if (kind === '-boost' || kind === '-unboost' || kind === '-setboost') {
      const slot = (parts[2] ?? '').split(':')[0].trim()
      const stat = (parts[3] ?? '').trim()
      if (stat === 'accuracy' || stat === 'evasion') {
        const at = (stages[slot] ??= { accuracy: 0, evasion: 0 })
        const by = Number(parts[4] ?? 0) || 0
        const now = kind === '-setboost' ? by : at[stat] + (kind === '-boost' ? by : -by)
        at[stat] = Math.max(-6, Math.min(6, now))
      }
    }

    if (kind === 'player' && parts[2] && parts[3]) {
      accounts[parts[2]] = parts[3]

    } else if (kind === 'poke' && parts[2] && parts[3]) {
      teams[parts[2]]?.push(speciesOf(parts[3]))

    } else if (kind === 'teampreview') {
      /*
       * How many of the six each side actually brings.
       *
       * `|teampreview|4` is the line every format here opens with, and
       * it is the only place the bring is stated: nothing in the log
       * says which four were chosen, only which of them were sent out.
       * Without a number the whole team is brought, and without the
       * line at all there was no preview.
       */
      picked = Number(parts[2]) || 0

    } else if (kind === 'switch' || kind === 'drag' || kind === 'replace') {
      const who = parseIdent(parts[2] ?? '')
      if (who) {
        const slot = (parts[2] ?? '').split(':')[0].trim()
        const index = teamIndex(teams[who.side], speciesOf(parts[3] ?? who.name))
        active[slot] = index
        named[who.side][who.name] = index
        brought[who.side]?.add(index)
        // Whatever it comes in on, which a dragged-in Pokemon may not be full.
        health[slot] = hpOf(parts[4] ?? '') ?? 100
        // And whatever it is already suffering, which the health field carries.
        const carried = /^\d+\s*\/\s*\d+\s+(\w+)/.exec((parts[4] ?? '').trim())
        if (carried) statusOf[slot] = carried[1]
        else delete statusOf[slot]
        struck.delete(slot)
        delete stages[slot]
        delete typesOf[slot]
        // The volatile goes when the Pokemon does, and the slot is about to
        // be somebody else's.
        delete perishedBy[slot]
        perishing.delete(slot)
        selfKO.delete(slot)
      }

    } else if (kind === '-weather') {
      const what = (parts[2] ?? '').trim()
      field.weather = what === 'none' ? '' : what

    } else if (kind === '-fieldstart' || kind === '-fieldend') {
      const what = (parts[2] ?? '').replace(/^move:\s*/i, '').trim()
      const on = kind === '-fieldstart'
      if (/gravity/i.test(what)) field.gravity = on
      else if (/terrain/i.test(what)) field.terrain = on ? what : ''

    } else if (kind === '-sidestart' || kind === '-sideend') {
      if (/safeguard/i.test(parts[3] ?? '')) {
        const side = (parts[2] ?? '').split(':')[0].trim().slice(0, 2)
        if (kind === '-sidestart') guarded.add(side)
        else guarded.delete(side)
      }

    } else if (kind === '-clearboost' || kind === '-clearallboost'
      || kind === '-clearnegativeboost' || kind === '-invertboost') {
      // Rare enough that getting the detail right is not worth guessing at:
      // whatever happened, the ladder is no longer where this reader left it.
      const slot = (parts[2] ?? '').split(':')[0].trim()
      if (kind === '-clearallboost') for (const key of Object.keys(stages)) delete stages[key]
      else delete stages[slot]

    } else if (kind === '-ability') {
      const who = parseIdent(parts[2] ?? '')
      const index = active[(parts[2] ?? '').split(':')[0].trim()]
      const named = (parts[3] ?? '').trim()
      if (who && index != null && named) abilityOf[`${who.side}-${index}`] = named

    } else if (kind === '-item' || kind === '-enditem') {
      const who = parseIdent(parts[2] ?? '')
      const index = active[(parts[2] ?? '').split(':')[0].trim()]
      const named = (parts[3] ?? '').trim()
      if (who && index != null && named) itemOf[`${who.side}-${index}`] = named

    } else if (kind === '-terastallize') {
      const slot = (parts[2] ?? '').split(':')[0].trim()
      const type = (parts[3] ?? '').trim()
      if (type) typesOf[slot] = [type]

    } else if (kind === 'showteam') {
      /*
       * An open team sheet, which a handful of these games carry. It is the
       * one place the log says outright what a Pokémon is holding and which
       * ability it brought, so where it is there, it is taken.
       */
      const side = (parts[2] ?? '').trim()
      /*
       * The sheet is a packed team, and a packed team is itself full of
       * pipes — so it has to be put back together before it can be taken
       * apart. Split on the outer separator alone and every Pokémon here
       * is a bare species with no item and no ability after it, which is
       * exactly as useful as not reading the line.
       */
      parts.slice(3).join('|').split(']').forEach((entry) => {
        const bits = entry.split('|')
        const species = (bits[1] || bits[0] || '').trim()
        if (!species || !teams[side]) return
        const index = teams[side].findIndex((t) => baseOf(t) === baseOf(species))
        if (index < 0) return
        if (bits[2]) itemOf[`${side}-${index}`] = bits[2].trim()
        if (bits[3]) abilityOf[`${side}-${index}`] = bits[3].trim()
      })

    } else if (kind === 'turn' || kind === 'upkeep') {
      // Everything after this belongs to the next move, not the last one.
      struck.clear()
      if (kind === 'turn') {
        for (const waiting of pendingEarly) {
          if (movedThisTurn.has(waiting.slot)) continue
          const row = tally(waiting.credit, waiting.credit.move)
          row.procRolls = Math.max(0, row.procRolls - 1)
          row.expProcs = Math.max(0, row.expProcs - waiting.chance)
        }
        pendingEarly = []
        movedThisTurn.clear()
      }

    } else if (kind === 'move') {
      struck = new Map()
      movedThisTurn.add((parts[2] ?? '').split(':')[0].trim())
      const user = parseIdent(parts[2] ?? '')
      const target = parseIdent(parts[4] ?? '')
      const at = user ? attackerAt(parts[2] ?? '', user) : null
      const named = (parts[3] ?? '').trim()
      const attacker: Credit | null = at && named ? { ...at, move: named } : null
      /*
       * The move being resolved, so the damage under it is its own. It is
       * cleared by the next move rather than at the end of the turn: a
       * move and the damage it causes are not interleaved with anything,
       * and damage from any other source carries `[from]` and is skipped.
       */
      resolving = attacker
      if (attacker) tally(attacker, named).used += 1
      if (attacker && target) {
        lastHitBy[(parts[4] ?? '').split(':')[0].trim()] = attacker
      }
      // Who to credit when the counters run out, a few turns from now.
      if (attacker && named === 'Perish Song') singer = attacker
      // And who threw the one that lands the turn after next.
      if (attacker && FUTURE.has(named)) future = attacker
      /*
       * A Pokémon that is about to finish itself off. Marked on the slot
       * rather than acted on here, because the faint comes later in the
       * turn and whatever else happens in between must not clear it.
       */
      if (SELF_KO.has(named)) selfKO.add((parts[2] ?? '').split(':')[0].trim())
      // A spread move names one target but hits several; the tag lists the rest.
      const spread = parts.find((p) => p.startsWith('[spread]'))
      if (attacker && spread) {
        for (const slot of spread.replace('[spread]', '').trim().split(',')) {
          if (slot.trim()) lastHitBy[slot.trim()] = attacker
        }
      }

      /*
       * Where it landed is where it rolled: the named target, plus whatever
       * the spread tag lists. A target it missed joins when the miss line
       * names it, and one a Protect ate comes back off below.
       */
      thrownFrom = (parts[2] ?? '').split(':')[0].trim() || null
      rolledAt = new Map<string, number>()
      proccedAt = new Set<string>()
      const aimed: string[] = []
      const aimedAt = (parts[4] ?? '').split(':')[0].trim()
      if (aimedAt) aimed.push(aimedAt)
      if (spread) {
        for (const slot of spread.replace('[spread]', '').trim().split(',')) {
          if (slot.trim()) aimed.push(slot.trim())
        }
      }
      // Each target is its own roll, and each roll its own odds — the same
      // Hurricane is a certainty in rain and a coin flip in sun.
      if (attacker) {
        const row = tally(attacker, named)
        for (const at of new Set(aimed)) {
          const chance = oddsOf(thrownFrom, at, named).hit
          rolledAt.set(at, chance)
          row.rolls += 1
          row.expHits += chance
        }
      }

    } else if (kind === 'detailschange') {
      // Says what a Pokémon turned into but not why, and most of the reasons
      // are not a different Pokémon: Aegislash drawing its blade, Mimikyu's
      // busted disguise, Palafin in hero form. Held until a line says which.
      const who = parseIdent(parts[2] ?? '')
      if (who) becoming[(parts[2] ?? '').split(':')[0].trim()] = speciesOf(parts[3] ?? '')

    } else if (kind === '-mega' || kind === '-primal') {
      /*
       * Mega Evolution renames the Pokémon, and for this league that is a
       * different draft pick.
       *
       * Team preview shows a Mega as the thing it evolves from — the log reads
       * `|poke|p2|Gyarados, F|item` and only becomes Gyarados-Mega on the turn
       * it evolves. Season 5 drafts the two apart, so Gyarados-Mega is a
       * 14-point entry and plain Gyarados is banned; left as previewed, every
       * knockout it scored would be filed against a Pokémon nobody drafted.
       *
       * Only the name changes. The slot, and so the kills and deaths counted
       * against it, is the one it has had since the preview.
       */
      const who = parseIdent(parts[2] ?? '')
      const slot = (parts[2] ?? '').split(':')[0].trim()
      const species = becoming[slot]
      const index = active[slot]
      if (who && species && index != null) teams[who.side][index] = species

    } else if (kind === '-activate' && /move:\s*Destiny Bond/i.test(parts[3] ?? '')) {
      /*
       * The bond going off. The Pokémon holding it is already on its way
       * down and takes its killer with it, so the next faint on the other
       * side is theirs — their own, which comes either side of this line,
       * is not.
       */
      const slot = (parts[2] ?? '').split(':')[0].trim()
      const who = parseIdent(parts[2] ?? '')
      const index = active[slot]
      if (who && index != null) bonded = { side: who.side, index, move: 'Destiny Bond' }

    } else if (kind === '-crit') {
      /*
       * A critical hit, which is the other roll a move makes on the way in.
       * Credited to the move being resolved, and only against the other
       * side — a spread move critting its own partner is not a windfall.
       */
      const hurt = parseIdent(parts[2] ?? '')
      if (resolving && hurt && hurt.side !== resolving.side) {
        tally(resolving, resolving.move).crits += 1
      }

    } else if (kind === '-curestatus') {
      delete statusOf[(parts[2] ?? '').split(':')[0].trim()]

    } else if (kind === '-status' || kind === '-unboost'
      || (kind === '-start' && !/^perish\d$/i.test((parts[3] ?? '').trim()))) {
      /*
       * A move's extra effect landing: a status, a stat knocked down,
       * confusion. Taken as the move's own only where the log does not
       * credit it to something else — `[from] ability: Static` is the
       * Pokemon being hit getting its own back, and `[from] move: Sleep
       * Powder` is a move whose whole purpose this was.
       *
       * Once per target per use. A move that drops two stats prints two
       * lines and rolled once.
       */
      const at = (parts[2] ?? '').split(':')[0].trim()
      const who = parseIdent(parts[2] ?? '')
      const credited = parts.some((part) => part.startsWith('[from]'))
      if (resolving && who && who.side !== resolving.side && !credited && !proccedAt.has(at)
        && isExtra(resolving.move)) {
        proccedAt.add(at)
        tally(resolving, resolving.move).procs += 1
      }
      // Read after the proc, so a move inflicting a status does not count
      // the target as having had one when it landed.
      if (kind === '-status') statusOf[at] = (parts[3] ?? '').trim()

    } else if (kind === 'cant') {
      // Its turn is spent either way, so nothing landing after this can
      // flinch it, and a flinch waiting on it has had its answer.
      const slot = (parts[2] ?? '').split(':')[0].trim()
      movedThisTurn.add(slot)
      if ((parts[3] ?? '').trim() !== 'flinch') continue
      /*
       * A flinch, which the log only mentions when the flinched Pokemon
       * comes to move — by which time the move that caused it is several
       * lines back. Whoever hit it last this turn is who flinched it:
       * flinching only works from a hit that landed before it moved, and
       * the volatile is gone by the next turn.
       */
      const by = lastHitBy[slot]
      if (by && isExtra(by.move)) tally(by, by.move).procs += 1

    } else if (kind === '-miss') {
      /*
       * An accuracy roll that failed. The move line carries a `[miss]` tag
       * saying the same thing, but only this line says which target, and a
       * spread move can miss one and catch the other.
       */
      const first = (parts[2] ?? '').split(':')[0].trim()
      const second = (parts[3] ?? '').split(':')[0].trim()
      // `|-miss|SOURCE|TARGET`, or just the target on the older shape.
      const source: string | null = second ? first : thrownFrom
      const at = second || first
      if (resolving && source === thrownFrom) {
        const row = tally(resolving, resolving.move)
        if (at && !rolledAt.has(at)) {
          const chance = oddsOf(thrownFrom, at, resolving.move).hit
          rolledAt.set(at, chance)
          row.rolls += 1
          row.expHits += chance
        }
        row.misses += 1
      }

    } else if (kind === '-immune' || kind === '-fail' || kind === '-block'
      || (kind === '-activate' && GUARDS.test(parts[3] ?? ''))) {
      /*
       * Stopped before it could roll. Taken off only where the slot was
       * counted as a target of the move being resolved, so an ability
       * message about something else cannot discount a roll.
       */
      const at = (parts[2] ?? '').split(':')[0].trim()
      const swallowed = rolledAt.get(at)
      if (resolving && swallowed != null) {
        rolledAt.delete(at)
        const row = tally(resolving, resolving.move)
        row.rolls -= 1
        row.expHits -= swallowed
      }

    } else if (kind === '-end' && FUTURE.has((parts[3] ?? '').replace(/^move:\s*/i, '').trim())) {
      /*
       * A Future Sight landing. The damage line after this one carries no
       * `[from]`, so without this the hit reads as whoever last moved
       * against the target — which may be nobody, and is rarely the
       * Pokémon that actually threw it two turns ago.
       */
      const slot = (parts[2] ?? '').split(':')[0].trim()
      if (future) lastHitBy[slot] = future
      future = null

    } else if (kind === '-start' && /^perish\d$/.test((parts[3] ?? '').trim())) {
      const slot = (parts[2] ?? '').split(':')[0].trim()
      /*
       * The first of these lines for a slot is the song landing on it, and
       * the rest are the count ticking down. Only the first names the
       * singer: where two are sung, the second does not re-apply to
       * anything already counting, and overwriting here would hand those
       * kills to whoever sang last.
       *
       * Taken from the first line rather than from the `[silent]` tag the
       * application carries, so this still works if that line is not in
       * the log.
       */
      if (!(slot in perishedBy)) perishedBy[slot] = singer
      if ((parts[3] ?? '').trim() === 'perish0') perishing.add(slot)

    } else if (kind === '-damage' || kind === '-heal' || kind === '-sethp') {
      const slot = (parts[2] ?? '').split(':')[0].trim()
      const was = health[slot] ?? 100
      const now = hpOf(parts[3] ?? '') ?? was
      const indirect = parts.some((p) => p.startsWith('[from]'))
      health[slot] = now
      if (kind !== '-damage') continue
      // Damage from weather, status or an item has no attacker to credit.
      // It also marks the end of the move's own lines, after which a faint
      // is nothing to do with what the move landed.
      if (indirect) { lastHitBy[slot] = null; struck.clear(); continue }
      /*
       * Everything else under a move belongs to it. Counted only against
       * the other side: a spread move catching its own partner has done
       * damage, but not the kind anybody wants totalled against its name.
       */
      const hurt = parseIdent(parts[2] ?? '')
      if (resolving && hurt && hurt.side !== resolving.side && now < was) {
        const row = tally(resolving, resolving.move)
        row.damage += was - now
        /*
         * Somewhere its extra effect could have gone, counted the moment
         * the hit lands rather than at the end of the move — this is when
         * the target's state is the one the effect would have met. Taken
         * back below if the hit turns out to have knocked it out.
         */
        if (!struck.has(slot)) {
          const odds = oddsOf(thrownFrom, slot, resolving.move)
          /*
           * A critical hit is rolled on the way in, so it counts whatever
           * becomes of the target: a crit that knocks something out is
           * still a crit, and the log still says so.
           */
          if (odds.crit != null) {
            row.critRolls += 1
            row.expCrits += odds.crit
          }
          /*
           * The extra effect is another matter. It needs a target left
           * standing, and a flinch needs one still to move — neither of
           * which is known yet, so the roll goes on the books now and
           * comes off again if it turns out it never had anywhere to land.
           */
          const early = !movedThisTurn.has(slot)
          const flinch = data?.moves[toId(resolving.move)]?.secondaryKind === 'flinch'
          const proc = odds.proc != null && (!flinch || early) ? odds.proc : null
          struck.set(slot, { proc, flinch })
          if (proc != null) {
            row.procRolls += 1
            row.expProcs += proc
            if (flinch) pendingEarly.push({ credit: resolving, slot, chance: proc })
          }
        }
      }

    } else if (kind === 'faint') {
      const who = parseIdent(parts[2] ?? '')
      if (!who) continue
      const slot = (parts[2] ?? '').split(':')[0].trim()
      const index = active[slot] ?? teamIndex(teams[who.side], who.name)
      deaths[who.side][index] = (deaths[who.side][index] ?? 0) + 1
      /*
       * A Pokémon the move being resolved has just knocked out was never
       * somewhere its extra effect could land, so the hit comes back off
       * that count.
       */
      const how = resolving ? struck.get(slot) : undefined
      if (resolving && how && how.proc != null) {
        struck.delete(slot)
        const row = tally(resolving, resolving.move)
        row.procRolls = Math.max(0, row.procRolls - 1)
        row.expProcs = Math.max(0, row.expProcs - how.proc)
        const waiting = pendingEarly.findIndex((e) => e.slot === slot && e.credit === resolving)
        if (waiting >= 0) pendingEarly.splice(waiting, 1)
      }
      // Recorded here rather than inferred from the death afterwards: a revive
      // takes the death back, and a Pokemon that fainted was on the field
      // whether or not the faint ends up counting.
      brought[who.side]?.add(index)

      /*
       * The song beats the last hit, where the count is what killed it: a
       * perished Pokémon can have been hit by anybody in the meantime and
       * the hit is not what finished it. A Pokémon downed by something
       * else while perished still goes to whoever hit it, since only a
       * counter at zero sets this.
       */
      /*
       * In order: its own doing beats everything, then the song, then a
       * bond going off at the other end, then the last hit.
       */
      const bond = bonded && bonded.side !== who.side ? bonded : null
      const killer = selfKO.has(slot) ? null
        : perishing.has(slot) ? perishedBy[slot] ?? null
          : bond ?? lastHitBy[slot]
      if (bond) bonded = null
      selfKO.delete(slot)
      perishing.delete(slot)
      delete perishedBy[slot]
      // Its own side's Perish Song is not a knockout for its own side, which
      // the check below already says — a song hits everyone, singer included.
      if (killer && killer.side !== who.side) {
        kills[killer.side][killer.index] = (kills[killer.side][killer.index] ?? 0) + 1
        // And against the move that did it, which is the other half of a
        // move's record: how often it was clicked, and what it finished.
        tally(killer, killer.move).kos += 1
      }
      health[slot] = 0
      creditedTo[who.side][index] = killer && killer.side !== who.side ? killer : null
      lastHitBy[slot] = null

    } else if (kind === 'win') {
      const name = (parts[2] ?? '').trim()
      winner = accounts.p1 === name ? 'p1' : accounts.p2 === name ? 'p2' : null
    }
  }

  /** The team slot the attacker occupies, resolving it if it never switched in. */
  function attackerAt(identToken: string, who: { side: string; name: string }) {
    const slot = identToken.split(':')[0].trim()
    const index = active[slot] ?? teamIndex(teams[who.side], who.name)
    return { side: who.side, index }
  }

  const sideOf = (key: 'p1' | 'p2'): ReplaySide => ({
    account: accounts[key],
    team: teams[key],
    lines: teams[key].map((mon, i) => ({
      pokemon: mon,
      kills: kills[key][i] ?? 0,
      deaths: deaths[key][i] ?? 0,
      // A Pokémon that fainted was plainly on the field, even in the odd log
      // where its switch-in is missing.
      brought: brought[key].has(i) || (deaths[key][i] ?? 0) > 0,
      revived: revived[key][i] ?? 0,
      // Most-used first, which is the order a set is read in.
      moves: Object.values(clicked[key][i] ?? {})
        .map((m) => ({
          ...m,
          damage: Math.round(m.damage),
          // A miss is a roll, whatever else happened in the same resolution.
          rolls: Math.max(0, m.rolls, m.misses),
          expHits: round2(m.expHits),
          expCrits: round2(m.expCrits),
          expProcs: round2(m.expProcs),
        }))
        .sort((x, y) => y.used - x.used || y.kos - x.kos || x.name.localeCompare(y.name)),
    })),
  })

  const a = sideOf('p1')
  const b = sideOf('p2')
  const won = winner === 'p1' ? 'a' : winner === 'p2' ? 'b' : null
  /*
   * What the winner had left standing, which is the tiebreaker the rules
   * call Pokémon Differential.
   *
   * Counted off the bring and not off what came out. A Pokémon held in
   * reserve and never revealed is a Pokémon that never fainted, and it
   * was being left out of the count entirely — a side that won having
   * shown two of its four read as two left when it had four. Twenty-one
   * of this season's games were short by one or two that way.
   *
   * The bring is the team preview's own number where the log states one,
   * and what was seen where it does not: an older log with no preview
   * line brought whatever it showed.
   */
  const winSide = won === 'a' ? a : won === 'b' ? b : null
  const shown = winSide ? winSide.lines.filter((l) => l.brought).length : 0
  const bring = winSide ? Math.min(picked || shown, winSide.lines.length) : 0
  // Down and still down: a Revival Blessing puts one back on its feet,
  // and a Pokémon that fainted twice fainted once more than it came back.
  const down = winSide ? winSide.lines.filter((l) => l.deaths > l.revived).length : 0

  return { format, winner: won, a, b, survivors: Math.max(0, bring - down) }
}

/** Two places is far finer than anything read off these, and keeps rows small. */
const round2 = (n: number) => Math.round(n * 100) / 100

/** Same normalisation the dex is keyed by. */
const toId = (s: string) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The ability a Pokémon must have, where it has no choice.
 *
 * Which of two or three a coach brought is not in the log, and guessing it
 * would put a correction on the board that nobody can check. Where there is
 * only one — every Mega, and a third of the rest — there is nothing to guess.
 */
function onlyAbility(species: { abilities?: Record<string, string> } | null): string | null {
  const all = Object.values(species?.abilities ?? {})
  return all.length === 1 ? all[0] : null
}
