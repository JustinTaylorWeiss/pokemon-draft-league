/**
 * Puts a price on every Pokémon in a points season.
 *
 * A FIRST PASS, not a ruling. What something is worth is the league's call, and
 * this only exists so nobody has to price 855 rows from an empty column. Run it
 * once, then adjust whatever looks wrong — re-running is safe and re-prices
 * everything from scratch, so do that before the draft rather than during it.
 *
 * How a price is arrived at, in order:
 *
 *   1. The tier the league already assigned picks the band. That is the one
 *      judgement already made about these Pokémon and it is worth keeping.
 *   2. Base stat total places it inside that band, so the stronger half of a
 *      tier costs more than the weaker half rather than everything in a tier
 *      costing the same.
 *   3. Smogon's doubles tier nudges it, where Showdown has one. It is the
 *      closest thing to an outside opinion available — but it only covers about
 *      half the board and none of the Megas, which Showdown files as Past or
 *      Future, so it adjusts rather than decides.
 *
 * Banned Pokémon get no price. They cannot be drafted, and a cost would imply
 * they could be.
 *
 *   node scripts/price-season.mjs [--season mega-mc] [--dry]
 */
import { readFile } from 'node:fs/promises'

const URL_ = process.env.SUPABASE_URL ?? 'https://skborcymmwraaycgygga.supabase.co'
const KEY = process.env.SUPABASE_KEY ?? 'sb_publishable_oGfMOvaA4kh1tvmws_iA7Q_PMbZUjPq'
const ACTOR = process.env.SUPABASE_ACTOR ?? 'import'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const SEASON = arg('season', 'mega-mc')
const DRY = process.argv.includes('--dry')

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

/**
 * The bands, against a 100-point budget and eight picks — an average of 12.5 a
 * pick. Chosen so the shape the league used to enforce with tier limits is
 * still roughly affordable (two Top, two High, two Mid, two Low comes to about
 * 95) while making it a choice rather than a rule.
 */
const BANDS = {
  Top: [17, 22],
  High: [12, 16],
  Mid: [8, 11],
  Low: [2, 7],
}

/** Where Showdown has an opinion about doubles, it shifts the ranking. */
const SMOGON_NUDGE = {
  DUber: 60, DOU: 40, '(DOU)': 20, DUU: -10, '(DUU)': -20, NFE: -40, LC: -60,
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

async function setPoints(updates) {
  if (DRY || !updates.length) return
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200)
    // One request per price: PostgREST has no multi-row update by key, and a
    // bulk upsert would need every column of every row sent back.
    await Promise.all(batch.map(async (u) => {
      const res = await fetch(
        `${URL_}/rest/v1/board?season_id=eq.${SEASON}&pokemon_id=eq.${encodeURIComponent(u.pokemon_id)}`,
        { method: 'PATCH', headers, body: JSON.stringify({ points: u.points, edited_by: ACTOR }) },
      )
      if (!res.ok) throw new Error(`PATCH ${u.pokemon_id} -> ${res.status} ${await res.text()}`)
    }))
    process.stdout.write(`  priced ${Math.min(i + 200, updates.length)}/${updates.length}\r`)
  }
  process.stdout.write('\n')
}

const dexFile = JSON.parse(await readFile(new URL('../public/data/pokemon.json', import.meta.url), 'utf8'))
const dex = dexFile.pokemon ?? dexFile

const [meta] = await read('league_meta', `select=*&season_id=eq.${SEASON}`)
if (!meta) throw new Error(`No season "${SEASON}".`)
if (meta.points_budget == null) {
  throw new Error(`"${SEASON}" has no points budget, so it is not a points season.`)
}

const board = await read('board', `select=pokemon_id,name,tier,bst&season_id=eq.${SEASON}`)
if (!board.length) throw new Error(`"${SEASON}" has an empty board.`)

// ---- price ----------------------------------------------------------------

const updates = []
const summary = {}

for (const [tier, [low, high]] of Object.entries(BANDS)) {
  const inBand = board.filter((b) => b.tier === tier)
  if (!inBand.length) continue

  // Rank within the band: base stats, nudged by Showdown's doubles opinion.
  const scored = inBand.map((b) => {
    const mon = dex[b.pokemon_id]
    const bst = b.bst ?? mon?.bst ?? 0
    return { ...b, score: bst + (SMOGON_NUDGE[mon?.doublesTier] ?? 0) }
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  // Spread the band across the ranking: dearest at the top, cheapest at the
  // bottom, evenly through the middle.
  scored.forEach((b, i) => {
    const share = scored.length === 1 ? 0 : i / (scored.length - 1)
    const points = Math.round(high - share * (high - low))
    updates.push({ pokemon_id: b.pokemon_id, points })
    ;(summary[tier] ??= []).push({ name: b.name, points, score: b.score })
  })
}

// Banned carries no price: it cannot be drafted, and a number would imply it could.
for (const b of board.filter((x) => x.tier === 'Banned')) {
  updates.push({ pokemon_id: b.pokemon_id, points: null })
}

// ---- report ---------------------------------------------------------------

console.log(DRY ? '--- dry run, nothing written ---' : `--- pricing "${SEASON}" ---`)
console.log(`budget ${meta.points_budget} over ${meta.picks_per_player} picks ` +
  `(${(meta.points_budget / meta.picks_per_player).toFixed(1)} a pick on average)\n`)

for (const [tier, list] of Object.entries(summary)) {
  const points = list.map((x) => x.points)
  console.log(`${tier.padEnd(5)} ${String(list.length).padStart(3)} Pokémon  ` +
    `${Math.min(...points)}–${Math.max(...points)} pts`)
  console.log(`      dearest: ${list.slice(0, 3).map((x) => `${x.name} ${x.points}`).join(', ')}`)
  console.log(`      cheapest: ${list.slice(-3).map((x) => `${x.name} ${x.points}`).join(', ')}`)
}
console.log(`\nBanned (no price): ${board.filter((b) => b.tier === 'Banned').length}`)

// Does the old shape still fit? If two of each tier no longer fits in the
// budget, the bands are wrong and the league should know before drafting.
const cheapestOf = (tier) => (summary[tier] ?? []).slice(-2).reduce((a, x) => a + x.points, 0)
const dearestOf = (tier) => (summary[tier] ?? []).slice(0, 2).reduce((a, x) => a + x.points, 0)
console.log(`\nA two-of-each-tier team costs ${
  ['Top', 'High', 'Mid', 'Low'].reduce((a, t) => a + cheapestOf(t), 0)} at its cheapest, ${
  ['Top', 'High', 'Mid', 'Low'].reduce((a, t) => a + dearestOf(t), 0)} at its dearest, against ${meta.points_budget}.`)

await setPoints(updates)
console.log(DRY ? '' : `\nWrote ${updates.length} prices.`)
