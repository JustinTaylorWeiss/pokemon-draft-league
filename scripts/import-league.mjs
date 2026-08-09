/**
 * Turns the league's master spreadsheet into public/data/league.json.
 *
 * Usage:
 *   npm run import:league -- "~/Downloads/Copy of Doubles Draft League....xlsx"
 *   npm run import:league -- "https://docs.google.com/.../export?format=xlsx"
 *
 * A Google Sheets URL works directly as long as the sheet is shared with
 * "anyone with the link can view" — swap the trailing /edit for
 * /export?format=xlsx. Read-only access is all this needs; it never writes back.
 */
import { writeFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import XLSX from 'xlsx'

const OUT = new URL('../public/data/league.json', import.meta.url).pathname
const DEX = new URL('../public/data/pokemon.json', import.meta.url).pathname

/**
 * Matches the dex key: fold accents first so "Flabébé" reaches "flabebe"
 * rather than "flabb". That one name is the only accented species in Gen 9,
 * and dropping the fold silently loses it.
 */
const toId = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Player keys have to survive names like "Lennart / Pr3dixtion". */
const playerId = (s) =>
  String(s ?? '').trim().toLowerCase().replace(/\s*\/\s*/g, '-').replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v)
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '' || String(v).trim() === '—'

async function loadWorkbook(source) {
  if (/^https?:/.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Fetching sheet failed: HTTP ${res.status}`)
    return XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array' })
  }
  const path = source.replace(/^~/, homedir())
  return XLSX.read(await readFile(path), { type: 'buffer' })
}

function main(source) {
  return (async () => {
    const [wb, dex] = await Promise.all([
      loadWorkbook(source),
      readFile(DEX, 'utf8').then(JSON.parse),
    ])
    const grid = (name) => {
      const ws = wb.Sheets[name]
      if (!ws) throw new Error(`Missing sheet "${name}". Found: ${wb.SheetNames.join(', ')}`)
      return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null })
    }

    const warnings = []
    /** Resolves a sheet name to a dex id, recording anything that misses. */
    const resolve = (name, where) => {
      const id = toId(name)
      if (!dex[id]) {
        warnings.push(`${where}: "${clean(name)}" has no dex entry (tried "${id}")`)
        return null
      }
      return id
    }

    // ---- Setup: league settings, tier limits, players --------------------
    const setup = grid('Setup')
    const settingRow = (label) =>
      setup.find((r) => typeof r[0] === 'string' && r[0].trim().toLowerCase() === label.toLowerCase())
    const setting = (label) => clean(settingRow(label)?.[2] ?? null)

    const tierLimits = {}
    for (const r of setup) {
      // The limits block is "<Tier> ... <max>" with the number in column D.
      if (['Top', 'High', 'Mid', 'Low'].includes(clean(r[0])) && typeof r[3] === 'number') {
        tierLimits[clean(r[0])] = r[3]
      }
    }

    const players = []
    for (const r of setup) {
      if (typeof r[5] !== 'number' || isBlank(r[6])) continue
      const name = clean(r[6])
      // Rows 21-24 are unused placeholders shipped with the template.
      if (/^Player \d+$/i.test(name)) continue
      const team = clean(r[8])
      players.push({
        id: playerId(name),
        seed: r[5],
        name,
        team: isBlank(team) || team === 'TBD' ? null : team,
      })
    }

    const meta = {
      name: setting('League Name'),
      regulation: setting('Regulation'),
      format: setting('Format'),
      weeks: Number(setting('# of Weeks')) || null,
      picksPerPlayer: Number(setting('Picks Per Player')) || null,
      seriesLength: setting('Series Length'),
      tierLimits,
    }

    // ---- Pokémon List: the draft board -----------------------------------
    // The sheet is authoritative. Its name, tier, and stats are carried through
    // and override the Showdown dex at read time, so a correction made in the
    // spreadsheet shows up here without touching the Pokémon dataset.
    const board = {}
    let statOverrides = 0
    for (const r of grid('Pokémon List').slice(3)) {
      if (isBlank(r[1]) || isBlank(r[2])) continue
      const id = resolve(r[1], 'Pokémon List')
      if (!id) continue
      const draftedBy = clean(r[11])
      const stats = { hp: r[4], atk: r[5], def: r[6], spa: r[7], spd: r[8], spe: r[9] }
      const hasStats = Object.values(stats).every((v) => typeof v === 'number')
      if (hasStats) {
        const dexStats = dex[id].baseStats
        if (Object.keys(stats).some((k) => stats[k] !== dexStats[k])) statOverrides++
      }
      board[id] = {
        name: clean(r[1]),
        tier: clean(r[2]),
        note: isBlank(r[10]) ? null : clean(r[10]),
        draftedBy: isBlank(draftedBy) ? null : draftedBy,
        ...(hasStats && { baseStats: stats, bst: typeof r[3] === 'number' ? r[3] : null }),
      }
    }

    // ---- Draft log --------------------------------------------------------
    const draft = []
    for (const r of grid('Draft')) {
      if (typeof r[0] !== 'number' || typeof r[1] !== 'number' || isBlank(r[3])) continue
      const id = resolve(r[3], 'Draft')
      if (!id) continue
      draft.push({
        round: r[0], pick: r[1], player: playerId(r[2]),
        pokemon: id, tier: clean(r[4]),
      })
    }

    // ---- Rosters: repeating 3-column blocks, 4 players wide ---------------
    const rosters = {}
    const rosterGrid = grid('Rosters')
    rosterGrid.forEach((row, rowIdx) => {
      row.forEach((cell, col) => {
        if (clean(cell) !== 'POKÉMON') return
        // The player's name sits one row up, one column left of "POKÉMON".
        const owner = clean(rosterGrid[rowIdx - 1]?.[col - 1])
        if (isBlank(owner)) return
        const picks = []
        for (let r = rowIdx + 1; r < rosterGrid.length; r++) {
          const name = rosterGrid[r]?.[col]
          // A blank or em-dash ends this block; the next block starts below.
          if (isBlank(name)) break
          const id = resolve(name, `Rosters/${owner}`)
          if (id) picks.push({ pokemon: id, tier: clean(rosterGrid[r][col + 1]) })
        }
        if (picks.length) rosters[playerId(owner)] = picks
      })
    })

    // ---- Schedule: 2v2 partner format ------------------------------------
    const schedule = []
    for (const r of grid('Schedule')) {
      if (typeof r[0] !== 'number') continue
      const sideA = [r[3], r[4]].filter((v) => !isBlank(v)).map((v) => playerId(v))
      const sideB = [r[9], r[10]].filter((v) => !isBlank(v)).map((v) => playerId(v))
      if (!sideA.length || !sideB.length) continue
      schedule.push({
        week: r[0],
        match: clean(r[1]),
        a: sideA,
        b: sideB,
        scoreA: typeof r[6] === 'number' ? r[6] : null,
        scoreB: typeof r[7] === 'number' ? r[7] : null,
      })
    }

    // ---- Standings --------------------------------------------------------
    const standings = []
    for (const r of grid('Standings')) {
      if (isBlank(r[1]) || typeof r[3] !== 'number') continue
      standings.push({
        player: playerId(r[1]),
        name: clean(r[1]),
        team: isBlank(r[2]) || clean(r[2]) === 'TBD' ? null : clean(r[2]),
        wins: r[3], losses: r[4],
        gamesWon: r[6] ?? 0, gamesLost: r[7] ?? 0,
        monDiff: r[8] ?? 0, points: r[9] ?? 0,
      })
    }
    // Their RANK column repeats values; recompute so the table sorts sanely.
    standings.sort((a, b) =>
      b.points - a.points || b.monDiff - a.monDiff || b.gamesWon - a.gamesWon)
    standings.forEach((s, i) => { s.rank = i + 1 })

    const league = { meta, players, board, rosters, draft, schedule, standings }
    await writeFile(OUT, JSON.stringify(league))

    const json = JSON.stringify(league)
    console.log(`league.json  ${(json.length / 1024).toFixed(1)} KB`)
    console.log(`  players    ${players.length}`)
    console.log(`  board      ${Object.keys(board).length} Pokémon`)
    console.log(`  rosters    ${Object.keys(rosters).length} (${Object.values(rosters).reduce((a, p) => a + p.length, 0)} picks)`)
    console.log(`  draft      ${draft.length} picks`)
    console.log(`  schedule   ${schedule.length} matches over ${new Set(schedule.map((m) => m.week)).size} weeks`)
    console.log(`  standings  ${standings.length} rows`)

    console.log(`  ${statOverrides} board entries have stats differing from the Showdown dex (sheet wins)`)

    const rostersMissing = players.filter((p) => !rosters[p.id]).map((p) => p.name)
    if (rostersMissing.length) console.log(`\n  no roster found for: ${rostersMissing.join(', ')}`)
    if (warnings.length) {
      console.log(`\n  ${warnings.length} unresolved name(s):`)
      for (const w of warnings.slice(0, 20)) console.log('   ', w)
    }
  })()
}

const source = process.argv[2]
if (!source) {
  console.error('Usage: npm run import:league -- <path-to-xlsx | google-sheets-export-url>')
  process.exit(1)
}
main(source).catch((err) => { console.error(err.message); process.exit(1) })
