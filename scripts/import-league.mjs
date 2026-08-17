/**
 * Turns the league's master spreadsheet into public/data/league.json.
 *
 * ============================================================================
 * THE SHEET IS READ-ONLY. NEVER WRITE TO IT.
 *
 * The share link the league uses grants EDIT access. This script must never
 * exercise it. The only permitted access is an HTTP GET of the export URL.
 * Never edit, append, clear, reformat, re-upload, or change permissions on the
 * document — not even to fix data this script reports as broken. Surface the
 * problem to a human instead. See CLAUDE.md.
 * ============================================================================
 *
 * Usage:
 *   npm run import:league -- "~/Downloads/Doubles Draft League....xlsx"
 *   npm run import:league -- "https://docs.google.com/.../export?format=xlsx"
 *
 * Take the sheet's /edit URL and swap the trailing /edit... for
 * /export?format=xlsx.
 */
import { writeFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import XLSX from 'xlsx'

const OUT = new URL('../public/data/league.json', import.meta.url).pathname
const DEX = new URL('../public/data/pokemon.json', import.meta.url).pathname
import { parseLeagueSheet } from '../src/lib/parseLeagueSheet.js'

async function loadWorkbook(source) {
  if (/^https?:/.test(source)) {
    // GET only. Nothing in this file may ever write to the sheet — see the
    // banner above and CLAUDE.md.
    const res = await fetch(source, { method: 'GET', redirect: 'follow' })
    if (!res.ok) throw new Error(`Fetching sheet failed: HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())

    // An xlsx is a zip, so it starts "PK". Anything else means we were handed a
    // page instead of a file — almost always Google's sign-in page because the
    // sheet is not link-readable. Say that rather than letting SheetJS report
    // a confusing HTML parse error.
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error(
        'That URL returned a web page, not a spreadsheet.\n' +
        '  Check the sheet is shared as "Anyone with the link -> Viewer",\n' +
        '  and that the URL ends in /export?format=xlsx',
      )
    }
    return XLSX.read(bytes, { type: 'array' })
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

    // All parsing lives in the shared module so the site's in-page refresh
    // produces byte-identical data to this script.
    const { league, warnings, statOverrides } = parseLeagueSheet(wb, dex)
    const { players, board, rosters, draft, schedule, standings, rules, matchStats, pokemonStats, awards } = league

    await writeFile(OUT, JSON.stringify(league))

    const json = JSON.stringify(league)
    console.log(`league.json  ${(json.length / 1024).toFixed(1)} KB`)
    console.log(`  players    ${players.length}`)
    console.log(`  board      ${Object.keys(board).length} Pokémon`)
    console.log(`  rosters    ${Object.keys(rosters).length} (${Object.values(rosters).reduce((a, p) => a + p.length, 0)} picks)`)
    console.log(`  draft      ${draft.length} picks`)
    console.log(`  schedule   ${schedule.length} matches over ${new Set(schedule.map((m) => m.week)).size} weeks`)
    console.log(`  standings  ${standings.length} rows`)
    const ruleSections = rules?.sections ?? []
    const ruleCount = ruleSections.reduce((a, x) => a + x.items.length, 0)
    const noteCount = ruleSections.reduce((a, x) => a + x.notes.length, 0)
    console.log(`  rules      ${ruleSections.length} sections, ${ruleCount} rules, ${noteCount} notes`)

    const lineCount = matchStats.reduce((a, m) => a + m.a.lines.length + m.b.lines.length, 0)
    const recordedWeeks = new Set(matchStats.map((m) => m.week)).size
    console.log(`  matchStats ${matchStats.length} matches over ${recordedWeeks} weeks, ${lineCount} Pokémon lines`)

    // The Pokémon Stats tab is derived and still being filled in, so compare it
    // against the raw match record rather than trusting it silently.
    const fromMatches = {}
    for (const m of matchStats) {
      for (const side of [m.a, m.b]) {
        for (const l of side.lines) {
          const t = (fromMatches[l.pokemon] ??= { gp: 0, k: 0, d: 0 })
          t.gp++; t.k += l.kills || 0; t.d += l.deaths || 0
        }
      }
    }
    let agree = 0, blank = 0, conflict = 0
    for (const [id, t] of Object.entries(pokemonStats)) {
      const f = fromMatches[id]
      if (!f) continue
      if (t.kills === f.k && t.deaths === f.d) agree++
      else if (!t.kills && !t.deaths) blank++
      else conflict++
    }
    console.log(`  pokeStats  ${Object.keys(pokemonStats).length} entries — ${agree} match the game record, ${blank} still blank, ${conflict} conflict`)
    console.log(`  awards     ${awards.length} — ${awards.reduce((a, x) => a + x.winners.length, 0)} placements`)

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
