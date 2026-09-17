/**
 * Builds the static Pokemon dataset that ships with the site.
 *
 * Source is Pokemon Showdown's battle data, which is already normalized around
 * competitive play (base stats, abilities, tiers, learnsets) rather than the
 * lore-and-flavor shape PokeAPI returns. Generation 9 is the baseline: no
 * past-gen-only moves, and no species the current games do not have.
 *
 * Species are the exception: every real one is kept, of every generation, so a
 * season drafting outside the current games — Champions, or a National Dex
 * Little Cup — has a dex that knows what it drafted. Only Smogon's invented
 * Pokémon are dropped. See `isFakemon` below.
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
 * Whether a forme is a Mega or a Primal, which the dataset treats specially in
 * two places: a Mega has one ability rather than a choice of three, and it is
 * an evolution of something, which the site draws it as.
 *
 * "Mega" is matched as a whole segment of the forme, anywhere in it, and not
 * as a prefix. Six of them Mega Evolve from a forme rather than from a species
 * and are named for both — "M-Mega" and "F-Mega" for the two Meowstics,
 * "Curly-Mega" and its siblings for the three Tatsugiri, "Original-Mega" for
 * Magearna — and anchoring to the start dropped every one of them. It is still
 * read off the forme and by segment rather than off the name, because
 * "Meganium" and "Yanmega" both contain the word.
 */
const isMega = (entry) => /(^|-)(Mega|Primal)(-|$)/.test(entry.forme ?? '')

/**
 * Which Pokemon a Mega is the Mega of.
 *
 * Usually the base species, and for most of them the name says so: strip
 * "-Mega" off Charizard-Mega-X and Charizard is left. Not always, though.
 * Meowstic-F-Mega Megas from Meowstic-F, a different Pokemon from Meowstic
 * with a different movepool, and reading the base species would send it to
 * the wrong one. So the forme is read first and only falls back to the base
 * species when there is no such forme in the dex.
 */
const megaEvolvesFrom = (entry, exists) => {
  const from = (entry.forme ?? '').replace(/(^|-)(Mega|Primal)(-.*)?$/, '')
  const forme = from && toId(`${entry.baseSpecies}-${from}`)
  return forme && exists(forme) ? forme : toId(entry.baseSpecies)
}

/**
 * Every Pokémon there is, rather than only the ones the current games have.
 *
 * This used to be Gen 9 plus a growing pile of exceptions: the Megas, the base
 * forme of each Mega, a list of what Pokémon Champions brings back for Season
 * 5, a list of the National Dex Little Cup board Season 3 drafted. Each was
 * written out by hand after a season turned up Pokémon the site could not name
 * or draw, and each only covered the season that prompted it — the next
 * National Dex season would have started the cycle again.
 *
 * So the line moved. Anything with a real dex number is kept, whatever the
 * current games think of it, which is every stage of every evolution line and
 * every regional forme from Kanto to Paldea. What a season may actually draft
 * was never decided here anyway — that is its board.
 *
 * Fakemon are still out. CAP is Smogon's own invented Pokémon and "Custom" is
 * the engine's scratch space; neither has ever been in a game.
 */
const isFakemon = (entry) => ['CAP', 'Custom'].includes(entry.isNonstandard)

/**
 * Whether a learnset source is a way of actually learning the move.
 *
 * Showdown's letter says how: L level, M machine, E breeding, T tutor, S event.
 * Two others are not methods at all. `V` means the move only came along on a
 * Pokemon transferred in from an older game, and `R` means the forme is
 * required to know it — Rotom-Heat and Overheat, Zacian-Crowned and Behemoth
 * Blade. Neither is something a view can file under a heading.
 */
const isLearnable = (method) => 'LMETS'.includes(method)

