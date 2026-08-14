/**
 * Invents per-game detail for matches that only ever recorded series totals.
 *
 * THIS WRITES DATA THAT DID NOT HAPPEN. It exists because the test season needs
 * something game-shaped to look at, and the spreadsheet it came from never
 * recorded games — only one set of numbers per match covering all two or three.
 * Do not run it against a season anyone trusts.
 *
 * What it will not do is contradict the real record, or invent a game that
 * could not have happened:
 *   - the number of games equals the real series score and the per-game winners
 *     add up to it, so standings cannot move;
 *   - the loser of a game loses all four it brought, because that is how a game
 *     ends, and the winner keeps at least one;
 *   - a Pokemon dies at most once per game, and at most four are brought.
 *
 * The one thing it cannot always honour is each Pokemon's own match totals. The
 * rule above fixes how many deaths a side takes in each game, and the
 * spreadsheet's per-Pokemon totals do not always divide that way — 46 of about
 * 420 lines come out short. The totals themselves are untouched in
 * `match_lines`, which is what the rankings read, so nothing derived is wrong;
 * only the invented split does not add back up on those lines.
 *
 * The replay each game links to is a stand-in — one real battle shared by all
 * of them — since an invented game has no replay of its own.
 *
 * Every row is stamped `generated`, so undoing it is one delete:
 *   curl -X DELETE "$URL/rest/v1/games?edited_by=eq.generated" -H ...
 * which cascades to the game lines.
 *
 * Matches that already have games are left alone — a real report is never
 * overwritten by an invented one.
 *
 * Usage: node scripts/fabricate-games.mjs [--dry-run]
 */

const URL_ = process.env.SUPABASE_URL ?? 'https://skborcymmwraaycgygga.supabase.co'
const KEY = process.env.SUPABASE_KEY ?? 'sb_publishable_oGfMOvaA4kh1tvmws_iA7Q_PMbZUjPq'
const DRY = process.argv.includes('--dry-run')

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

/**
 * Reads a table whole.
 *
 * PostgREST stops at a thousand rows and does not say so in the body, so a
 * single GET silently returns a prefix. Paging is the only way to be sure.
 */
