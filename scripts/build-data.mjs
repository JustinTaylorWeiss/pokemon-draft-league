/**
 * Builds the static Pokemon dataset that ships with the site.
 *
 * Source is Pokemon Showdown's battle data, which is already normalized around
 * competitive play (base stats, abilities, tiers, learnsets) rather than the
 * lore-and-flavor shape PokeAPI returns. Generation 9 is the baseline: no
 * past-gen-only moves, and no species the current games do not have.
 *
 * Three sets of species are kept past that line, each because the league needs
 * them and none because Showdown says so: Mega and Primal formes, the base
 * forme of every Mega kept, and the species Pokemon Champions brings back that
 * Scarlet/Violet dropped. See `isKeptMega` and `CHAMPIONS_RETURNS` below.
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
 * ("Past", "CAP", "Future", "Custom"). Null means legal right now.
 *
 * Mega and Primal formes are the exception, and are kept despite the mark. A
 * Mega season needs them, and Showdown files them either as "Past" (the Gen 6
 * and 7 Megas) or "Future" (the ones announced for Legends Z-A) — neither of
 * which is a statement about this league. Which of them a season may actually
 * draft is decided by that season's board, not here; this only decides what the
 * site knows about them.
 */
const isMega = (entry) => /^(Mega|Primal)/.test(entry.forme ?? '')

/**
 * The exception is only for real Megas. CAP has drawn one of its own
 * (Crucibelle-Mega), and it is a fakemon like the rest of CAP: the mark that
 * keeps Crucibelle out keeps its Mega out too.
 */
const isKeptMega = (entry) =>
  isMega(entry) && (!entry.isNonstandard || ['Past', 'Future'].includes(entry.isNonstandard))

/**
 * Species Pokemon Champions has that Scarlet/Violet does not.
 *
 * Season 5 is played in Champions, and Champions' roster is not Gen 9's: it
 * brings back Pokemon Showdown still files as "Past" because the Switch games
 * dropped them. The league's Regulation M-C list prices all of these, so the
 * site has to know them or a priced Pokemon has no page, no stats and no sprite.
 *
 * Written out rather than derived, because nothing in Showdown's data says what
 * Champions has — this list came from the league's own board. A later
 * regulation that brings more back extends it.
 *
 * Gourgeist is here with all four sizes: the league prices them together, and
 * the sizes are a real competitive choice (they differ in HP and Speed), not a
 * cosmetic one like Vivillon's patterns.
 */
