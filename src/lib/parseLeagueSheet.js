/**
 * Parses the league's master spreadsheet into the shape the site consumes.
 *
 * ============================================================================
 * THE SHEET IS READ-ONLY. NEVER WRITE TO IT.
 *
 * The league's share link grants EDIT access; nothing here may use it. This
 * module only ever receives an already-fetched workbook and returns plain data.
 * It performs no network or file writes of any kind. See CLAUDE.md.
 * ============================================================================
 *
 * Plain JavaScript on purpose: the Node importer and the browser's in-page
 * refresh both import it, so it cannot depend on a TypeScript build step.
 */
// Named import: SheetJS's ESM build has no default export.
import { utils } from 'xlsx'

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

/**
 * @param {object} wb        a SheetJS workbook, already read
 * @param {object} dex       public/data/pokemon.json, for resolving names
 * @returns {{ league: object, warnings: string[], statOverrides: number }}
 */
export function parseLeagueSheet(wb, dex) {
  const grid = (name) => {
    const ws = wb.Sheets[name]
    if (!ws) throw new Error(`Missing sheet "${name}". Found: ${wb.SheetNames.join(', ')}`)
    return utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null })
  }

  const warnings = []

  /**
   * The stats tabs name formes the way the games print them — "Hisuian
   * Typhlosion", "Landorus-Incarnate" — while the dex keys them the way
   * Showdown does, "typhlosionhisui" and plain "landorus". These rewrites
   * bridge the two; each is tried in turn until one lands.
   */
  const REGIONS = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' }

  const candidates = (raw) => {
    const name = String(raw ?? '').trim()
    const out = [toId(name)]

    // "Incarnate" is the base forme, so it is simply dropped.
    out.push(toId(name.replace(/[-\s]?incarnate$/i, '')))

    // "Alolan Ninetales" -> ninetalesalola, "Paldean Tauros Aqua" -> taurospaldeaaqua
    const regional = name.match(/^(\w+)\s+(.+)$/)
    if (regional && REGIONS[regional[1].toLowerCase()]) {
      const suffix = REGIONS[regional[1].toLowerCase()]
      const rest = regional[2].split(/\s+/)
      out.push(toId(rest[0]) + suffix + toId(rest.slice(1).join('')))
    }
    return [...new Set(out.filter(Boolean))]
  }

  /** Resolves a sheet name to a dex id, recording anything that misses. */
  const resolve = (name, where) => {
    for (const id of candidates(name)) if (dex[id]) return id
    warnings.push(`${where}: "${clean(name)}" has no dex entry (tried ${candidates(name).map((c) => `"${c}"`).join(', ')})`)
    return null
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

  // ---- Match Stats -------------------------------------------------------
  // Weeks run across the sheet in 11-column blocks. Inside each block a match
  // header row (result + score on both sides) is followed by one row per
  // Pokémon brought, with kills and deaths for either side.
  const msGrid = grid('Match Stats')
  const weekCols = []
  msGrid[2]?.forEach((c, i) => {
    const m = typeof c === 'string' && c.trim().match(/^Week\s*#?(\d+)/i)
    if (m) weekCols.push({ week: Number(m[1]), col: i })
  })

  const matchStats = []
  for (const { week, col: b } of weekCols) {
    let current = null
    for (let r = 3; r < msGrid.length; r++) {
      const row = msGrid[r] ?? []
      const left = clean(row[b + 1])
      const result = clean(row[b + 2])
      const right = clean(row[b + 7])

      // Header rows carry the "vs." separator; Pokémon rows leave it blank.
      // Result is absent on matches that have not been played yet, so it
      // cannot be the discriminator.
      if (clean(row[b + 4]) === 'vs.' && !isBlank(left) && !isBlank(right)) {
        current = {
          week,
          a: { team: left, result, score: typeof row[b + 3] === 'number' ? row[b + 3] : null, lines: [] },
          b: { team: right, result: clean(row[b + 6]), score: typeof row[b + 5] === 'number' ? row[b + 5] : null, lines: [] },
        }
        matchStats.push(current)
        continue
      }
      if (!current) continue

      const aMon = clean(row[b + 1])
      const bMon = clean(row[b + 7])
      if (isBlank(aMon) && isBlank(bMon)) continue
      if (!isBlank(aMon)) {
        const id = resolve(aMon, `Match Stats/W${week}`)
        if (id) current.a.lines.push({ pokemon: id, kills: row[b + 2] ?? 0, deaths: row[b + 3] ?? 0 })
      }
      if (!isBlank(bMon)) {
        const id = resolve(bMon, `Match Stats/W${week}`)
        if (id) current.b.lines.push({ pokemon: id, kills: row[b + 6] ?? 0, deaths: row[b + 5] ?? 0 })
      }
    }
  }

  // ---- Pokémon Stats -----------------------------------------------------
  // Coach blocks stride 8 columns; each band of rows is Pick #1-12 then
  // Drop #1-10 then Total.
  const psGrid = grid('Pokémon Stats')
  const pokemonStats = {}
  for (let base = 0; base < psGrid.length; base++) {
    if (clean(psGrid[base]?.[0]) !== 'Coach:') continue
    for (let c = 3; c < (psGrid[base].length ?? 0); c += 8) {
      const coach = clean(psGrid[base][c])
      if (isBlank(coach)) continue
      for (let r = base + 1; r <= base + 22 && r < psGrid.length; r++) {
        const name = clean(psGrid[r]?.[c + 1])
        if (isBlank(name)) continue
        const id = resolve(name, `Pokémon Stats/${coach}`)
        if (!id) continue
        const [gp, k, d] = [psGrid[r][c + 2], psGrid[r][c + 3], psGrid[r][c + 4]]
        if (typeof gp !== 'number' && typeof k !== 'number') continue
        pokemonStats[id] = {
          player: playerId(coach),
          gamesPlayed: gp || 0,
          kills: k || 0,
          deaths: d || 0,
        }
      }
    }
  }

  // ---- MVP Race: the league's awards --------------------------------------
  //
  // A ranking of every drafted Pokémon down the left, and beside it a column of
  // hand-written awards — "Most Bloodthirsty Killer", "The Unkillable Menaces"
  // — each with a write-up and a podium. The ranking is already derivable from
  // the stats the site holds; the awards are not, because the league decides
  // what they are and who wins them.
  //
  // Each block is laid out the same way: a title, a blank row, the write-up,
  // then a header row starting "Placement" whose remaining columns name the
  // numbers that justify the pick — which differ per award, since "most kills"
  // and "best ratio" are not argued from the same figures.
  const mvpGrid = grid('MVP Race')
  const awards = []

  for (let h = 0; h < mvpGrid.length; h++) {
    if (clean(mvpGrid[h]?.[16]) !== 'Placement') continue

    // The title and the write-up are the two prose cells above the header;
    // anything numeric between them is a placement's points, not text.
    const prose = []
    for (let r = h - 1; r >= 0 && r > h - 12; r--) {
      const v = clean(mvpGrid[r]?.[15])
      if (!isBlank(v) && Number.isNaN(Number(v))) prose.unshift(v)
    }
    if (!prose.length) continue

    // Whatever this particular award is argued from.
    const columns = []
    for (let c = 20; c < 27; c++) {
      const label = clean(mvpGrid[h][c])
      if (!isBlank(label)) columns.push({ label, column: c })
    }

    const winners = []
    for (let r = h + 1; r < mvpGrid.length; r++) {
      const place = clean(mvpGrid[r]?.[16])
      const name = clean(mvpGrid[r]?.[18])
      if (isBlank(place) && isBlank(name)) break
      const id = resolve(name, `MVP Race/${prose[0]}`)
      if (!id) continue
      winners.push({
        place,
        pokemon: id,
        // The sheet writes coaches as "Justin / Numeral" — the league name and
        // the Showdown account. Kept as written: this is a caption, not a join.
        coach: clean(mvpGrid[r][19]),
        values: columns.map((col) => {
          const v = mvpGrid[r][col.column]
          // Ratios come out of the sheet at full float width.
          return typeof v === 'number' ? Math.round(v * 100) / 100 : v ?? null
        }),
      })
    }

    if (winners.length) {
      awards.push({
        title: prose[0],
        blurb: prose.length > 1 ? prose[prose.length - 1] : null,
        columns: columns.map((c) => c.label),
        winners,
      })
    }
  }

  // ---- Rules -------------------------------------------------------------
  // Column B is either a numbered section heading, a rule's label, or a
  // standalone callout; column C holds the rule text when there is one.
  const rulesGrid = grid('Rules')
  const ruleSections = []
  let ruleTitle = null
  let ruleSubtitle = null
  let ruleFooter = null

  for (const r of rulesGrid) {
    const banner = clean(r[0])
    const label = clean(r[1])
    const text = clean(r[2])

    if (!isBlank(banner)) {
      if (ruleTitle === null) ruleTitle = banner
      else if (ruleSubtitle === null) ruleSubtitle = banner
      else ruleFooter = banner
      continue
    }
    if (isBlank(label)) continue

    if (isBlank(text)) {
      // "1. FORMAT & OVERVIEW" starts a section; anything else is a callout
      // belonging to the section already open.
      if (/^\d+\.\s/.test(label)) ruleSections.push({ heading: label, items: [], notes: [] })
      else if (ruleSections.length) ruleSections.at(-1).notes.push(label)
      continue
    }
    if (!ruleSections.length) ruleSections.push({ heading: 'General', items: [], notes: [] })
    ruleSections.at(-1).items.push({ label, text })
  }

  const rules = {
    title: ruleTitle,
    subtitle: ruleSubtitle,
    footer: ruleFooter,
    sections: ruleSections,
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


  const league = {
    meta, players, board, rosters, draft, schedule, standings, rules,
    matchStats, pokemonStats, awards,
  }
  return { league, warnings, statOverrides }
}