const get = async (path) => {
  const out = []
  const join = path.includes('?') ? '&' : '?'
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${URL_}/rest/v1/${path}${join}limit=1000&offset=${from}`, { headers })
    if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
    const page = await res.json()
    out.push(...page)
    if (page.length < 1000) return out
  }
}

const post = async (table, rows) => {
  if (!rows.length) return []
  const res = await fetch(`${URL_}/rest/v1/${table}`, {
    method: 'POST', headers, body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

/** Seeded, so a re-run produces the same season rather than a different one. */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const VGC_BRING = 4

/**
 * A stand-in replay for games that never happened.
 *
 * These games are invented, so none of them has a replay of its own. Pointing
 * them all at one real battle is a placeholder so the link reads as a link —
 * it is emphatically not this game, and every one of them points at the same
 * place, which is the giveaway.
 */
const PLACEHOLDER_REPLAY = 'https://replay.pokemonshowdown.com/gen96v6doublesdraft-2661971751'

/**
 * Which of a side's Pokemon die in each game.
 *
 * The rule that shapes everything: you lose a game when your whole team is
 * knocked out, so the loser of a game loses all four it brought, and the winner
 * loses at most three. Deaths are therefore not free to place — every lost game
 * costs exactly four, and only the remainder can be spread across games won.
 *
 * Returns one array per game of the Pokemon brought, each flagged as dying or
 * surviving.
 */
function deathsPerGame(lines, winners, side, rand) {
  const games = winners.length
  const state = lines.map((l) => ({
    pokemon_id: l.pokemon_id, killsLeft: l.kills, deathsLeft: l.deaths, seen: 0,
  }))
  const lost = winners.filter((w) => w !== side).length
  const total = state.reduce((n, p) => n + p.deathsLeft, 0)

  // Everything not accounted for by lost games happened in games won.
  let spare = Math.max(0, total - VGC_BRING * lost)
  const wins = games - lost

  return winners.map((w, i) => {
    const isLoss = w !== side
    const winsLeft = wins - winners.slice(0, i).filter((x) => x === side).length
    // At most three of yours fall in a game you win — a fourth would be a loss.
    const dying = isLoss
      ? VGC_BRING
      : Math.min(3, winsLeft > 0 ? Math.round(spare / winsLeft) : spare)
    if (!isLoss) spare -= dying

    // Whoever still has deaths to account for is on the field, since a death
    // can only happen to something that was brought.
    const order = [...state].sort((a, b) =>
      b.deathsLeft - a.deathsLeft
      || (b.killsLeft - a.killsLeft)
      || a.seen - b.seen
      || rand() - 0.5)
    const brought = order.slice(0, VGC_BRING)
    for (const p of brought) p.seen++

    // The ones with the most deaths still owed are the ones that fall here.
    const casualties = [...brought]
      .sort((a, b) => b.deathsLeft - a.deathsLeft || rand() - 0.5)
      .slice(0, dying)
    const fell = new Set(casualties.map((p) => p.pokemon_id))
    for (const p of casualties) p.deathsLeft = Math.max(0, p.deathsLeft - 1)

    return brought.map((p) => ({
      pokemon_id: p.pokemon_id,
      deaths: fell.has(p.pokemon_id) ? 1 : 0,
      kills: 0,
      brought: true,
    }))
  })
}

/**
 * Hands out each side's knockouts across the games it played them in.
 *
 * A game's knockouts are the other side's deaths in that game, so the two are
 * dealt together rather than invented separately. Anything a Pokemon is still
 * owed at the end is pushed into a game it played, which is where the odd
 * indirect knockout — weather, recoil — lands anyway.
 */
function assignKills(mine, theirs, lines) {
  const budget = new Map(lines.map((l) => [l.pokemon_id, l.kills]))

  mine.forEach((game, i) => {
    let target = theirs[i].reduce((n, x) => n + x.deaths, 0)
    for (const row of game) {
      if (target <= 0) break
      const have = budget.get(row.pokemon_id) ?? 0
      const take = Math.min(have, target)
      row.kills += take
      budget.set(row.pokemon_id, have - take)
      target -= take
    }
  })

  // Whatever is left over still belongs to that Pokemon's record.
  for (const [id, left] of budget) {
    let owed = left
    for (let i = mine.length - 1; i >= 0 && owed > 0; i--) {
      const row = mine[i].find((x) => x.pokemon_id === id)
      if (!row) continue
      row.kills += owed
      owed = 0
    }
  }
  return mine
}

/** The six previewed, with the ones that did not play marked as bench. */
function withBench(played, lines) {
  const on = new Set(played.map((p) => p.pokemon_id))
  return [
    ...played,
    ...lines.filter((l) => !on.has(l.pokemon_id))
      .map((l) => ({ pokemon_id: l.pokemon_id, kills: 0, deaths: 0, brought: false })),
  ]
}

/**
 * Builds a side's six from the rosters of whoever played on it.
 *
 * A handful of matches have a result but no per-Pokemon lines at all — the
 * sheet recorded who won and the stats tab was never filled in. There is
 * nothing to split for those, so the team is taken from what those players
 * actually drafted and the game invented from the rules alone.
 *
 * Only `game_lines` are written, never `match_lines`, so the Pokemon rankings
 * -- which read the match totals -- do not move because of this.
 */
function teamFromRosters(playerIds, rosters, rand) {
  const pool = playerIds.flatMap((id) => rosters.get(id) ?? [])
  const shuffled = [...new Set(pool)].sort(() => rand() - 0.5)
  return shuffled.slice(0, 6).map((pokemon_id) => ({ pokemon_id, kills: 0, deaths: 0 }))
}

/**
 * Invents a game with no totals to honour: the loser brings four and loses all
 * four, the winner loses some of theirs, and the winner's knockouts are the
 * loser's losses.
 */
function inventGames(a, b, winners, rand) {
  const pick = (team) => [...team].sort(() => rand() - 0.5).slice(0, VGC_BRING)
  const out = { a: [], b: [] }
  for (const w of winners) {
    const rows = { a: pick(a), b: pick(b) }
    const loser = w === 'a' ? 'b' : 'a'
    // Losing means the whole team went down; the winner keeps at least one.
    const winnerLosses = Math.floor(rand() * 3)
    const lines = {}
    for (const side of ['a', 'b']) {
      const dying = side === loser ? VGC_BRING : winnerLosses
      lines[side] = rows[side].map((p, i) => ({
        pokemon_id: p.pokemon_id, kills: 0, deaths: i < dying ? 1 : 0, brought: true,
      }))
    }
    // Every knockout on one side is a death on the other.
    for (const side of ['a', 'b']) {
      const other = side === 'a' ? 'b' : 'a'
      let owed = lines[other].reduce((n, x) => n + x.deaths, 0)
      const alive = lines[side].filter((x) => !x.deaths)
      const pool = alive.length ? alive : lines[side]
      for (let i = 0; owed > 0; i = (i + 1) % pool.length) { pool[i].kills++; owed-- }
    }
    out.a.push(lines.a)
    out.b.push(lines.b)
  }
  return out
}

const matches = await get('matches?select=id,week,label,score_a,score_b&order=id')
const rosterRows = await get('rosters?select=player_id,pokemon_id')
const rosters = new Map()
for (const r of rosterRows) {
  rosters.set(r.player_id, [...(rosters.get(r.player_id) ?? []), r.pokemon_id])
}
const sides = new Map(
  (await get('matches?select=id,side_a,side_b')).map((m) => [m.id, m]))
const allLines = await get('match_lines?select=match_id,side,pokemon_id,kills,deaths&order=id')
const existing = await get('games?select=match_id')
const hasGames = new Set(existing.map((g) => g.match_id))

const linesBy = new Map()
for (const l of allLines) {
  const key = `${l.match_id}-${l.side}`
  linesBy.set(key, [...(linesBy.get(key) ?? []), l])
}

let made = 0, skipped = 0, noLines = 0
for (const m of matches) {
  if (hasGames.has(m.id)) { skipped++; continue }
  if (m.score_a === null || m.score_b === null) { skipped++; continue }

  const total = m.score_a + m.score_b
  if (!total) { skipped++; continue }
  const rand = rng(m.id * 7919)

  let a = linesBy.get(`${m.id}-a`) ?? []
  let b = linesBy.get(`${m.id}-b`) ?? []
  // No lines at all: build the teams from what those players drafted.
  const fromRosters = !a.length || !b.length
  if (fromRosters) {
    const s = sides.get(m.id)
    a = teamFromRosters(s?.side_a ?? [], rosters, rand)
    b = teamFromRosters(s?.side_b ?? [], rosters, rand)
    if (!a.length || !b.length) { noLines++; continue }
  }
  // Winners add up to the real score: the loser's wins sit in the middle,
  // which is where a series that goes long usually turns.
  const winners = [
    ...Array(m.score_a).fill('a'),
    ...Array(m.score_b).fill('b'),
  ]
  if (m.score_a && m.score_b) {
    winners.length = 0
    const lead = m.score_a > m.score_b ? 'a' : 'b'
    const trail = lead === 'a' ? 'b' : 'a'
    const trailWins = Math.min(m.score_a, m.score_b)
    for (let i = 0; i < total; i++) {
      winners.push(i === 1 && trailWins > 0 ? trail : lead)
    }
    // Keep the counts exact even when the shape above does not.
    let need = { a: m.score_a, b: m.score_b }
    for (let i = 0; i < winners.length; i++) {
      if (need[winners[i]] > 0) need[winners[i]]--
      else { const other = winners[i] === 'a' ? 'b' : 'a'; winners[i] = other; need[other]-- }
    }
  }

  let gamesA
  let gamesB
  if (fromRosters) {
    const made = inventGames(a, b, winners, rand)
    gamesA = made.a
    gamesB = made.b
  } else {
    gamesA = deathsPerGame(a, winners, 'a', rand)
    gamesB = deathsPerGame(b, winners, 'b', rand)
    assignKills(gamesA, gamesB, a)
    assignKills(gamesB, gamesA, b)
  }

  for (let i = 0; i < total; i++) {
    const side = winners[i] === 'a' ? gamesA[i] : gamesB[i]
    const winnerSurvivors = side.length - side.reduce((n, x) => n + x.deaths, 0)

    if (DRY) { made++; continue }
    const [row] = await post('games', [{
      match_id: m.id,
      number: i + 1,
      winner: winners[i],
      replay_url: PLACEHOLDER_REPLAY, // see above: a stand-in, not this game
      survivors: Math.max(0, winnerSurvivors),
      edited_by: 'generated',
    }])
    await post('game_lines', [
      ...withBench(gamesA[i], a).map((x) => ({ ...x, game_id: row.id, side: 'a', edited_by: 'generated' })),
      ...withBench(gamesB[i], b).map((x) => ({ ...x, game_id: row.id, side: 'b', edited_by: 'generated' })),
    ])
    made++
  }
}

console.log(`${DRY ? '[dry run] ' : ''}games ${DRY ? 'would be ' : ''}created: ${made}`)
console.log(`matches skipped (already had games, or no result): ${skipped}`)
console.log(`matches with a score but no lines: ${noLines}`)
