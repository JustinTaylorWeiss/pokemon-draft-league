/**
 * Puts the league's own point list on a season's board.
 *
 * This supersedes `price-season.mjs`, which invented a first pass so nobody had
 * to price 855 rows from an empty column. Once the league has published a list,
 * that list is the ruling and nothing here second-guesses it: the file is read,
 * matched to the board, and written.
 *
 * The list also decides what is draftable, because it is the pool. A Pokemon it
 * prices is on the board at that price; a Pokemon it does not name comes off,
 * as `Banned` with no cost — the same way the season's already-unavailable
 * entries work, so it still answers a search with "you cannot have that"
 * instead of vanishing and reading as a typo. Nothing is deleted, so a list
 * that turns out to have missed something is one re-run from being fixed.
 *
 *   node scripts/import-points.mjs ~/Downloads/reg_mc_points.csv [--season mega-mc] [--dry]
 *
 * The file is two columns, `Pokemon,Points`, written the way a coach writes
 * them rather than the way Showdown ids them — "Mega Charizard Y", "Alolan
 * Ninetales", "Indeedee (Female)". Resolving that is most of this script.
 *
 * Refuses to run once anybody has drafted. Re-pricing a board mid-draft changes
 * what everyone can still afford, and banning a row somebody already holds
 * would leave a team carrying a Pokemon the board says is unavailable.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'

const URL_ = process.env.SUPABASE_URL ?? 'https://skborcymmwraaycgygga.supabase.co'
const KEY = process.env.SUPABASE_KEY ?? 'sb_publishable_oGfMOvaA4kh1tvmws_iA7Q_PMbZUjPq'
const ACTOR = process.env.SUPABASE_ACTOR ?? 'import'

/** `--flag value` pairs pulled out, leaving the file path as the one bare word. */
const flags = {}
const bare = []
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!a.startsWith('--')) { bare.push(a); continue }
  if (a === '--dry') flags.dry = true
  else flags[a.slice(2)] = process.argv[++i]
}
const SEASON = flags.season ?? 'mega-mc'
const DRY = !!flags.dry
const SOURCE = bare[0]
if (!SOURCE || bare.length > 1) {
  throw new Error('Usage: node scripts/import-points.mjs <points.csv> [--season id] [--out list.csv] [--dry]')
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

/**
 * The bands the tier column keeps, carried over from `price-season.mjs`.
 *
 * On a points season the tier decides nothing and is shown nowhere — the cost
 * stands where the badge used to — but `claim_pokemon` still reads it to refuse
 * a `Banned` pick, so every row needs one. Rows the list prices keep whatever
 * tier they already had; this is only for the rows that arrive without one.
 */
const tierFor = (points) =>
  points >= 17 ? 'Top' : points >= 12 ? 'High' : points >= 8 ? 'Mid' : 'Low'

/**
 * Two kinds of line the list writes its own way.
 *
 * `SEVERAL` is a line that names more than one Pokemon. Squawkabilly is priced
 * by ability rather than by colour — Green and Blue share Guts, Yellow and
 * White share Sheer Force — so one line covers two formes. Gourgeist is priced
 * as a species: the league puts every size at the same cost, though they are
 * four different Pokemon with different HP and Speed.
 *
 * `ONE` is a line whose name is simply not the one Showdown uses, where no rule
 * would get there. Showdown's plain `tauros` is Kantonian and `lycanroc` is
 * Midday; the list calls the Paldean Combat breed "Paldean Tauros" and spells
 * Midday out.
 */
const SEVERAL = {
  'Squawkabilly (Green/Blue)': ['squawkabilly', 'squawkabillyblue'],
  'Squawkabilly (Yellow/White)': ['squawkabillyyellow', 'squawkabillywhite'],
  Gourgeist: ['gourgeist', 'gourgeistsmall', 'gourgeistlarge', 'gourgeistsuper'],
  // There are two, and the list prices them as one the way it does Gourgeist.
  // Meowstic Mega Evolves from either sex and Showdown keeps both, so both go
  // on at the same cost — even though the list prices the two base formes
  // apart, at 11 and 2.
  'Mega Meowstic': ['meowsticmmega', 'meowsticfmega'],
}
const ONE = {
  'Paldean Tauros': 'taurospaldeacombat',
  'Lycanroc-Midday': 'lycanroc',
}

/** The list writes a regional forme as a prefix; Showdown ids it as a suffix. */
const REGION = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' }

/** Accents folded, so "Farfetch'd" lands the same however the file spells it. */
const toId = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Every id a written name might mean, best guess first.
 *
 * Tried in order against the dex, so a name that happens to be a real id wins
 * over a rule that would rewrite it. The last guesses are deliberate
 * fall-throughs to a base forme: the list writes "Basculegion-Male" and
 * "Indeedee (Male)" for what Showdown files under the bare species name, having
 * given the female its own id.
 */
function candidates(name) {
  const out = []
  const push = (s) => { const id = toId(s); if (id && !out.includes(id)) out.push(id) }

  if (ONE[name]) push(ONE[name])
  push(name)

  const paren = name.match(/^(.*?)\s*\((.+)\)$/)
  if (paren) {
    const [, base, forme] = paren
    push(`${base}${forme}`)
    push(`${base}${forme.replace(/\s*Form$/i, '')}`)
    push(`${base}${forme[0]}`)
  }

  // "Mega Charizard Y" -> charizardmegay, "Mega Garchomp Z" -> garchompmegaz.
  const mega = name.match(/^Mega\s+(.+)$/)
  if (mega) {
    const parts = mega[1].split(/\s+/)
    const letter = parts.length > 1 && /^[XYZ]$/i.test(parts.at(-1)) ? parts.pop() : ''
    push(`${parts.join('')}mega${letter}`)
  }
  const primal = name.match(/^Primal\s+(.+)$/)
  if (primal) push(`${primal[1]}primal`)

  // "Alolan Ninetales" -> ninetalesalola, "Paldean Tauros Aqua" -> taurospaldeaaqua.
  const words = name.split(/\s+/)
  const region = REGION[toId(words[0])]
  if (region) push(`${words[1]}${region}${words.slice(2).join('')}`)

  // "Rotom-Wash" -> rotomwash, "Basculegion-Female" -> basculegionf.
  if (name.includes('-')) {
    const [base, ...rest] = name.split('-')
    push(`${base}${rest.join('')}`)
    push(`${base}${rest.join('')[0]}`)
  }

  if (paren) push(paren[1])
  if (name.includes('-')) push(name.split('-')[0])
  return out
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

/** One request per row: PostgREST has no multi-row update by key. */
async function patchEach(rows) {
  if (DRY || !rows.length) return
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200)
    await Promise.all(batch.map(async ({ pokemon_id, ...fields }) => {
      const res = await fetch(
        `${URL_}/rest/v1/board?season_id=eq.${SEASON}&pokemon_id=eq.${encodeURIComponent(pokemon_id)}`,
        { method: 'PATCH', headers, body: JSON.stringify({ ...fields, edited_by: ACTOR }) },
      )
      if (!res.ok) throw new Error(`PATCH ${pokemon_id} -> ${res.status} ${await res.text()}`)
    }))
    process.stdout.write(`  ${Math.min(i + 200, rows.length)}/${rows.length}\r`)
  }
  process.stdout.write('\n')
}

