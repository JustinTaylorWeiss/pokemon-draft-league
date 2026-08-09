/**
 * Builds the static Pokemon dataset that ships with the site.
 *
 * Source is Pokemon Showdown's battle data, which is already normalized around
 * competitive play (base stats, abilities, tiers, learnsets) rather than the
 * lore-and-flavor shape PokeAPI returns. Everything predating Generation 9 is
 * dropped: no past-gen-only species, moves, or learnset sources.
 *
 * Run with `npm run build:data`. Output lands in public/data/ as plain JSON so
 * the app can fetch it lazily instead of inlining it into the JS bundle.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const CURRENT_GEN = 9
const SRC = 'https://play.pokemonshowdown.com/data'
const OUT = new URL('../public/data/', import.meta.url).pathname

/** National dex ranges, used to tag which generation a species debuted in. */
const GEN_RANGES = [
  [1, 151], [152, 251], [252, 386], [387, 493], [494, 649],
  [650, 721], [722, 809], [810, 905], [906, 1025],
]

const originGen = (num) => GEN_RANGES.findIndex(([lo, hi]) => num >= lo && num <= hi) + 1

/** Same normalization the dex is keyed by, accents folded. */
const toId = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')

/** Showdown ships some tables as JSON and others as `exports.X = {...}` scripts. */
async function fetchJson(name) {
  const res = await fetch(`${SRC}/${name}.json`)
  if (!res.ok) throw new Error(`${name}.json -> HTTP ${res.status}`)
  return res.json()
}

async function fetchScript(name) {
  const res = await fetch(`${SRC}/${name}.js`)
  if (!res.ok) throw new Error(`${name}.js -> HTTP ${res.status}`)
  const exports = {}
  new Function('exports', await res.text())(exports)
  const values = Object.values(exports)
  if (values.length !== 1) throw new Error(`${name}.js exported ${values.length} objects, expected 1`)
  return values[0]
}

/**
 * Showdown marks anything unavailable in the current games with `isNonstandard`
 * ("Past", "CAP", "Future", "Custom"). Null means legal right now, which is the
 * only thing a Gen 9 draft league can pick.
 */
const isCurrentGen = (entry) => !entry.isNonstandard