const CHAMPIONS_RETURNS = new Set([
  'aegislash', 'aromatisse', 'aurorus', 'castform', 'cofagrigus', 'diggersby',
  'emolga', 'farfetchd', 'floetteeternal', 'furfrou', 'garbodor',
  'gourgeist', 'gourgeistsmall', 'gourgeistlarge', 'gourgeistsuper',
  'grapploct', 'heliolisk', 'liepard', 'machamp', 'mrmime', 'mrrime',
  'musharna', 'pangoro', 'roserade', 'runerigus', 'simipour', 'simisage',
  'simisear', 'sirfetchd', 'slurpuff', 'stunfisk', 'stunfiskgalar', 'thievul',
  'tyrantrum', 'vanilluxe', 'watchog',
])

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
  /**
   * The base forme of every Mega worth keeping, kept with it.
   *
   * A Mega is only half an entry on its own: the site files it one evolution on
   * from its base, and its movepool is the base's, because Showdown ships none
   * under a Mega's own id. Twenty-two Megas had neither — Aerodactyl, Alakazam,
   * Kangaskhan and the rest left Scarlet/Violet and took their Megas' moves
   * with them — so the base comes along whatever the current games think of it.
   */
  const megaBases = new Set(
    Object.values(dex).filter(isKeptMega).map((p) => toId(p.baseSpecies)),
  )

  const pokemon = {}
  for (const [id, p] of Object.entries(dex)) {
    // Showdown keeps CAP fakemon and retired formes in the same table. The
    // `formats` check is skipped for Megas as well as the dex one: it marks
    // them by the same rule, and it has no forme to recognise them by.
    const kept = isKeptMega(p) || megaBases.has(id) || CHAMPIONS_RETURNS.has(id)
    if (!kept && (!isCurrentGen(p) || !isCurrentGen(formats[id] ?? {}))) continue
    if (!p.num || p.num < 1) continue // MissingNo and egg placeholders use num <= 0

    const bs = p.baseStats
    pokemon[id] = {
      num: p.num,
      name: p.name,
      types: p.types,
      baseStats: bs,
      bst: bs.hp + bs.atk + bs.def + bs.spa + bs.spd + bs.spe,
      // A Mega or Primal forme has exactly one ability. Legends Z-A has no
      // abilities at all, so Showdown gives the Megas it introduced a stand-in
      // until Pokémon Champions fixes the real one — and for some, that
      // stand-in is both of the base forme's slots, which would show as a
      // second ability the Mega cannot have.
      abilities: isMega(p) ? { 0: p.abilities[0] } : p.abilities,
      heightm: p.heightm,
      weightkg: p.weightkg,
      // Showdown gives either a ratio or a single-gender/genderless marker.
      ...(p.genderRatio && { genderRatio: p.genderRatio }),
      ...(p.gender && { gender: p.gender }),
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
  let fromOlderGen = 0
  for (const [id, entry] of Object.entries(learnsets)) {
    if (!pokemon[id] || !entry.learnset) continue
    /**
     * Which generation's movepool to read.
     *
     * Gen 9 for anything Gen 9 has. A species it does not — the ones Champions
     * brings back, and the Mega bases that left with them — has no Gen 9
     * sources at all, because Gen 9 never had the Pokemon. Showdown will not
     * know what Champions gives them back until Champions is playable there, so
     * the newest movepool it does record stands in. It is still filtered to
     * moves that exist in Gen 9 below, so nothing retired comes back with it.
     */
    const gens = new Set()
    for (const sources of Object.values(entry.learnset)) {
      for (const source of sources) gens.add(Number(source[0]))
    }
    if (!gens.size) continue
    const gen = gens.has(CURRENT_GEN) ? CURRENT_GEN : Math.max(...gens)
    if (gen !== CURRENT_GEN) fromOlderGen++

    const kept = {}
    for (const [move, sources] of Object.entries(entry.learnset)) {
      sourcesTotal += sources.length
      if (!movesOut[move]) continue
      const current = sources.filter((s) => s.startsWith(String(gen)))
      if (!current.length) continue
      sourcesKept += current.length
      // Strip the leading gen digit: which generation a move was learned in is
      // not something any view asks, and for these it would be misleading.
      kept[move] = current.map((s) => s.slice(1))
    }
    if (Object.keys(kept).length) learnOut[id] = kept
  }
  // A forme learns what its base forme learns, unless Showdown gives it a
  // learnset of its own. That is how Showdown resolves one — it ships nothing
  // under a Mega's id at all, and nothing under Squawkabilly-Blue's or
  // Landorus-Therian's either — so the base's moves are copied across. It is
  // also the whole reason a Mega's base is kept even where the current games
  // have dropped it: without it, sixty formes had no moves.
  let inherited = 0
  for (const [id, p] of Object.entries(pokemon)) {
    if (!p.baseSpecies || learnOut[id]) continue
    const base = learnOut[toId(p.baseSpecies)]
    if (!base) continue
    learnOut[id] = base
    inherited++
  }
  stats.learnsets = {
    kept: Object.keys(learnOut).length,
    inheritedFromBase: inherited,
    fromOlderGen,
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
  // Showdown marks the abilities Legends Z-A gave its new Megas — Aura Guard,
  // Dragonize, Mega Sol and the rest — "Future", by the same rule that marks
  // the Megas themselves. An ability a kept Pokémon actually has stays
  // regardless, or the Mega would be shown with a name and no description.
  const held = new Set()
  for (const p of Object.values(pokemon)) {
    for (const name of Object.values(p.abilities)) held.add(toId(name))
  }
  const abilitiesOut = {}
  for (const [id, a] of Object.entries(abilities)) {
    if (!isCurrentGen(a) && !held.has(id)) continue
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
        if (!moveIds.size) continue
        sets[id] = {
          // The union, kept flat and id-keyed because the coverage panel reads
          // it directly as "what this Pokemon plausibly runs".
          moves: [...moveIds],
          source,
          format,
          // The spreads behind that pool, so a Pokemon's page can show a set
          // the way a teambuilder would rather than just a list of moves.
          // Display names, not ids: these are rendered, not looked up, and
          // slashed alternatives stay readable as "Knock Off / U-turn".
          spreads: Object.entries(entries ?? {}).map(([setName, set]) => ({
            name: setName,
            moves: (set.moves ?? []).map(String),
            ...(set.item && { item: set.item }),
            ...(set.ability && { ability: set.ability }),
            ...(set.nature && { nature: set.nature }),
            ...(set.teraType && { teraType: set.teraType }),
            ...(set.level && set.level !== 100 && { level: set.level }),
            evs: set.evs ?? {},
            ...(set.ivs && { ivs: set.ivs }),
          })),
        }
      }
    }
  }
  // ---- items ----------------------------------------------------------------
  // Only the ones our sets actually reference. Showdown draws item icons from a
  // single sprite sheet rather than per-item files — the individual PNGs 404
  // for anything recent — so what gets stored is the sheet offset.
  const itemsRaw = await fetchScript('items')
  const usedItems = new Set()
  for (const set of Object.values(sets)) {
    for (const spread of set.spreads) if (spread.item) usedItems.add(toId(spread.item))
  }
  const items = {}
  for (const id of usedItems) {
    const it = itemsRaw[id]
    if (!it || typeof it.spritenum !== 'number') continue
    items[id] = {
      name: it.name,
      spritenum: it.spritenum,
      desc: it.shortDesc ?? it.desc ?? '',
    }
  }
  stats.items = { kept: Object.keys(items).length, referenced: usedItems.size }

  stats.sets = {
    covered: Object.keys(sets).length,
    fromUsage: Object.values(sets).filter((s) => s.source === 'usage').length,
    ofTotal: Object.keys(pokemon).length,
  }

  // ---- Artwork --------------------------------------------------------------
  // Official artwork comes from PokeAPI's sprite repository, filed by PokeAPI's
  // own id — which for a forme is not the dex number. Venusaur is 3 and
  // Venusaur-Mega is 10033, and without the mapping every forme wears its
  // base's picture. PokeAPI lists a species' formes as "varieties", named the
  // way Showdown names them once the punctuation is folded, give or take a
  // suffix ("tauros-paldea-aqua-breed", "indeedee-female"): an exact match
  // wins, and the shortest name either side is a prefix of stands in for the
  // rest. A forme that matches nothing keeps its base's artwork, which is what
  // it showed before.
  const POKEAPI = 'https://pokeapi.co/api/v2'
  const formes = Object.entries(pokemon).filter(([, p]) => p.baseSpecies)
  const speciesQueue = [...new Set(formes.map(([, p]) => p.num))]
  const varieties = new Map()
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (speciesQueue.length) {
      const num = speciesQueue.shift()
      try {
        const res = await fetch(`${POKEAPI}/pokemon-species/${num}`)
        if (!res.ok) continue
        const species = await res.json()
        varieties.set(num, species.varieties.map((v) => ({
          key: toId(v.pokemon.name),
          id: Number(v.pokemon.url.split('/').filter(Boolean).pop()),
          isDefault: v.is_default,
        })))
      } catch {
        // Left without: the base's drawing is the fallback, as it always was.
      }
    }
  }))
  let artMatched = 0
  for (const [, p] of formes) {
    const options = (varieties.get(p.num) ?? []).filter((v) => !v.isDefault)
    const key = toId(p.name)
    const hit = options.find((v) => v.key === key)
      ?? options
        .filter((v) => v.key.startsWith(key) || key.startsWith(v.key))
        .sort((a, b) => a.key.length - b.key.length)[0]
    if (hit && hit.id !== p.num) {
      p.artId = hit.id
      artMatched++
    }
  }
  stats.artwork = { formes: formes.length, matched: artMatched, speciesAsked: varieties.size }

  // ---- Write ---------------------------------------------------------------
  await mkdir(OUT, { recursive: true })
  const files = {
    pokemon: pokemon,
    moves: movesOut,
    learnsets: learnOut,
    typechart: { types: TYPES, chart },
    abilities: abilitiesOut,
    sets,
    items,
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