/** The same change over many rows goes in one request, filtered by id. */
async function patchAll(ids, fields) {
  if (DRY || !ids.length) return
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const res = await fetch(
      `${URL_}/rest/v1/board?season_id=eq.${SEASON}&pokemon_id=in.(${batch.join(',')})`,
      { method: 'PATCH', headers, body: JSON.stringify({ ...fields, edited_by: ACTOR }) },
    )
    if (!res.ok) throw new Error(`PATCH ${batch.length} rows -> ${res.status} ${await res.text()}`)
  }
}

async function insert(rows) {
  if (DRY || !rows.length) return
  for (let i = 0; i < rows.length; i += 200) {
    const res = await fetch(`${URL_}/rest/v1/board`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows.slice(i, i + 200).map((r) => ({ ...r, edited_by: ACTOR }))),
    })
    if (!res.ok) throw new Error(`POST board -> ${res.status} ${await res.text()}`)
  }
}

// ---- read the list --------------------------------------------------------

const path = SOURCE.startsWith('~') ? SOURCE.replace('~', homedir()) : SOURCE
const lines = (await readFile(path, 'utf8')).trim().split(/\r?\n/)
if (!/^\s*pokemon\s*,\s*points\s*$/i.test(lines[0])) {
  throw new Error(`Expected a "Pokemon,Points" header, got "${lines[0]}".`)
}

/** One entry per Pokemon, after the lines that name several are split up. */
const wanted = new Map()
const duplicated = []
for (const line of lines.slice(1)) {
  const cut = line.lastIndexOf(',')
  const name = line.slice(0, cut).trim()
  const points = Number(line.slice(cut + 1))
  if (!name || !Number.isInteger(points)) throw new Error(`Cannot read "${line}".`)
  for (const id of SEVERAL[name] ?? [null]) {
    const entry = { name, points, id }
    if (id) {
      if (wanted.has(id)) duplicated.push(`${name} and ${wanted.get(id).name} both name ${id}`)
      wanted.set(id, entry)
    } else wanted.set(`?${wanted.size}`, entry)
  }
}

const dexFile = JSON.parse(await readFile(new URL('../public/data/pokemon.json', import.meta.url), 'utf8'))
const dex = dexFile.pokemon ?? dexFile
const dexByName = new Map(Object.entries(dex).map(([id, p]) => [toId(p.name), id]))

const [meta] = await read('league_meta', `select=*&season_id=eq.${SEASON}`)
if (!meta) throw new Error(`No season "${SEASON}".`)
if (meta.points_budget == null) {
  throw new Error(`"${SEASON}" has no points budget, so it is not a points season.`)
}

const board = await read('board', `select=pokemon_id,name,tier,points,note,drafted_by&season_id=eq.${SEASON}`)
if (!board.length) throw new Error(`"${SEASON}" has an empty board.`)