async function main() {
  console.log('fetching Showdown data...')
  const [dex, moves, learnsets, typechart, abilities, formats] = await Promise.all([
    fetchJson('pokedex'),
    fetchJson('moves'),
    fetchJson('learnsets'),
    fetchScript('typechart'),
    fetchScript('abilities'),
    fetchScript('formats-data'),
  ])

  const stats = {}

  // ---- Pokemon -------------------------------------------------------------
  const pokemon = {}
  for (const [id, p] of Object.entries(dex)) {
    // Showdown keeps CAP fakemon and retired formes in the same table.
    if (!isCurrentGen(p) || !isCurrentGen(formats[id] ?? {})) continue
    if (!p.num || p.num < 1) continue // MissingNo and egg placeholders use num <= 0

    const bs = p.baseStats
    pokemon[id] = {
      num: p.num,
      name: p.name,
      types: p.types,
      baseStats: bs,
      bst: bs.hp + bs.atk + bs.def + bs.spa + bs.spd + bs.spe,
      abilities: p.abilities,
      heightm: p.heightm,
      weightkg: p.weightkg,
      gen: originGen(p.num),
      tier: formats[id]?.tier ?? p.tier ?? null,
      doublesTier: formats[id]?.doublesTier ?? p.doublesTier ?? null,
      ...(p.baseSpecies && { baseSpecies: p.baseSpecies }),
      ...(p.forme && { forme: p.forme }),
      ...(p.otherFormes && { otherFormes: p.otherFormes }),
      ...(p.prevo && { prevo: p.prevo }),
      ...(p.evos && { evos: p.evos }),
      ...(p.eggGroups && { eggGroups: p.eggGroups }),
    }
  }
  stats.pokemon = { kept: Object.keys(pokemon).length, dropped: Object.keys(dex).length - Object.keys(pokemon).length }

  // ---- Moves ---------------------------------------------------------------
  const movesOut = {}
  for (const [id, m] of Object.entries(moves)) {
    if (!isCurrentGen(m)) continue
    // Anything that shifts a stat, on either side of the field. Showdown splits
    // these across three places depending on whether the move targets self.
    const boosts = m.boosts ?? m.self?.boosts ?? m.selfBoost?.boosts ?? null
    movesOut[id] = {
      name: m.name,
      type: m.type,
      category: m.category,
      basePower: m.basePower,
      accuracy: m.accuracy, // `true` means "never misses"
      pp: m.pp,
      priority: m.priority,
      target: m.target,
      shortDesc: m.shortDesc ?? m.desc ?? '',
      ...(boosts && { boosts }),
      ...(m.status && { status: m.status }),
      ...(m.volatileStatus && { volatileStatus: m.volatileStatus }),
      ...(m.sideCondition && { sideCondition: m.sideCondition }),
      ...(m.slotCondition && { slotCondition: m.slotCondition }),
      ...(m.weather && { weather: m.weather }),
      ...(m.terrain && { terrain: m.terrain }),
      ...(m.selfSwitch && { selfSwitch: true }),
      ...(m.forceSwitch && { forceSwitch: true }),
      ...(m.drain && { drain: m.drain }),
      ...(m.recoil && { recoil: m.recoil }),
      ...(m.heal && { heal: m.heal }),
      ...(m.flags?.sound && { sound: true }),
      ...(m.flags?.contact && { contact: true }),
      ...(m.flags?.reflectable && { reflectable: true }),
      ...(m.flags?.wind && { wind: true }),
      ...(m.flags?.pivot && { pivot: true }),
    }
  }
  stats.moves = { kept: Object.keys(movesOut).length, dropped: Object.keys(moves).length - Object.keys(movesOut).length }

  // ---- Learnsets -----------------------------------------------------------
  // Sources are tagged like "9M" (TM), "9L45" (level 45), "9E" (egg), "9T"
  // (tutor). Keep only Gen 9 sources, then drop anything left empty.
  const learnOut = {}
  let sourcesKept = 0
  let sourcesTotal = 0
  for (const [id, entry] of Object.entries(learnsets)) {
    if (!pokemon[id] || !entry.learnset) continue
    const kept = {}
    for (const [move, sources] of Object.entries(entry.learnset)) {
      sourcesTotal += sources.length
      if (!movesOut[move]) continue
      const current = sources.filter((s) => s.startsWith(String(CURRENT_GEN)))
      if (!current.length) continue
      sourcesKept += current.length
      // Strip the redundant leading gen digit now that everything is Gen 9.
      kept[move] = current.map((s) => s.slice(1))
    }
    if (Object.keys(kept).length) learnOut[id] = kept
  }
  stats.learnsets = {
    kept: Object.keys(learnOut).length,
    sourcesKept,
    sourcesDropped: sourcesTotal - sourcesKept,
  }

  // ---- Type chart ----------------------------------------------------------
  // Showdown encodes it inverted: `damageTaken[Attacker]` where 0=normal,
  // 1=super effective, 2=resisted, 3=immune. Flip it into the multiplier table
  // the matchup views actually want: chart[attacking][defending] = multiplier.
  const TYPES = Object.keys(typechart)
    .filter((t) => typechart[t].damageTaken)
    .map((t) => t[0].toUpperCase() + t.slice(1))
  const CODE_TO_MULT = { 0: 1, 1: 2, 2: 0.5, 3: 0 }
  const chart = {}
  for (const atk of TYPES) {
    chart[atk] = {}
    for (const def of TYPES) {
      const code = typechart[def.toLowerCase()].damageTaken[atk]
      chart[atk][def] = CODE_TO_MULT[code] ?? 1
    }
  }
  stats.types = { count: TYPES.length }

  // ---- Abilities -----------------------------------------------------------
  const abilitiesOut = {}
  for (const [id, a] of Object.entries(abilities)) {
    if (!isCurrentGen(a)) continue
    abilitiesOut[id] = { name: a.name, shortDesc: a.shortDesc ?? a.desc ?? '' }
  }
  stats.abilities = { kept: Object.keys(abilitiesOut).length }

  // ---- Common sets ----------------------------------------------------------
  // What people actually run, so coverage can default to a real moveset instead
  // of every move a Pokémon could technically learn. Showdown ships two things
  // per format: `stats` is the single most-used set, `dex` is Smogon's curated
  // analysis sets. The usage set wins; curated sets fill the gaps.
  const setsRaw = await fetchJson('sets/gen9')
  // A doubles league cares about doubles first, then singles as a stand-in.
  const FORMAT_ORDER = [
    'gen9doublesou', 'gen9vgc2024', 'gen9ou', 'gen9ubers', 'gen9uu', 'gen9ru',
    'gen9nu', 'gen9pu', 'gen9zu', 'gen9lc', 'gen9nationaldex', 'gen9monotype',
    'gen9anythinggoes', 'gen91v1', 'gen9almostanyability', 'gen9balancedhackmons',
  ]

  const sets = {}
  for (const format of FORMAT_ORDER) {
    const block = setsRaw[format]
    if (!block) continue
    for (const [source, table] of [['usage', block.stats], ['smogon', block.dex]]) {
      for (const [name, entries] of Object.entries(table ?? {})) {
        const id = toId(name)
        if (!pokemon[id] || sets[id]) continue
        // Union across that Pokémon's sets in this format: a mon with a physical
        // and a special set can run either, and both are "common".
        const moveIds = new Set()
        for (const set of Object.values(entries ?? {})) {
          for (const move of set.moves ?? []) {
            // Slash-separated alternatives appear as "Knock Off / U-turn".
            for (const option of String(move).split('/')) {
              const mid = toId(option)
              if (movesOut[mid]) moveIds.add(mid)
            }
          }
        }
        if (moveIds.size) sets[id] = { moves: [...moveIds], source, format }
      }
    }
  }
  stats.sets = {
    covered: Object.keys(sets).length,
    fromUsage: Object.values(sets).filter((s) => s.source === 'usage').length,
    ofTotal: Object.keys(pokemon).length,
  }

  // ---- Write ---------------------------------------------------------------
  await mkdir(OUT, { recursive: true })
  const files = {
    pokemon: pokemon,
    moves: movesOut,
    learnsets: learnOut,
    typechart: { types: TYPES, chart },
    abilities: abilitiesOut,
    sets,
  }

  console.log(`\n${'file'.padEnd(16)}${'raw'.padStart(12)}${'gzipped'.padStart(12)}`)
  console.log('-'.repeat(40))
  let rawTotal = 0
  let gzTotal = 0
  for (const [name, data] of Object.entries(files)) {
    const json = JSON.stringify(data)
    const gz = gzipSync(json).length
    rawTotal += json.length
    gzTotal += gz
    await writeFile(join(OUT, `${name}.json`), json)
    console.log(`${(name + '.json').padEnd(16)}${kb(json.length).padStart(12)}${kb(gz).padStart(12)}`)
  }
  console.log('-'.repeat(40))
  console.log(`${'TOTAL'.padEnd(16)}${kb(rawTotal).padStart(12)}${kb(gzTotal).padStart(12)}\n`)
  console.log(JSON.stringify(stats, null, 2))
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
