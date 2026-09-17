/**
 * Reads each finished season's postseason out of the league's archive document,
 * and writes the finishing order into that season's JSON.
 *
 *   node scripts/import-postseason.mjs \
 *     --replays ~/Desktop/"Draft League Archive/NSIECPFL Draft League Archive.docx"
 *
 * A regular season decides who is good; a postseason decides who won. The site
 * was showing the first and calling it the standings, so Season 2 had Hunter on
 * top of a season Sean won. The document has the brackets and says outright who
 * the champion was — "No playoffs, Hunter is the champion!" — and this puts
 * that where the table can read it.
 *
 * The brackets name the players and link the replays but mostly do not say who
 * won, so the winners are read out of the replays with the same parser the
 * site's match reporter uses: the league plays on Showdown, and the log is the
 * record. Season 4 is the check on that — it marks six of its seven results by
 * hand ("Bikey vs Nolan (Bikey →)"), and the replays agree with all six.
 *
 * READ-ONLY on everything outside this repo: it opens the document, fetches
 * public replays, and writes into public/data. See CLAUDE.md.
 *
 * Run it AFTER `import-archive.mjs`, which writes the files this merges into.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
// The site's own replay parser, run straight from TypeScript — Node strips the
// types. One parser: the knockouts a playoff game is credited with here are
// attributed exactly the way the match reporter attributes a regular one.
import { fetchReplay } from '../src/lib/parseReplay.ts'

const run = promisify(execFile)

const flags = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) flags[a.slice(2)] = process.argv[++i]
}
if (!flags.replays) throw new Error('Missing --replays <archive.docx>')

const DATA = new URL('../public/data/', import.meta.url).pathname

/** Which file each season is served from, mirroring `SEASONS` in league.ts. */
const SEASONS = [
  { id: 'season-1', file: 'season-1.json', heading: 'SEASON ONE' },
  { id: 'season-2', file: 'season-2.json', heading: 'SEASON TWO' },
  { id: 'season-3', file: 'season-3.json', heading: 'SEASON THREE' },
  { id: 'season-4', file: 'league.json', heading: 'SEASON FOUR' },
]

// ---- reading the document ---------------------------------------------------

/**
 * The document's paragraphs, in order.
 *
 * `<w:t>` is the tag that holds text, and matching it needs the space: `<w:t`
 * followed by anything is also `<w:tblPr>`, `<w:tc>` and — the one that
 * actually bit — `<w:top>` inside a paragraph border. Matching those swallowed
 * the formatting XML as if it were prose and lost the paragraph's real words,
 * which is how four lines reading "Sean is the champion!" went missing.
 */