const rosters = await read('rosters', `select=pokemon_id&season_id=eq.${SEASON}`)
const taken = board.filter((b) => b.drafted_by)
if (rosters.length || taken.length) {
  throw new Error(
    `"${SEASON}" is part-drafted (${rosters.length} picks, ${taken.length} board rows claimed). ` +
    'Re-pricing now would change what people can still afford. Nothing written.',
  )
}

// ---- match it to the board ------------------------------------------------

const byId = new Map(board.map((b) => [b.pokemon_id, b]))
const byName = new Map(board.map((b) => [toId(b.name), b]))

const priced = new Map()   // pokemon_id -> { points, name }
const unresolved = []

for (const entry of wanted.values()) {
  const id = entry.id
    ?? candidates(entry.name).find((c) => byId.has(c) || byName.has(c) || c in dex || dexByName.has(c))
  const resolved = id && (byId.get(id)?.pokemon_id ?? byName.get(id)?.pokemon_id
    ?? (id in dex ? id : dexByName.get(id)))
  if (!resolved) { unresolved.push(entry); continue }
  if (priced.has(resolved)) duplicated.push(`${entry.name} and ${priced.get(resolved).name}`)
  priced.set(resolved, entry)
}

// ---- work out the three kinds of change -----------------------------------

const repriced = []   // already on the board, keeping its tier
const unbanned = []   // priced by the list but banned on the board, so no longer
const added = []      // priced by the list and not on the board at all

for (const [id, entry] of priced) {
  const row = byId.get(id)
  if (!row) {
    const mon = dex[id]
    added.push({
      season_id: SEASON,
      pokemon_id: id,
      name: mon.name,
      tier: tierFor(entry.points),
      points: entry.points,
      note: 'Added for this regulation.',
      drafted_by: null,
      base_stats: mon.baseStats,
      bst: mon.bst,
    })
    continue
  }
  const change = { pokemon_id: id, points: entry.points }
  // A price and a ban contradict each other: the season's banned rows carry no
  // cost precisely so that nothing implies they could be taken. The list has
  // priced this one, so it is draftable and needs a tier again.
  if (row.tier === 'Banned') {
    change.tier = tierFor(entry.points)
    unbanned.push({ ...row, points: entry.points, tier: change.tier })
  }
  // The Megas were seeded with a note explaining a provisional placement. The
  // league has priced them now, so the guess is answered and the note goes.
  if (row.note?.startsWith('Provisional')) change.note = null
  repriced.push(change)
}

/** Everything the list does not name. Off the board, not out of it. */
const unlisted = board
  .filter((b) => !priced.has(b.pokemon_id))
  .sort((a, b) => a.name.localeCompare(b.name))
/** The ones that are not already exactly that, which are the ones to write. */
const dropped = unlisted.filter((b) => b.tier !== 'Banned' || b.points != null)

// ---- report ---------------------------------------------------------------

console.log(DRY ? `--- dry run against "${SEASON}", nothing written ---` : `--- pricing "${SEASON}" ---`)
console.log(`${lines.length - 1} lines read from ${path}`)
console.log(`budget ${meta.points_budget} over ${meta.picks_per_player} picks\n`)
console.log(`  repriced   ${String(repriced.length).padStart(4)}  already on the board`)
console.log(`  added      ${String(added.length).padStart(4)}  priced by the list, not on the board`)
console.log(`  unbanned   ${String(unbanned.length).padStart(4)}  ${unbanned.map((r) => `${r.name} (${r.points})`).join(', ')}`)
console.log(`  banned     ${String(dropped.length).padStart(4)}  on the board, not named by the list`)
console.log(`  untouched  ${String(unlisted.length - dropped.length).padStart(4)}  not named and already banned`)

if (added.length) {
  console.log(`\nAdded: ${added.map((r) => `${r.name} ${r.points}`).join(', ')}`)
}
if (duplicated.length) {
  console.log(`\n${duplicated.length} line(s) naming the same Pokemon twice:`)
  for (const d of duplicated) console.log(`  - ${d}`)
}
if (unresolved.length) {
  console.log(`\n${unresolved.length} name(s) the dex does not have, left unpriced:`)
  for (const u of unresolved) console.log(`  - ${u.name} (${u.points})`)
}

// The banned list is the part nobody can check by eye, so it is written out
// whole rather than summarised: 500-odd rows coming off a board is a thing the
// league should be able to read back.
if (flags.out) {
  const out = flags.out.startsWith('~') ? flags.out.replace('~', homedir()) : flags.out
  await writeFile(out, `Pokemon,Id,Tier before,Points before\n${
    unlisted.map((b) => `${b.name},${b.pokemon_id},${b.tier},${b.points ?? ''}`).join('\n')}\n`)
  console.log(`\nWrote the ${unlisted.length} unlisted to ${out}`)
}

// ---- write ----------------------------------------------------------------

if (added.length) { console.log('\nadding'); await insert(added) }
if (repriced.length) { console.log('pricing'); await patchEach(repriced) }
if (dropped.length) {
  console.log('banning')
  await patchAll(dropped.map((b) => b.pokemon_id), { tier: 'Banned', points: null })
}
console.log(DRY ? '\nNothing written.' : '\nDone.')
