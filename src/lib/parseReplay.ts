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

export async function fetchReplay(input: string): Promise<ReplayGame> {
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
  const data = await res.json()
  return parseReplayLog(data.log ?? '', data.format ?? '', data.players ?? [])
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

export function parseReplayLog(log: string, format = '', players: string[] = []): ReplayGame {
  const teams: Record<string, string[]> = { p1: [], p2: [] }
  const accounts: Record<string, string> = { p1: players[0] ?? 'p1', p2: players[1] ?? 'p2' }
  // Counted per team slot rather than per name, so a forme change cannot
  // scatter one Pokemon's record across two keys.
  const kills: Record<string, Record<number, number>> = { p1: {}, p2: {} }
  const deaths: Record<string, Record<number, number>> = { p1: {}, p2: {} }

  /** Which team slot is in each battle position, which the log does not say directly. */
  const active: Record<string, number> = {}
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
    return (forSlot[name] ??= { name, used: 0, kos: 0, damage: 0 })
  }
  /** Health each position is on, out of a hundred, for reading damage off. */
  const health: Record<string, number> = {}
  /** The move being resolved, so the damage lines under it belong to it. */
  let resolving: Credit | null = null

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
     * be found by name.
     */
    if (parts.some((part) => /\[from\]\s*move:\s*Revival Blessing/i.test(part))) {
      const who = parseIdent(parts[2] ?? '')
      const index = who ? teamIndex(teams[who.side], who.name) : null
      if (who && index != null && (deaths[who.side][index] ?? 0) > 0) {
        deaths[who.side][index] -= 1
        const credited = creditedTo[who.side][index]
        if (credited) {
          kills[credited.side][credited.index] = Math.max(0, (kills[credited.side][credited.index] ?? 0) - 1)
        }
        creditedTo[who.side][index] = null
        revived[who.side][index] = (revived[who.side][index] ?? 0) + 1
      }
      continue
    }

    if (kind === 'player' && parts[2] && parts[3]) {
      accounts[parts[2]] = parts[3]

    } else if (kind === 'poke' && parts[2] && parts[3]) {
      teams[parts[2]]?.push(speciesOf(parts[3]))

    } else if (kind === 'switch' || kind === 'drag' || kind === 'replace') {
      const who = parseIdent(parts[2] ?? '')
      if (who) {
        const slot = (parts[2] ?? '').split(':')[0].trim()
        const index = teamIndex(teams[who.side], speciesOf(parts[3] ?? who.name))
        active[slot] = index
        brought[who.side]?.add(index)
        // Whatever it comes in on, which a dragged-in Pokemon may not be full.
        health[slot] = hpOf(parts[4] ?? '') ?? 100
        // The volatile goes when the Pokemon does, and the slot is about to
        // be somebody else's.
        delete perishedBy[slot]
        perishing.delete(slot)
        selfKO.delete(slot)
      }

    } else if (kind === 'move') {
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
      if (indirect) { lastHitBy[slot] = null; continue }
      /*
       * Everything else under a move belongs to it. Counted only against
       * the other side: a spread move catching its own partner has done
       * damage, but not the kind anybody wants totalled against its name.
       */
      const hurt = parseIdent(parts[2] ?? '')
      if (resolving && hurt && hurt.side !== resolving.side && now < was) {
        tally(resolving, resolving.move).damage += was - now
      }

    } else if (kind === 'faint') {
      const who = parseIdent(parts[2] ?? '')
      if (!who) continue
      const slot = (parts[2] ?? '').split(':')[0].trim()
      const index = active[slot] ?? teamIndex(teams[who.side], who.name)
      deaths[who.side][index] = (deaths[who.side][index] ?? 0) + 1
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
        .map((m) => ({ ...m, damage: Math.round(m.damage) }))
        .sort((x, y) => y.used - x.used || y.kos - x.kos || x.name.localeCompare(y.name)),
    })),
  })

  const a = sideOf('p1')
  const b = sideOf('p2')
  const won = winner === 'p1' ? 'a' : winner === 'p2' ? 'b' : null
  // Survivors are counted from the team that actually brought Pokemon, so a
  // team preview of six does not inflate a four-Pokemon VGC bring.
  const winSide = won === 'a' ? a : won === 'b' ? b : null
  const played = winSide ? winSide.lines.filter((l) => l.brought).length : 0
  const lost = winSide ? winSide.lines.reduce((n, l) => n + l.deaths, 0) : 0

  return { format, winner: won, a, b, survivors: Math.max(0, played - lost) }
}
