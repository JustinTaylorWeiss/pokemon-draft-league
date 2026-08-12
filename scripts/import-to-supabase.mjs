/**
 * Loads a league.json into Supabase.
 *
 * This is how a season gets into the database — including this one, as test
 * data, so the two can be compared before anything switches over.
 *
 * READ-ONLY where the sheet is concerned: this reads the JSON that
 * import-league.mjs already produced. It never contacts the sheet and never
 * writes to it. See CLAUDE.md.
 *
 * Usage:
 *   node scripts/import-to-supabase.mjs [path/to/league.json] [--replace]
 *
 * Re-runnable. Tables with natural keys (players, board, rosters) are upserted.
 * Tables keyed by a generated id would duplicate on a second run, so importing
 * over existing ones needs --replace, which clears those tables first. Without
 * it the script stops rather than quietly doubling a season.
 *
 * Needs a key that can write. The publishable key in the app is fine for this —
 * editing is open by design — so no secret is required:
 *   SUPABASE_URL=... SUPABASE_KEY=... node scripts/import-to-supabase.mjs
 */
import { readFile } from 'node:fs/promises'

const URL_ = process.env.SUPABASE_URL ?? 'https://skborcymmwraaycgygga.supabase.co'
const KEY = process.env.SUPABASE_KEY ?? 'sb_publishable_oGfMOvaA4kh1tvmws_iA7Q_PMbZUjPq'
const ACTOR = process.env.SUPABASE_ACTOR ?? 'import'

// The flag can come before or after the path, so pick the first non-flag arg.
const file = process.argv.slice(2).find((a) => !a.startsWith('--'))
  ?? new URL('../public/data/league.json', import.meta.url).pathname

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

const REPLACE = process.argv.includes('--replace')

/** POSTs rows and fails loudly, since a refused write reports success. */
async function insert(table, rows, onConflict) {
  if (!rows.length) return []
  const url = onConflict
    ? `${URL_}/rest/v1/${table}?on_conflict=${onConflict}`
    : `${URL_}/rest/v1/${table}`
  const res = await fetch(url, {
    method: 'POST',
    headers: onConflict
      ? { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' }
      : headers,
    body: JSON.stringify(rows.map((r) => ({ ...r, edited_by: ACTOR }))),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${body.slice(0, 300)}`)
  const data = JSON.parse(body)
  if (data.length !== rows.length) {
    throw new Error(`${table}: sent ${rows.length} rows, ${data.length} landed`)
  }
  return data
}

async function upsertMeta(meta) {
  const res = await fetch(`${URL_}/rest/v1/league_meta?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify([{
      id: true,
      name: meta.name,
      regulation: meta.regulation,
      format: meta.format,
      weeks: meta.weeks,
      picks_per_player: meta.picksPerPlayer,
      series_length: meta.seriesLength,
      tier_limits: meta.tierLimits ?? {},
      edited_by: ACTOR,
    }]),
  })
  if (!res.ok) throw new Error(`league_meta: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
}

async function countRows(table) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...headers, Prefer: 'count=exact' },
  })
  return Number((res.headers.get('content-range') ?? '*/0').split('/')[1] || 0)
}

/** Clears only the tables that cannot be upserted, and only when asked. */
async function clearGenerated() {
  // match_lines goes with its matches; rosters and draft_picks are rebuilt whole.
  for (const [table, filter] of [
    ['matches', 'id=gt.0'],
    ['draft_picks', 'id=gt.0'],
    ['rules_sections', 'id=gt.0'],
    ['rosters', 'player_id=neq.__none__'],
  ]) {
    const res = await fetch(`${URL_}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers })
    if (!res.ok) throw new Error(`clearing ${table}: HTTP ${res.status}`)
  }
}

const league = JSON.parse(await readFile(file, 'utf8'))
const counts = {}

const existing = await countRows('matches')
if (existing && !REPLACE) {
  console.error(
    `There are already ${existing} matches in the database.\n` +
    'Re-run with --replace to clear the generated-key tables and import again.',
  )
  process.exit(1)
}
if (REPLACE) await clearGenerated()

