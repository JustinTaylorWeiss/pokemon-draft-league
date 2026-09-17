/**
 * Turns an archived season's spreadsheet into a static copy the site can serve.
 *
 * Seasons 1 to 3 were played on a different spreadsheet template from Season 4
 * — a community one, with the draft laid out across columns and the match
 * stats in week-wide blocks — and they are finished. This reads one of those
 * workbooks, and the Word document holding the league's replay links, and
 * writes `public/data/<season>.json` in the same shape the site already reads
 * Season 4 from.
 *
 *   node scripts/import-archive.mjs --season season-2 \
 *     --file ~/Desktop/"Draft League Archive/Pokemon Draft League v2.xlsx" \
 *     --replays ~/Desktop/"Draft League Archive/NSIECPFL Draft League Archive.docx" \
 *     --heading "SEASON TWO" --name "Season 2"
 *
 * READ-ONLY, like everything else that touches a sheet: it opens files and
 * writes one JSON into this repository. See CLAUDE.md.
 *
 * The output is a frozen record. Nothing re-reads these workbooks at runtime,
 * there is no refresh button behind them, and the seasons they describe are
 * over — which is the whole reason they can ship as a file.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import XLSX from 'xlsx'

const run = promisify(execFile)

const flags = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) flags[a.slice(2)] = process.argv[++i]
}
for (const need of ['season', 'file', 'name']) {
  if (!flags[need]) throw new Error(`Missing --${need}`)
}

const OUT = new URL(`../public/data/${flags.season}.json`, import.meta.url).pathname
const DEX = new URL('../public/data/pokemon.json', import.meta.url).pathname

const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').trim()) || null)

const toId = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '')

const playerId = (s) => String(s ?? '').trim().toLowerCase()
  .replace(/\s*\/\s*/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

/** Rows the template ships unfilled. A season that never used them has none. */
const isPlaceholder = (s) => /^(coach|player|team name)\s*#?\d*$/i.test(txt(s)) || txt(s) === '#N/A'

const warnings = []

// ---- the dex ---------------------------------------------------------------

const dexFile = JSON.parse(await readFile(DEX, 'utf8'))
const dex = dexFile.pokemon ?? dexFile
const dexByName = new Map(Object.entries(dex).map(([id, p]) => [toId(p.name), id]))

const REGIONS = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' }

/**
 * Every id a sheet name might mean.
 *
 * These sheets write a forme the way the games print it — "Hisuian Typhlosion",
 * "Indeedee-f", "Galarian Weezing" — where the dex keys it the way Showdown
 * does. Season 3 is a Little Cup season, so most of its board is unevolved and
 * the names are plain, but the regional prefixes run all the way through.
 */
function candidates(raw) {
  const name = txt(raw)
  const out = [toId(name), toId(name.replace(/[-\s]?incarnate$/i, ''))]
  const words = name.split(/\s+/)
  const region = REGIONS[words[0]?.toLowerCase()]
  if (region && words.length > 1) {
    out.push(toId(words[1]) + region + toId(words.slice(2).join('')))
  }
  // "Indeedee-f" and "Basculegion-m" are how this template writes a sex.
  const sexed = name.match(/^(.*)-([mf])$/i)
  if (sexed) {
    out.push(toId(sexed[1]) + sexed[2].toLowerCase())
    out.push(toId(sexed[1]))
  }
  if (name.includes('-')) out.push(toId(name.split('-')[0]))
  return [...new Set(out.filter(Boolean))]
}

const missed = new Map()
/** Filled once the draft is read; a coach's name is never a Pokémon's. */
const coachNames = new Set()

function resolve(name, where) {
  if (!txt(name) || isPlaceholder(name)) return null
  // A fixture row that this parser failed to recognise would otherwise have
  // its two coaches read as the Pokémon either side of it.
  if (coachNames.has(playerId(name))) return null
  // And a stray number is a score that landed in a name's column.
  if (/^-?\d+(\.\d+)?$/.test(txt(name))) return null
  for (const id of candidates(name)) {
    if (dex[id]) return id
    const byName = dexByName.get(id)
    if (byName) return byName
  }
  missed.set(txt(name), (missed.get(txt(name)) ?? 0) + 1)
  warnings.push(`${where}: "${txt(name)}" is not in the dex`)
  return null
}

// ---- the workbook ----------------------------------------------------------

