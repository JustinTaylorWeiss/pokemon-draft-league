/**
 * Creates the Mega season (Regulation M-C) beside the one already there.
 *
 * Built from the Test Season rather than from the spreadsheet: the players, the
 * rules and the tier limits are the league's and carry over unchanged. What is
 * new is the board, which gains every Mega and Primal forme on top of the pool
 * the previous season drafted from.
 *
 * The tiers this gives the Megas are a FIRST PASS, not a ruling. A league
 * decides what a Mega is worth, and nothing here can know that. Two rules stand
 * in until someone says otherwise, and both are recorded in each row's note so
 * they can be seen and overruled:
 *
 *   - A Mega whose base forme is already on the board sits one tier above it.
 *     Mega Evolution is an upgrade, so the Mega should cost more than the thing
 *     it evolves from, and the league has already priced that base.
 *   - A Mega whose base is not on the board — Mewtwo, the Primals, Rayquaza and
 *     the species missing from Scarlet/Violet — has no such anchor, so it is
 *     placed by base stat total, and the extreme top of that range starts
 *     Banned. Unbanning something is a decision a league can make in a minute;
 *     discovering Mega Rayquaza was quietly draftable is a season.
 *
 * Writes only into the new season. Nothing here touches the Test Season, and
 * nothing here touches the spreadsheet.
 *
 *   node scripts/seed-mega-season.mjs [--dry]
 */
import { readFile } from 'node:fs/promises'

const URL_ = process.env.SUPABASE_URL ?? 'https://skborcymmwraaycgygga.supabase.co'
const KEY = process.env.SUPABASE_KEY ?? 'sb_publishable_oGfMOvaA4kh1tvmws_iA7Q_PMbZUjPq'
const ACTOR = process.env.SUPABASE_ACTOR ?? 'import'

const FROM = 'test'
const SEASON = 'mega-mc'
const LABEL = 'Mega Season — Reg M-C'