await upsertMeta(league.meta ?? {})
counts.league_meta = 1

counts.players = (await insert('players', league.players.map((p) => ({
  id: p.id, seed: p.seed, name: p.name, team: p.team,
})), 'id')).length

counts.board = (await insert('board', Object.entries(league.board).map(([id, e]) => ({
  pokemon_id: id,
  name: e.name,
  tier: e.tier,
  note: e.note,
  drafted_by: null, // set below, once players exist and by id rather than name
  base_stats: e.baseStats ?? null,
  bst: e.bst ?? null,
})), 'pokemon_id')).length

// The sheet names who drafted each Pokemon; the database references the player
// row. Anything that does not resolve is left unclaimed rather than guessed at.
const byName = new Map(league.players.map((p) => [p.name, p.id]))
const claims = Object.entries(league.board)
  .filter(([, e]) => e.draftedBy && byName.has(e.draftedBy))
  .map(([id, e]) => ({ pokemon_id: id, drafted_by: byName.get(e.draftedBy) }))

for (const c of claims) {
  const res = await fetch(`${URL_}/rest/v1/board?pokemon_id=eq.${encodeURIComponent(c.pokemon_id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ drafted_by: c.drafted_by, edited_by: ACTOR }),
  })
  if (!res.ok) throw new Error(`board claim: HTTP ${res.status}`)
}
counts.board_claims = claims.length

counts.rosters = (await insert('rosters', Object.entries(league.rosters).flatMap(
  ([playerId, picks]) => picks.map((p) => ({
    player_id: playerId, pokemon_id: p.pokemon, tier: p.tier,
  })),
), 'player_id,pokemon_id')).length

counts.draft_picks = (await insert('draft_picks', (league.draft ?? [])
  .filter((d) => byName.has(d.player) || league.players.some((p) => p.id === d.player))
  .map((d) => ({
    round: d.round,
    pick: d.pick,
    player_id: byName.get(d.player) ?? d.player,
    pokemon_id: d.pokemon,
    tier: d.tier,
  })))).length

// Matches come from `schedule`, which carries the player ids and the series
// score, and their stat lines come from `matchStats`, which carries per-Pokemon
// kills and deaths. The two arrays describe the same 40 matches in the same
// order — verified by week and by the players' names appearing in the stats
// tab's team labels — so they are joined by position. They are not
// interchangeable: `schedule` scores a series 2-0 while `matchStats` counts
// knockouts 5-0, and standings are built from the former.
const schedule = league.schedule ?? []
const stats = league.matchStats ?? []
if (stats.length && schedule.length !== stats.length) {
  throw new Error(
    `schedule has ${schedule.length} matches and matchStats has ${stats.length}; ` +
    'they are joined by position, so a mismatch means the lines would attach to the wrong match',
  )
}

const inserted = await insert('matches', schedule.map((m, i) => ({
  week: m.week,
  label: stats[i] ? `${stats[i].a.team} vs ${stats[i].b.team}` : `Week ${m.week} match ${m.match}`,
  side_a: m.a,
  side_b: m.b,
  score_a: m.scoreA,
  score_b: m.scoreB,
})))
counts.matches = inserted.length

const lines = []
stats.forEach((m, i) => {
  const matchId = inserted[i]?.id
  if (!matchId) return
  for (const side of ['a', 'b']) {
    for (const l of m[side].lines ?? []) {
      lines.push({
        match_id: matchId, side, pokemon_id: l.pokemon, kills: l.kills, deaths: l.deaths,
      })
    }
  }
})
counts.match_lines = (await insert('match_lines', lines)).length

counts.rules_sections = (await insert('rules_sections',
  (league.rules?.sections ?? []).map((s, i) => ({
    position: i, heading: s.heading, items: s.items ?? [], notes: s.notes ?? [],
  })))).length

console.log('imported from', file)
console.table(counts)
