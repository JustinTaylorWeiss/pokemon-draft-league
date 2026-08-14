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
  }[]
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

/** `p1a: Iron Hands` -> { side: 'p1', name: 'Iron Hands' } */
function parseIdent(token: string): { side: string; name: string } | null {
  const match = /^(p[12])[a-z]?:\s*(.+)$/.exec(token.trim())
  return match ? { side: match[1], name: match[2].trim() } : null
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
  const lastHitBy: Record<string, { side: string; index: number } | null> = {}

  let winner: string | null = null

  for (const raw of log.split('\n')) {
    if (!raw.startsWith('|')) continue
    const parts = raw.split('|')
    const kind = parts[1]

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
      }

    } else if (kind === 'move') {
      const user = parseIdent(parts[2] ?? '')
      const target = parseIdent(parts[4] ?? '')
      const attacker = user ? attackerAt(parts[2] ?? '', user) : null
      if (attacker && target) {
        lastHitBy[(parts[4] ?? '').split(':')[0].trim()] = attacker
      }
      // A spread move names one target but hits several; the tag lists the rest.
      const spread = parts.find((p) => p.startsWith('[spread]'))
      if (attacker && spread) {
        for (const slot of spread.replace('[spread]', '').trim().split(',')) {
          if (slot.trim()) lastHitBy[slot.trim()] = attacker
        }
      }

    } else if (kind === '-damage') {
      // Damage from weather, status or an item has no attacker to credit.
      const slot = (parts[2] ?? '').split(':')[0].trim()
      if (parts.some((p) => p.startsWith('[from]'))) lastHitBy[slot] = null

    } else if (kind === 'faint') {
      const who = parseIdent(parts[2] ?? '')
      if (!who) continue
      const slot = (parts[2] ?? '').split(':')[0].trim()
      const index = active[slot] ?? teamIndex(teams[who.side], who.name)
      deaths[who.side][index] = (deaths[who.side][index] ?? 0) + 1

      const killer = lastHitBy[slot]
      if (killer && killer.side !== who.side) {
        kills[killer.side][killer.index] = (kills[killer.side][killer.index] ?? 0) + 1
      }
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