/**
 * Showdown marks anything unavailable in the current games with `isNonstandard`
 * ("Past", "CAP", "Future", "Custom"). Null means legal right now.
 *
 * Moves and abilities are held to it; species are not. A season can draft a
 * Pokemon the current games left out — Season 3 drafted a hundred and sixty of
 * them — but it still plays under this generation's rules, so that Pokemon
 * brings the movepool and the abilities it has today, not the ones it had in
 * Gen 5. Hidden Power is gone for everyone, which is why Unown, whose whole
 * movepool was Hidden Power, has no moves at all.
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
    // Showdown keeps its own invented Pokémon in the same table as the real
    // ones, and a handful of engine placeholders below dex number one.
    if (isFakemon(p)) continue
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
  // Recorded on the entry rather than worked out again in the browser, so the
  // rule lives in one place. Only where it is not simply the base species,
  // which is all but two of the ninety-three.
  for (const p of Object.values(pokemon)) {
    if (!isMega(p)) continue
    const from = megaEvolvesFrom(p, (id) => id in pokemon)
    if (from !== toId(p.baseSpecies)) p.megaBase = from
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
     *
     * The newest generation that records a way of *learning* something, which
     * is not always the newest generation present. Pidgeot, Beedrill and Paras
     * each have a Gen 8 entry holding nothing but transfer marks — every real
     * method stopped at Gen 7 — so taking the highest number gave them
     * twenty-odd moves that no view could file anywhere and a page that looked
     * like the Pokemon had no moves at all.
     */
    const learnable = new Set()
    const present = new Set()
    for (const sources of Object.values(entry.learnset)) {
      for (const source of sources) {
        present.add(Number(source[0]))
        if (isLearnable(source[1])) learnable.add(Number(source[0]))
      }
    }
    if (!present.size) continue
    const gen = learnable.has(CURRENT_GEN) ? CURRENT_GEN
      // Nothing learnable anywhere is a forme whose whole entry is its required
      // move; it keeps that, and takes the rest from the Pokemon it is a forme of.
      : Math.max(...(learnable.size ? learnable : present))
    if (gen !== CURRENT_GEN) fromOlderGen++

    const kept = {}
    for (const [move, sources] of Object.entries(entry.learnset)) {
      sourcesTotal += sources.length
      if (!movesOut[move]) continue
      /*
       * Only the ways it can actually be learned, plus the forme's required
       * move. A transfer mark is not a way of learning anything — the move came
       * along on a Pokemon moved in from an older game — and nothing downstream
       * treats it as one: the moves table files sources under headings and has
       * no heading for it, so those moves were in the data and on no page.
       * Coverage does not read the heading, though, and was counting attacking
       * types off moves that cannot be used.
       */
      const current = sources.filter((s) =>
        s.startsWith(String(gen)) && (isLearnable(s[1]) || s[1] === 'R'))
      if (!current.length) continue
      sourcesKept += current.length
      // Strip the leading gen digit: which generation a move was learned in is
      // not something any view asks, and for these it would be misleading.
      kept[move] = current.map((s) => s.slice(1))
    }
    if (Object.keys(kept).length) learnOut[id] = kept
  }
  // A forme learns what its parent forme learns, unless Showdown gives it a
  // learnset of its own. That is how Showdown resolves one — it ships nothing
  // under a Mega's id at all, and nothing under Squawkabilly-Blue's or
  // Landorus-Therian's either — so the parent's moves are copied across. It is
  // also the whole reason a Mega's base is kept even where the current games
  // have dropped it: without it, sixty formes had no moves.
  //
  // `megaBase` where there is one, because a Mega that evolves from a forme
  // inherits from that forme: Meowstic-F-Mega learns what Meowstic-F learns,
  // and copying the male's movepool onto her was wrong in seven moves.
  let inherited = 0
  let topped = 0
  for (const [id, p] of Object.entries(pokemon)) {
    if (!p.baseSpecies) continue
    const base = learnOut[p.megaBase ?? toId(p.baseSpecies)]
    if (!base) continue
    const own = learnOut[id]
    if (!own) { learnOut[id] = base; inherited++; continue }

    /*
     * An entry holding no learnable source is not a movepool — it is the one
     * move the forme is required to know, listed on its own. Rotom-Heat's is
     * Overheat, Zacian-Crowned's is Behemoth Blade. Read as a pool it replaced
     * the base's, so five Rotoms, two Necrozmas and two heroes of Galar each
     * showed exactly one move and no way to file it.
     *
     * Added to the base's rather than replacing it, which is what it is.
     */
    const hasPool = Object.values(own).some((sources) => sources.some((s) => isLearnable(s[0])))
    if (!hasPool) { learnOut[id] = { ...base, ...own }; topped++ }
  }
  stats.learnsets = {
    kept: Object.keys(learnOut).length,
    inheritedFromBase: inherited,
    signatureToppedUp: topped,
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
  // Showdown abbreviates a sex inside a forme and PokeAPI spells it out, which
  // no amount of prefix matching bridges in the middle of a name: "M-Mega" is
  // PokeAPI's "male-mega". Trailing ones came out in the wash already, because
  // "meowstic-female" starts with "meowsticf" — the two Meowstic Megas did not,
  // and wore plain Meowstic's drawing. M and F are the only one- and
  // two-letter forme segments in the dex besides Mega's X, Y and Z, and every
  // one of them is a sex.
  const SEX = { m: 'male', f: 'female' }
  const spelledOut = (p) => toId([
    p.baseSpecies,
    ...p.forme.split('-').map((part) => SEX[part.toLowerCase()] ?? part),
  ].join('-'))

  let artMatched = 0
  for (const [, p] of formes) {
    const options = (varieties.get(p.num) ?? []).filter((v) => !v.isDefault)
    const keys = [...new Set([toId(p.name), p.forme ? spelledOut(p) : null].filter(Boolean))]
    const hit = keys.reduce((found, key) => found
      ?? options.find((v) => v.key === key)
      ?? options
        .filter((v) => v.key.startsWith(key) || key.startsWith(v.key))
        .sort((a, b) => a.key.length - b.key.length)[0], undefined)
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