const wb = XLSX.read(await readFile(flags.file.replace('~', process.env.HOME)), { type: 'buffer' })
const grid = (name) => {
  const ws = wb.Sheets[name]
  if (!ws) throw new Error(`No "${name}" tab. Found: ${wb.SheetNames.join(', ')}`)
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null })
}
/** The first cell in a row that has anything in it, which is its label. */
const label = (row) => txt((row ?? []).map(txt).find(Boolean))

// ---- Draft: who played, what they took, and what it cost -------------------

const draftGrid = grid('Draft')
const headerRow = draftGrid.findIndex((r) => r.filter((c) => txt(c) === 'Pokémon').length > 2)
if (headerRow < 0) throw new Error('Could not find the Draft header row.')
/** Each coach occupies a block of columns; the name of the pick is the anchor. */
const nameCols = draftGrid[headerRow]
  .map((c, i) => (txt(c) === 'Pokémon' ? i : -1)).filter((i) => i >= 0)

const players = []
const rosters = {}
const draft = []
const pointsOf = new Map()
let seed = 0

let block = null
for (let r = headerRow + 1; r < draftGrid.length; r++) {
  const row = draftGrid[r]
  const first = label(row)
  if (/^Coach:?$/i.test(first)) {
    // A bank of up to eight coaches, whose picks are the rows beneath.
    block = nameCols
      .map((col) => ({ col, name: txt(row[col]) }))
      .filter((c) => c.name && !isPlaceholder(c.name))
    for (const c of block) {
      if (players.some((p) => p.id === playerId(c.name))) continue
      players.push({ id: playerId(c.name), seed: ++seed, name: c.name, team: null })
      rosters[playerId(c.name)] = []
      coachNames.add(playerId(c.name))
    }
    continue
  }
  const round = first.match(/^Pick #(\d+)/i)
  if (!round || !block) continue

  for (const [seat, c] of block.entries()) {
    const id = resolve(row[c.col], `Draft round ${round[1]}, ${c.name}`)
    if (!id) continue
    const cost = num(row[c.col - 2])
    const who = playerId(c.name)
    rosters[who].push({ pokemon: id, tier: 'Low', points: cost })
    draft.push({
      round: Number(round[1]),
      pick: seat + 1,
      player: who,
      pokemon: id,
      tier: 'Low',
      points: cost,
    })
    if (cost != null) pointsOf.set(id, cost)
  }
}

/**
 * What a coach could spend, read back from what they did spend.
 *
 * These seasons drafted on a budget and the template does not write the budget
 * down anywhere a parser can reach, so the most anyone spent stands in for it.
 * It is right whenever somebody spent up, which in a draft is everybody.
 */
const spends = Object.values(rosters).map((picks) =>
  picks.reduce((sum, p) => sum + (p.points ?? 0), 0)).filter(Boolean)
const pointsBudget = spends.length ? Math.max(...spends) : null

// ---- the board: everything that was drafted, at what it cost ---------------

const board = {}
for (const [id, cost] of pointsOf) {
  const mon = dex[id]
  board[id] = {
    name: mon?.name ?? id,
    // These seasons are drafted on points; the tier is only ever a colour, and
    // the site hides it entirely wherever a budget is set.
    tier: cost >= 17 ? 'Top' : cost >= 12 ? 'High' : cost >= 8 ? 'Mid' : 'Low',
    note: null,
    draftedBy: null,
    points: cost,
    ...(mon?.baseStats && { baseStats: mon.baseStats, bst: mon.bst }),
  }
}
for (const [who, picks] of Object.entries(rosters)) {
  const name = players.find((p) => p.id === who)?.name
  for (const pick of picks) if (board[pick.pokemon]) board[pick.pokemon].draftedBy = name
}

// ---- Standings: the team each coach ran, and how they finished -------------

/**
 * "Dapper Decidueye (Hunter)" — the team, then the coach who ran it.
 *
 * The coach is the only thing tying this tab to the draft, so the name in the
 * brackets has to match one already found there. Where it does not, the row is
 * reported rather than guessed at: a standings row filed against the wrong
 * coach is worse than one left out.
 */
const standings = []
const teamFor = new Map()
for (const row of grid('Standings')) {
  const cell = txt(row.find((c) => /\(.+\)\s*$/.test(txt(c))))
  if (!cell) continue
  const m = cell.match(/^(.*)\s*\(([^)]+)\)\s*$/)
  if (!m) continue
  const team = txt(m[1])
  const coach = txt(m[2])
  if (isPlaceholder(team) || isPlaceholder(coach)) continue

  const who = players.find((p) => p.id === playerId(coach))
  if (!who) { warnings.push(`Standings: no coach "${coach}" in the draft`); continue }
  teamFor.set(who.id, team)

  const record = txt(row.find((c) => /^\d+-\d+/.test(txt(c))))
  const parts = record.match(/^(\d+)-(\d+)\s*\(([^)]*)\)/)
  const rank = num(row.find((c) => typeof c === 'number'))
  standings.push({
    player: who.id,
    name: who.name,
    team,
    wins: parts ? Number(parts[1]) : 0,
    losses: parts ? Number(parts[2]) : 0,
    gamesWon: 0,
    gamesLost: 0,
    monDiff: parts ? (Number(String(parts[3]).replace(/[^\d-]/g, '')) || 0) : 0,
    points: parts ? Number(parts[1]) : 0,
    rank: rank ?? standings.length + 1,
  })
}
for (const p of players) p.team = teamFor.get(p.id) ?? null