async function paragraphs(path) {
  const { stdout } = await run('unzip', ['-p', path, 'word/document.xml'],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' })
  const xml = stdout.toString('utf8')
  const text = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((p) => {
    const runs = [...p[0].matchAll(text)].map((m) => m[1])
    return runs.join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
  })
}

/** "Bikey vs Nolan (Bikey ->)", "Finals Season 2: Bikey v Sean". */
const FIXTURE = /^(?:(?:Season \d+\s+)?Finals?(?:\s+Season \d+)?:\s*)?([^:(]+?)\s+vs?\.?\s+([^:(]+?)(?:\s*\((.+?)\s*→\s*\))?$/

/** "No playoffs, Hunter is the champion!" */
const CHAMPION = /^(?:No playoffs,\s*)?(.+?)\s+is the champion!?$/i

/**
 * The bracket, from the playoff heading to the end of the season.
 *
 * `from` is that heading and not the season's own, because the fixtures above
 * it look exactly the same — "Hunter v Ferlo" is a week 1 match or a
 * semi-final depending only on where in the document it sits. Season 1 had no
 * playoffs at all, and reading its section for a bracket turned all twenty of
 * its regular-season fixtures into one.
 */
function readBracket(lines, from, to) {
  const matches = []
  let cur = null
  for (let i = from; i < to; i++) {
    const line = lines[i]
    if (!line) continue
    if (line.startsWith('http')) { cur?.replays.push(line); continue }
    if (/^Game \d+$/.test(line)) continue
    if (CHAMPION.test(line)) continue
    if (/PLAYOFF|postseason/i.test(line)) continue
    const m = FIXTURE.exec(line)
    if (!m) continue
    cur = {
      a: m[1].trim(), b: m[2].trim(),
      stated: m[3]?.trim() ?? null,
      final: /final/i.test(line),
      replays: [],
    }
    matches.push(cur)
  }
  return matches
}

// ---- reading the replays ----------------------------------------------------

const replayId = (input) => {
  const trimmed = input.trim().replace(/\?.*$/, '').replace(/\/$/, '')
  return /([a-z0-9]+-\d+(?:-[a-z0-9]+)?)$/i.exec(trimmed)?.[1] ?? null
}

/**
 * One playoff game: who won, under which accounts, and what each side's
 * Pokemon did.
 *
 * The teams and the knockouts are read as well as the result, because a season
 * can be asked to count its playoffs — and a playoff game's kills are kills.
 */
async function readReplay(url) {
  if (!replayId(url)) return { url, error: 'not a replay link' }
  try {
    const game = await fetchReplay(url)
    if (!game.a.account || !game.b.account) return { url, error: 'no players in the log' }
    return {
      url,
      a: game.a.account,
      b: game.b.account,
      winner: game.winner,
      sides: { a: game.a, b: game.b },
    }
  } catch (e) {
    return { url, error: e.message }
  }
}


// ---- names ------------------------------------------------------------------

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** The dex's own key, accents folded — the same one `src/data/load.ts` uses. */
const toId = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * What the document calls someone, against what the league's data calls them.
 *
 * The same person is `swjf` in one season and `sean` in another, and the
 * document uses whichever it felt like. These are the spellings that do not
 * reduce to a player id on their own; everything else matches by slug. Each was
 * confirmed by the Showdown account in the replay — "Mikey v Brandon" is
 * `BikeyTomato` against `bvb678`, the same two accounts as Bikey and Bargus
 * everywhere else.
 */
const SAME_PERSON = {
  mikey: 'bikey',
  brandon: 'bargus',
  philip: 'phillip',
  phil: 'ferlo',
  sean: 'swjf',
  swjf: 'sean',
  bikey: 'bikeytomato',
  bikeytomato: 'bikey',
  bargus: 'brandon',
  ferlo: 'philip',
}

/** Resolves a name the document uses to one of this season's player ids. */
function playerIn(season, name) {
  const want = slug(name)
  const ids = season.players.map((p) => p.id)
  const bySlug = new Map(ids.map((id) => [slug(id), id]))
  // The id itself, then the other spelling of the same person, then a player
  // id that starts with the name — `sean-swjf`, `austin-armadillo`.
  return bySlug.get(want)
    ?? bySlug.get(SAME_PERSON[want])
    ?? ids.find((id) => slug(id).startsWith(want) || want.startsWith(slug(id)))
    ?? null
}

/**
 * Which Showdown account belongs to which player, within one season.
 *
 * One season at a time, because a player id belongs to a season: the same
 * person is `swjf` in Season 2 and `sean` in Season 3, and solving across both
 * at once makes them two people competing for one account, which resolves
 * neither. A single bracket is self-contained and enough.
 *
 * Nothing in the archive says which is whose. It is worked out from it: a
 * player's account is in every replay of every match they played, so the
 * accounts common to all of them are the candidates, and two matches against
 * different opponents usually leave one. An account already pinned to somebody
 * is then struck from everyone else, which settles the players who only appear
 * once.
 */
function resolveAccounts(matches) {
  const candidates = new Map()
  for (const m of matches) {
    const seen = new Set(m.games.filter((g) => !g.error).flatMap((g) => [slug(g.a), slug(g.b)]))
    if (!seen.size) continue
    for (const id of [m.playerA, m.playerB]) {
      if (!id) continue
      const had = candidates.get(id)
      candidates.set(id, had ? new Set([...had].filter((x) => seen.has(x))) : seen)
    }
  }
  for (let pass = 0; pass < candidates.size + 1; pass++) {
    for (const [id, set] of candidates) {
      if (set.size !== 1) continue
      const [only] = set
      for (const [other, theirs] of candidates) if (other !== id) theirs.delete(only)
    }
  }
  const byAccount = new Map()
  const unresolved = []
  for (const [id, set] of candidates) {
    if (set.size === 1) byAccount.set([...set][0], id)
    else unresolved.push(id)
  }
  return { byAccount, unresolved }
}

// ---- the finishing order ----------------------------------------------------

/**
 * Who finished where.
 *
 * Only the players who reached the postseason are placed; everybody else keeps
 * the order the regular season put them in, which the site already computes.
 * The champion is whoever the document says, not whoever this works out — it
 * is the league's own word, and the replays are only asked who won each match.
 *
 * Under the champion it is how far they got: postseason wins first, then fewest
 * postseason losses, which separates a coach who went out in the semi-final
 * from one who went out in the first round, and puts a group stage's 1-1 above
 * its 0-2.
 *
 * That is as far as a bracket can answer. Two coaches who both went out in the
 * semi-finals are level in it, and no third-place match was ever played to
 * separate them — so they are given the same number here and the site breaks
 * the tie on the regular season, where Sean's 13-2 stands above Bray's 8-7.
 * Deciding it here instead would have meant deciding it by the order the
 * archive happens to list the matches in, which is how Bray had the bronze.
 */
function placements(matches, champion) {
  const record = new Map()
  const of = (id) => record.get(id) ?? record.set(id, { wins: 0, losses: 0 }).get(id)
  for (const m of matches) {
    if (m.playerA) of(m.playerA)
    if (m.playerB) of(m.playerB)
    if (!m.winner) continue
    const loser = m.winner === m.playerA ? m.playerB : m.playerA
    of(m.winner).wins++
    if (loser) of(loser).losses++
  }
  if (champion) of(champion)
  const further = (a, b) => {
    if (a === champion) return -1
    if (b === champion) return 1
    return record.get(b).wins - record.get(a).wins
      || record.get(a).losses - record.get(b).losses
  }
  const order = [...record.keys()].sort(further)
  // Competition ranking: everyone level shares the place, and the next one
  // down skips past all of them. Ties are deliberate — see above.
  const placement = {}
  order.forEach((id, i) => {
    const level = i > 0 && further(order[i - 1], id) === 0
    placement[id] = level ? placement[order[i - 1]] : i + 1
  })
  return {
    placement,
    record: Object.fromEntries([...record].map(([id, r]) => [id, r])),
  }
}

// ---- run --------------------------------------------------------------------

const lines = await paragraphs(flags.replays)

/** Where each season's text begins, so a bracket is read against its own season. */
const starts = SEASONS.map((s) => ({
  ...s,
  at: lines.findIndex((l) => l.toUpperCase().startsWith(`${s.heading}:`)),
}))
for (const s of starts) {
  if (s.at < 0) throw new Error(`No "${s.heading}" heading in that document`)
}

const brackets = []
for (const [i, season] of starts.entries()) {
  const to = i + 1 < starts.length ? starts[i + 1].at : lines.length
  const own = (from) => lines.slice(from, to)
  // The champion is stated anywhere in the season; the bracket only ever
  // follows a playoff heading, and a season without one has no bracket rather
  // than a whole regular season's worth.
  const said = own(season.at).map((l) => CHAMPION.exec(l)).find(Boolean)
  const head = lines.findIndex((l, n) =>
    n > season.at && n < to && /PLAYOFFS?$|^Potential postseason$/i.test(l))
  brackets.push({
    ...season,
    champion: said?.[1].trim() ?? null,
    matches: head >= 0 ? readBracket(lines, head, to) : [],
  })
}

console.log('--- brackets ---')
for (const b of brackets) {
  console.log(`  ${b.id}: ${b.matches.length ? `${b.matches.length} matches` : 'no playoffs'}`
    + `, champion ${b.champion ?? '(none stated)'}`)
}

// Names, then replays, then accounts, then results — each needs the one before.
const leagues = {}
for (const b of brackets) {
  leagues[b.id] = JSON.parse(await readFile(DATA + b.file, 'utf8'))
  const missing = []
  for (const m of b.matches) {
    m.playerA = playerIn(leagues[b.id], m.a)
    m.playerB = playerIn(leagues[b.id], m.b)
    if (!m.playerA) missing.push(m.a)
    if (!m.playerB) missing.push(m.b)
  }
  if (b.champion) {
    b.championId = playerIn(leagues[b.id], b.champion)
    if (!b.championId) missing.push(b.champion)
  }
  if (missing.length) {
    throw new Error(`${b.id}: no player for ${[...new Set(missing)].join(', ')}`)
  }
}

console.log('\n--- replays ---')
let fetched = 0
for (const b of brackets) {
  for (const m of b.matches) {
    m.games = []
    for (const url of m.replays) { m.games.push(await readReplay(url)); fetched++ }
  }
}
const failed = brackets.flatMap((b) => b.matches.flatMap((m) => m.games)).filter((g) => g.error)
console.log(`  ${fetched} fetched, ${failed.length} could not be read`)
for (const g of failed) console.log(`    ${g.error}: ${g.url}`)

console.log('\n--- results ---')
const notes = []
for (const b of brackets) {
  const { byAccount, unresolved } = resolveAccounts(b.matches)
  if (unresolved.length) {
    throw new Error(`${b.id}: no Showdown account for ${unresolved.join(', ')}`)
  }
  console.log(`\n  ${b.id}`
    + (byAccount.size ? `  (${[...byAccount].map(([a, i]) => `${a}=${i}`).join(', ')})` : ''))
  for (const m of b.matches) {
    let a = 0, b_ = 0, strays = 0
    // Every Pokemon's line in the series, one side each, totalled across its
    // games — the same shape a regular-season match keeps, so the stats tab
    // can add the two together without knowing which is which.
    const lines = { [m.playerA]: new Map(), [m.playerB]: new Map() }
    for (const g of m.games) {
      if (g.error || !g.winner) continue
      const one = byAccount.get(slug(g.a))
      const two = byAccount.get(slug(g.b))
      const ours = (one === m.playerA && two === m.playerB)
        || (one === m.playerB && two === m.playerA)
      // A link filed under the wrong match. Counting it would hand the game to
      // somebody who was not playing in this one.
      if (!ours) { strays++; continue }
      const won = g.winner === 'a' ? one : two
      if (won === m.playerA) a++
      else b_++

      for (const [key, id] of [['a', one], ['b', two]]) {
        const side = g.sides[key]
        const mine = lines[id]
        for (const l of side.lines) {
          // A previewed Pokemon that never came in did not play; counting it
          // would give every bench Pokemon a game with nothing in it.
          if (!l.brought) continue
          const mon = toId(l.pokemon)
          const had = mine.get(mon) ?? { pokemon: mon, kills: 0, deaths: 0 }
          had.kills += l.kills
          had.deaths += l.deaths
          mine.set(mon, had)
        }
      }
    }
    m.scoreA = a
    m.scoreB = b_
    m.winner = a > b_ ? m.playerA : b_ > a ? m.playerB : null
    m.lines = lines
    const stated = m.stated ? playerIn(leagues[b.id], m.stated) : null
    if (stated && m.winner !== stated) {
      throw new Error(`${b.id}: the document says ${m.stated} won ${m.a} v ${m.b},`
        + ` the replays say ${m.winner ?? 'nobody'}`)
    }
    if (!m.winner) {
      notes.push(`${b.id}: ${m.playerA} v ${m.playerB} has no result`
        + (strays ? ` (${strays} of its links belong to another match)` : ''))
    }
    console.log(`    ${m.final ? 'FINAL' : '     '} ${String(m.playerA).padEnd(10)}`
      + ` ${a}-${b_} ${String(m.playerB).padEnd(10)}`
      + ` -> ${m.winner ?? '(no result)'}`
      + (stated ? '   document agrees' : '')
      + (strays ? `   [${strays} stray link]` : ''))
  }
}

console.log('\n--- finishing order ---')
for (const b of brackets) {
  const { placement, record } = placements(b.matches, b.championId)
  const league = leagues[b.id]
  const named = Object.fromEntries(league.players.map((p) => [p.id, p.name]))
  
  league.postseason = {
    champion: b.championId,
    matches: b.matches.map((m) => ({
      round: m.final ? 'Final' : null,
      a: m.playerA, b: m.playerB, scoreA: m.scoreA, scoreB: m.scoreB,
      winner: m.winner, replays: m.replays,
    })),
    placement,
    // One entry per series, in the shape `totalsFromMatches` already reads, so
    // counting the playoffs is concatenating two lists. Week 0: a playoff match
    // belongs to no week of the season.
    matchStats: b.matches.map((m) => {
      const side = (id, mine) => ({
        team: named[id] ?? id,
        result: !m.winner ? null : m.winner === id ? 'W' : 'L',
        score: mine,
        lines: [...(m.lines[id]?.values() ?? [])],
      })
      return {
        week: 0,
        a: side(m.playerA, m.scoreA),
        b: side(m.playerB, m.scoreB),
      }
    }),
  }
  await writeFile(DATA + b.file, JSON.stringify(league, null, 1))
  console.log(`\n  ${b.id} -> data/${b.file}`)
  for (const [id, rank] of Object.entries(placement)) {
    const r = record[id]
    console.log(`    ${String(rank).padStart(2)}. ${(named[id] ?? id).padEnd(20)}`
      + (r && (r.wins || r.losses) ? `${r.wins}-${r.losses} in the postseason` : 'no playoffs')
      + (rank === 1 ? '   CHAMPION' : ''))
  }
}

if (notes.length) {
  console.log('\n--- left to the regular season ---')
  for (const n of notes) console.log(`  ${n}`)
}