const DRY = process.argv.includes('--dry')

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function read(table, query) {
  const rows = []
  for (let off = 0; ; off += 1000) {
    const res = await fetch(`${URL_}/rest/v1/${table}?${query}&limit=1000&offset=${off}`, { headers })
    if (!res.ok) throw new Error(`GET ${table} -> ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

async function insert(table, rows) {
  if (DRY || !rows.length) return rows
  // Re-runnable: an earlier attempt that died part-way leaves rows behind, and
  // this is a seeding script, not a merge.
  const existing = await read(table, `select=season_id&season_id=eq.${SEASON}`)
  if (existing.length) {
    console.log(`  ${table}: ${existing.length} rows already there, left alone`)
    return existing
  }
  const out = []
  // Sent in batches: one request with a thousand board rows in it is large
  // enough to be refused, and a partial failure is easier to read this way.
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${URL_}/rest/v1/${table}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows.slice(i, i + 500).map((r) => ({ ...r, edited_by: ACTOR }))),
    })
    if (!res.ok) throw new Error(`POST ${table} -> ${res.status} ${await res.text()}`)
    out.push(...(await res.json()))
  }
  return out
}

const toId = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Mega Evolution is an upgrade, so it costs more than what it evolves from. */
const ONE_UP = { Low: 'Mid', Mid: 'High', High: 'Top', Top: 'Top', Banned: 'Banned' }

/** Only for Megas with no base on the board, where there is nothing to step up from. */
function byPower(bst) {
  if (bst >= 700) return 'Banned'
  if (bst >= 620) return 'Top'
  if (bst >= 570) return 'High'
  if (bst >= 520) return 'Mid'
  return 'Low'
}

const dex = JSON.parse(await readFile(new URL('../public/data/pokemon.json', import.meta.url), 'utf8'))
const species = dex.pokemon ?? dex

// ---- what already exists --------------------------------------------------

// The season row itself is made by migration 0017: `seasons` is closed to the
// browser's key, because everything cascades from it and one stray DELETE took
// the whole Test Season out once already.
const seasons = await read('seasons', 'select=id')
if (!seasons.some((s) => s.id === SEASON)) {
  throw new Error(`Season "${SEASON}" does not exist. It is created by a migration, not by this script.`)
}

const already = await read('board', `select=pokemon_id&season_id=eq.${SEASON}`)
if (already.length) {
  throw new Error(`Season "${SEASON}" already has ${already.length} board rows. Nothing written.`)
}

const [meta] = await read('league_meta', `select=*&season_id=eq.${FROM}`)
const players = await read('players', `select=*&season_id=eq.${FROM}&order=seed`)
const board = await read('board', `select=*&season_id=eq.${FROM}`)
const rules = await read('rules_sections', `select=*&season_id=eq.${FROM}&order=position`)

if (!meta || !players.length || !board.length) throw new Error(`Nothing to copy from "${FROM}".`)

const tierOf = new Map(board.map((b) => [b.pokemon_id, b.tier]))

// ---- the board ------------------------------------------------------------

// The previous season's pool, unchanged and undrafted.
const rows = board.map((b) => ({
  season_id: SEASON,
  pokemon_id: b.pokemon_id,
  name: b.name,
  tier: b.tier,
  note: b.note,
  drafted_by: null,
  base_stats: b.base_stats,
  bst: b.bst,
}))

const megas = Object.entries(species).filter(([, p]) => /^(Mega|Primal)/.test(p.forme ?? ''))
const placed = { fromBase: 0, byPower: 0 }

for (const [id, p] of megas) {
  const base = toId(p.baseSpecies ?? p.name.split('-')[0])
  const baseTier = tierOf.get(base)
  const tier = baseTier ? ONE_UP[baseTier] : byPower(p.bst)
  if (baseTier) placed.fromBase++
  else placed.byPower++

  rows.push({
    season_id: SEASON,
    pokemon_id: id,
    name: p.name,
    tier,
    note: baseTier
      ? `Provisional: one tier above ${species[base]?.name ?? base} (${baseTier}).`
      : `Provisional: placed by ${p.bst} BST — no base forme on the board.`,
    drafted_by: null,
    base_stats: p.baseStats,
    bst: p.bst,
  })
}

// ---- write ----------------------------------------------------------------

const counts = {}

counts.league_meta = (await insert('league_meta', [{
  season_id: SEASON,
  name: LABEL,
  regulation: 'M-C (Mega Evolution)',
  format: meta.format,
  weeks: meta.weeks,
  picks_per_player: meta.picks_per_player,
  series_length: meta.series_length,
  tier_limits: meta.tier_limits,
}])).length

counts.board = (await insert('board', rows)).length

// Copied word for word. The rules are the league's text, and a regulation
// change is not licence to rewrite them — see the report at the end.
counts.rules_sections = (await insert('rules_sections', rules.map((r) => ({
  season_id: SEASON,
  position: r.position,
  heading: r.heading,
  items: r.items,
  notes: r.notes,
})))).length

// No matches. A season starts with nothing played.

// `players` and `draft_state` refuse a direct insert — a player may only arrive
// through the gated `add_player`, and a draft only through `start_draft`. Both
// are copied across by migration 0018 instead.
counts.players = (await read('players', `select=id&season_id=eq.${SEASON}`)).length
if (!counts.players) {
  console.warn('\nNo players in the new season. Run the migrations: 0018 copies them across.')
}

console.log(DRY ? '--- dry run, nothing written ---' : `--- created "${SEASON}" ---`)
console.log(counts)
console.log(`megas added: ${megas.length} (${placed.fromBase} from a base tier, ${placed.byPower} by BST)`)

const tally = {}
for (const r of rows) tally[r.tier] = (tally[r.tier] ?? 0) + 1
console.log('board by tier:', tally)

const megaRows = rows.filter((r) => r.note?.startsWith('Provisional'))
const banned = megaRows.filter((r) => r.tier === 'Banned').map((r) => r.name)
console.log(`\nMegas starting Banned (${banned.length}): ${banned.join(', ')}`)

// The rules text belongs to the previous regulation wherever it names one.
const stale = rules.flatMap((r) => [
  ...(r.items ?? []).map((i) => `${r.heading} / ${i.label}: ${i.text}`),
  ...(r.notes ?? []).map((n) => `${r.heading} / ${n}`),
]).filter((line) => /regulation\s*f|reg\.?\s*f\b|scarlet|violet/i.test(line))

if (stale.length) {
  console.log(`\nRules copied verbatim that still describe the old regulation (${stale.length}):`)
  for (const line of stale) console.log(`  - ${line.slice(0, 160)}`)
}