// ---- Schedule: who played whom, and what it finished -----------------------

/**
 * A week marker, then a row per fixture: coach, result, score, "vs.", score,
 * result, coach. The columns are found from the header rather than counted,
 * because the three workbooks do not start in the same one.
 */
const schedGrid = grid('Schedule')
const schedHeader = schedGrid.find((r) => r.some((c) => txt(c) === 'Coach #1')) ?? []
const cCoachA = schedHeader.findIndex((c) => txt(c) === 'Coach #1')
const cVs = schedHeader.findIndex((c) => txt(c) === 'vs.')
const cCoachB = schedHeader.findIndex((c) => txt(c) === 'Coach #2')
if (cCoachA < 0 || cVs < 0 || cCoachB < 0) throw new Error('Could not read the Schedule header.')

const schedule = []
let week = 0
let inWeek = 0
for (const row of schedGrid) {
  const first = label(row)
  const marker = first.match(/^Week #(\d+)/i)
  if (marker) { week = Number(marker[1]); inWeek = 0; continue }
  if (!week) continue

  const a = players.find((p) => p.id === playerId(txt(row[cCoachA])))
  const b = players.find((p) => p.id === playerId(txt(row[cCoachB])))
  if (!a || !b) continue
  const scoreA = num(row[cVs - 1])
  const scoreB = num(row[cVs + 1])
  schedule.push({
    week,
    match: ++inWeek,
    a: [a.id],
    b: [b.id],
    scoreA: scoreA ?? null,
    scoreB: scoreB ?? null,
  })
}

// Games won and lost come from the fixtures, which the standings tab does not
// carry — it counts series, and the site's table has a column for each.
for (const s of standings) {
  for (const m of schedule) {
    if (m.scoreA == null || m.scoreB == null) continue
    if (m.a[0] === s.player) { s.gamesWon += m.scoreA; s.gamesLost += m.scoreB }
    if (m.b[0] === s.player) { s.gamesWon += m.scoreB; s.gamesLost += m.scoreA }
  }
}

// ---- Match Stats: who each Pokemon knocked out, week by week ---------------

/**
 * Weeks run across the sheet in blocks eleven columns wide, fixtures run down.
 * Inside a block: the coaches and the score on one row, then a row per Pokemon
 * with its kills and deaths, the home side on the left and the away side on
 * the right of the same row.
 */
const msGrid = grid('Match Stats')
const msWeekRow = msGrid.findIndex((r) => (r ?? []).some((c) => /^Week #\d+$/.test(txt(c))))
const msBlocks = (msGrid[msWeekRow] ?? [])
  .map((c, i) => (/^Week #(\d+)$/.test(txt(c)) ? { base: i, week: Number(txt(c).slice(6)) } : null))
  .filter(Boolean)

const matchStats = []
for (const { base, week } of msBlocks) {
  let current = null
  for (let r = msWeekRow + 1; r < msGrid.length; r++) {
    const row = msGrid[r] ?? []
    const left = txt(row[base + 1])
    const right = txt(row[base + 7])
    if (!left && !right) continue

    /*
     * A fixture row is the one carrying "vs." between the two scores — or, in
     * the handful where that cell did not survive whatever the sheet has been
     * through, the one with a coach on either side of it. Missing one meant
     * reading its two coaches as the Pokémon they picked.
     */
    const a = players.find((pl) => pl.id === playerId(left))
    const b = players.find((pl) => pl.id === playerId(right))
    if (txt(row[base + 4]) === 'vs.' || (a && b)) {
      if (!a || !b) { current = null; continue }
      current = {
        week,
        a: { team: a.name, result: txt(row[base + 2]) || null, score: num(row[base + 3]), lines: [] },
        b: { team: b.name, result: txt(row[base + 6]) || null, score: num(row[base + 5]), lines: [] },
      }
      matchStats.push(current)
      continue
    }
    if (!current) continue

    const monA = resolve(left, `Match Stats week ${week}`)
    if (monA) {
      current.a.lines.push({ pokemon: monA, kills: num(row[base + 2]) ?? 0, deaths: num(row[base + 3]) ?? 0 })
    }
    const monB = resolve(right, `Match Stats week ${week}`)
    if (monB) {
      current.b.lines.push({ pokemon: monB, kills: num(row[base + 6]) ?? 0, deaths: num(row[base + 5]) ?? 0 })
    }
  }
}

// ---- Pokémon Stats: the season totals, already added up --------------------

/**
 * Laid out like the Draft tab — coaches across, picks down — but carrying
 * games played, kills and deaths. Taken as given rather than re-added from the
 * match lines: the sheet is the league's own record of its season, and where
 * the two disagree it is the sheet that people played under.
 */
const pokemonStats = {}
const psGrid = grid('Pokémon Stats')
const psHeader = psGrid.findIndex((r) => r.filter((c) => txt(c) === 'Pokémon').length > 1)
const psCols = psHeader >= 0
  ? psGrid[psHeader].map((c, i) => (txt(c) === 'Pokémon' ? i : -1)).filter((i) => i >= 0)
  : []
let psBlock = null
for (let r = psHeader + 1; r < psGrid.length; r++) {
  const row = psGrid[r]
  const first = label(row)
  if (/^Coach:?$/i.test(first)) {
    psBlock = psCols
      .map((col) => ({ col, name: txt(row[col - 1]) }))
      .filter((c) => c.name && !isPlaceholder(c.name))
    continue
  }
  if (!/^Pick #\d+/i.test(first) || !psBlock) continue
  for (const c of psBlock) {
    const id = resolve(row[c.col], 'Pokémon Stats')
    if (!id) continue
    pokemonStats[id] = {
      player: playerId(c.name),
      gamesPlayed: num(row[c.col + 1]) ?? 0,
      kills: num(row[c.col + 2]) ?? 0,
      deaths: num(row[c.col + 3]) ?? 0,
    }
  }
}

// ---- MVP Race: the one award these seasons kept ----------------------------

/**
 * Season 4's awards are six of them, each with a title and a blurb somebody
 * wrote. This template has none of that — it keeps a single ranked MVP table —
 * so that is what is carried across, described plainly. Inventing six awards
 * and the league's voice to go with them would be making things up.
 */
const mvpGrid = grid('MVP Race')
const mvpHeader = mvpGrid.findIndex((r) => (r ?? []).some((c) => txt(c) === 'Rank'))
const winners = []
if (mvpHeader >= 0) {
  const hdr = mvpGrid[mvpHeader]
  const cRank = hdr.findIndex((c) => txt(c) === 'Rank')
  const cMon = hdr.findIndex((c) => txt(c) === 'Pokémon')
  const cCoach = hdr.findIndex((c) => txt(c) === 'Coach Name')
  const cRecord = hdr.findIndex((c) => txt(c) === 'Record')
  const PLACES = ['First', 'Second', 'Third']
  for (const row of mvpGrid.slice(mvpHeader + 1)) {
    const rank = num(row[cRank])
    if (!rank || rank > 10) continue
    const id = resolve(row[cMon], 'MVP Race')
    if (!id) continue
    winners.push({
      place: PLACES[rank - 1] ?? `#${rank}`,
      pokemon: id,
      coach: txt(row[cCoach]) || null,
      values: [txt(row[cRecord])],
    })
  }
}
const awards = winners.length ? [{
  title: 'MVP Race',
  blurb: 'How the season ranked its Pokémon, kills against deaths, as the league '
    + 'kept it at the time. The top ten.',
  columns: ['Kills–deaths'],
  winners,
}] : []

// ---- the replay archive ----------------------------------------------------

/**
 * The Word document holds every game the league recorded, under a heading per
 * season and then a heading per fixture. Only the links are wanted, in the
 * order they were played, so a match can offer them the way a reported one on
 * Season 5 does.
 */
async function replaysBySide() {
  if (!flags.replays || !flags.heading) return new Map()
  const { stdout } = await run('unzip', ['-p', flags.replays.replace('~', process.env.HOME), 'word/document.xml'],
    { maxBuffer: 64 * 1024 * 1024 })
  const paras = [...stdout.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) =>
    txt([...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join('')))

  const out = new Map()
  let inSeason = false
  let key = null
  for (const line of paras) {
    if (/^SEASON [A-Z]+/i.test(line)) {
      inSeason = line.toUpperCase().startsWith(flags.heading.toUpperCase())
      key = null
      continue
    }
    if (!inSeason || !line) continue
    const versus = line.match(/^(.+?)\s+v\.?\s+(.+?)$/i)
    if (versus && !/https?:/i.test(line)) {
      key = [playerId(versus[1]), playerId(versus[2])].sort().join('|')
      if (!out.has(key)) out.set(key, [])
      continue
    }
    const link = line.match(/https?:\/\/\S*pokemonshowdown\.com\/\S+/i)
    if (link && key) out.get(key).push(link[0])
  }
  return out
}

const replays = await replaysBySide()
let matchedReplays = 0
for (const m of schedule) {
  const key = [m.a[0], m.b[0]].sort().join('|')
  const links = replays.get(key)
  if (!links || !links.length) continue
  // Consumed in order, so a pair that met twice gets its own games each time.
  const take = links.splice(0, 3)
  m.games = take.map((url, i) => ({
    number: i + 1, winner: null, replayUrl: url, survivors: null, a: [], b: [],
  }))
  matchedReplays += take.length
}

// ---- write ------------------------------------------------------------------

const league = {
  meta: {
    name: flags.name,
    regulation: flags.regulation ?? null,
    format: flags.format ?? null,
    weeks: Math.max(0, ...schedule.map((m) => m.week)) || null,
    picksPerPlayer: Math.max(0, ...Object.values(rosters).map((r) => r.length)) || null,
    seriesLength: flags.series ?? null,
    tierLimits: {},
    pointsBudget,
  },
  players,
  board,
  rosters,
  draft,
  schedule,
  standings: standings.sort((x, y) => x.rank - y.rank),
  rules: {},
  matchStats,
  pokemonStats,
  awards,
}

await writeFile(OUT, JSON.stringify(league, null, 2))

console.log(`--- ${flags.name} -> ${OUT.split('/').slice(-2).join('/')} ---`)
console.log(`  players        ${players.length}`)
console.log(`  board          ${Object.keys(board).length} priced 1-${pointsBudget}`)
console.log(`  rosters        ${Object.values(rosters).reduce((n, r) => n + r.length, 0)} picks over ${draft.length} draft rows`)
console.log(`  schedule       ${schedule.length} fixtures, ${schedule.filter((m) => m.scoreA != null).length} with a score`)
console.log(`  standings      ${standings.length}`)
console.log(`  match stats    ${matchStats.length} fixtures, ${matchStats.reduce((n, m) => n + m.a.lines.length + m.b.lines.length, 0)} lines`)
console.log(`  pokemon stats  ${Object.keys(pokemonStats).length}`)
console.log(`  awards         ${awards.length} (${winners.length} ranked)`)
console.log(`  replays        ${matchedReplays} links on ${schedule.filter((m) => m.games?.length).length} fixtures`)
if (missed.size) {
  console.log(`  UNRESOLVED     ${[...missed.keys()].join(', ')}`)
  const seen = new Set()
  for (const w of warnings.filter((x) => /is not in the dex/.test(x))) {
    const key = w.split(':')[0]
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`      ${w}`)
  }
}
const other = warnings.filter((w) => !/is not in the dex/.test(w))
if (other.length) console.log(`  warnings       ${other.slice(0, 5).join(' | ')}${other.length > 5 ? ` …+${other.length - 5}` : ''}`)
