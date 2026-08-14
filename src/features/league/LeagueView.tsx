import { useEffect, useMemo, useState } from 'react'
import { loadPokemon, spriteUrl } from '../../data/load'
import type { PokemonDex } from '../../data/types'
import {
  byId, byTier, currentSeason, loadLeague, mergeDex, reloadSeason, subscribeLeague, tierClass,
  totalsFromMatches, type Standing,
  type GameLine, type League, type LeaguePokemon, type PokemonTotals,
} from '../../data/league'
import { BST_ORDER, STAT_LABELS } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import { ReportMatch } from './ReportMatch'
import { ManagePlayers } from './ManagePlayers'
import type { LeagueTab } from './tabs'
import './league.css'
import { PokemonLink } from '../../components/PokemonLink'

export function LeagueView({ tab }: { tab: LeagueTab }) {
  const [league, setLeague] = useState<League | null>(null)
  const [rawDex, setRawDex] = useState<PokemonDex | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([loadLeague(), loadPokemon()]).then(
      ([l, d]) => { setLeague(l); setRawDex(d) },
      (err: Error) => setError(err.message),
    )
    // A sheet refresh republishes the league; pick it up without a reload.
    return subscribeLeague(setLeague)
  }, [])

  /** Sheet values win over the Showdown dataset everywhere they overlap. */
  const dex = useMemo(
    () => (rawDex ? mergeDex(rawDex, league) : null),
    [rawDex, league],
  )

  if (error) {
    return (
      <p className="error">
        Could not load the league sheet: {error}. Run <code>npm run import:league -- &lt;file-or-url&gt;</code> first.
      </p>
    )
  }
  if (!league || !dex) return <p className="loading">Loading league…</p>

  return (
    <div className="league">
      {tab === 'standings' && <Standings league={league} />}
      {tab === 'players' && <Players league={league} dex={dex} />}
      {tab === 'matches' && <Matches league={league} dex={dex} />}
      {tab === 'board' && <Board league={league} dex={dex} />}
      {tab === 'stats' && <Stats league={league} dex={dex} />}
      {tab === 'rules' && <Rules league={league} />}
    </div>
  )
}

/** Podium markers for the top three, keyed by rank. */
const MEDALS: Record<number, { icon: string; label: string }> = {
  1: { icon: '🥇', label: '1st' },
  2: { icon: '🥈', label: '2nd' },
  3: { icon: '🥉', label: '3rd' },
}

/**
 * A never-fainted Pokémon has an infinite K/D, and `Infinity - Infinity` is
 * NaN, so ratios are compared through a finite stand-in rather than silently
 * losing their ordering.
 */
const finite = (n: number) => (n === Infinity ? Number.MAX_VALUE : n)

/**
 * The ranking shown when no column is sorted. Each step only decides the rows
 * the one before it left tied.
 */
const byPowerRanking = (a: PokemonTotals, b: PokemonTotals) =>
  b.diff - a.diff
  || finite(b.kd) - finite(a.kd)
  || b.killsPerGame - a.killsPerGame
  || b.kills - a.kills
  || b.gamesPlayed - a.gamesPlayed
  || a.deaths - b.deaths

/** The same order, said in words, for the header. */
const POWER_RANKING_NOTE = 'Diff → K/D → KOs/game → KOs → games → fewest deaths'

type StatSort = 'kills' | 'deaths' | 'diff' | 'gamesPlayed' | 'killsPerGame' | 'kd' | 'name'

function Stats({ league, dex }: { league: League; dex: Record<string, LeaguePokemon> }) {
  // dir 0 is the power ranking above; a column cycles through both directions
  // and back to it.
  const [sort, setSort] = useState<{ key: StatSort; dir: 1 | -1 | 0 }>({ key: 'kills', dir: 0 })

  const toggleSort = (key: StatSort) =>
    setSort((prev) => {
      // Numbers open highest-first; the name column opens A-Z.
      const first: 1 | -1 = key === 'name' ? 1 : -1
      if (prev.key !== key) return { key, dir: first }
      if (prev.dir === first) return { key, dir: (first === 1 ? -1 : 1) as 1 | -1 }
      if (prev.dir !== 0) return { key, dir: 0 }
      return { key, dir: first }
    })
  const [query, setQuery] = useState('')

  const matches = useMemo(() => league.matchStats ?? [], [league.matchStats])

  /** The whole season, always: a ranking of the season is the point. */
  const totals = useMemo(() => Object.values(totalsFromMatches(matches)), [matches])

  /** Still grouped by week further down, where the match log is. */
  const weeks = useMemo(
    () => [...new Set(matches.map((m) => m.week))].sort((a, b) => a - b),
    [matches],
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return totals
      .filter((t) => !q || dex[t.pokemon]?.name.toLowerCase().includes(q))
      // KOs per game breaks ties: two Pokémon on the same total are separated
      // by how few games it took. The tiebreak keeps its own direction so it
      // stays meaningful when the column is flipped.
      .sort((a, b) => {
        const nameA = dex[a.pokemon]?.name ?? ''
        const nameB = dex[b.pokemon]?.name ?? ''
        if (!sort.dir) return byPowerRanking(a, b) || nameA.localeCompare(nameB)
        if (sort.key === 'name') return nameA.localeCompare(nameB) * sort.dir
        // dir -1 is descending, so subtract in ascending order and flip.
        return (finite(a[sort.key]) - finite(b[sort.key])) * sort.dir
          || b.killsPerGame - a.killsPerGame
          || nameA.localeCompare(nameB)
      })
  }, [totals, sort, query, dex])

  if (!matches.length) {
    return <p className="panel-note">No match stats in the sheet yet. Re-run the import once they are filled in.</p>
  }

  const conflicts = Object.entries(league.pokemonStats ?? {}).filter(([id, s]) => {
    const t = totals.find((x) => x.pokemon === id)
    return t && (s.kills || s.deaths) && (s.kills !== t.kills || s.deaths !== t.deaths)
  }).length

  return (
    <div className="stats-view">
      <div className="controls">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Pokémon…" aria-label="Search stats"
        />
        <span className="count">{rows.length} Pokémon</span>
        {/* Shown only while the power ranking is what is actually applied —
            once a column is picked, that column is the order, and the chain
            would be describing something that is no longer happening. */}
        {!sort.dir && <p className="sort-note">{POWER_RANKING_NOTE}</p>}
      </div>

      <section className="panel">
        <div className="table-scroll">
          <table className="stat-table stats-table">
            <thead>
              <tr>
                <th className="rank-col">#</th>
                {([['name', 'Pokémon'], ['gamesPlayed', 'Games'], ['kills', 'KOs'],
                   ['killsPerGame', 'KOs/Game'], ['deaths', 'Deaths'], ['kd', 'K/D'],
                   ['diff', 'Diff']] as [StatSort, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    className={`sortable${key === 'name' ? ' col-name' : ''}${sort.key === key && sort.dir ? ' is-sorted' : ''}`}
                    aria-sort={sort.key === key && sort.dir
                      ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" onClick={() => toggleSort(key)} title="Click to cycle ascending, descending, off">
                      {label}
                      <span className="sort-arrow">
                        {sort.key === key ? (sort.dir === 1 ? '▲' : sort.dir === -1 ? '▼' : '') : ''}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const mon = dex[t.pokemon]
                // Same podium treatment as the standings table.
                const medal = MEDALS[i + 1]
                return (
                  <tr key={t.pokemon} className={medal ? `medal-row medal-${i + 1}` : ''}>
                    {/* Position under the current sort — the power ranking. */}
                    <td className="rank-col">
                      {medal ? <span className="medal" title={medal.label}>{medal.icon}</span> : i + 1}
                    </td>
                    <th scope="row" className="col-name">
                      {mon && (
                        <PokemonLink id={t.pokemon} title={mon.name}>
                          <img src={spriteUrl(mon)} alt="" width={40} height={32} loading="lazy" />
                        </PokemonLink>
                      )}
                      <span className="stats-name">
                        <PokemonLink id={t.pokemon}>{mon?.name ?? t.pokemon}</PokemonLink>
                      </span>
                      {/* Each type gets its own track so the chips line up down
                          the table instead of trailing each name. */}
                      <span className="stats-type">
                        {mon?.types[0] && <TypeChip type={mon.types[0]} />}
                      </span>
                      <span className="stats-type">
                        {mon?.types[1] && <TypeChip type={mon.types[1]} />}
                      </span>
                    </th>
                    <td>{t.gamesPlayed}</td>
                    <td>{t.kills}</td>
                    <td>{t.killsPerGame.toFixed(2)}</td>
                    <td>{t.deaths}</td>
                    {/* A Pokémon that has never fainted has no ratio to give,
                        which is better said than rounded to a number. */}
                    <td title={t.deaths ? undefined : 'Never fainted'}>
                      {!t.kills && !t.deaths ? '—' : t.kd === Infinity ? '∞' : t.kd.toFixed(2)}
                    </td>
                    <td className={t.diff > 0 ? 'pos' : t.diff < 0 ? 'neg' : ''}>
                      {t.diff > 0 ? `+${t.diff}` : t.diff}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="panel-note">
          Totalled from the match log, which is the complete record.
          {conflicts > 0 && ` The sheet's Pokémon Stats tab disagrees on ${conflicts} of these — it is still being filled in.`}
        </p>
      </section>

      <div className="match-log">
        {weeks.map((w) => (
          <section key={w} className="panel">
            <h3>Week {w}</h3>
            <div className="match-cards">
              {matches.filter((m) => m.week === w && (m.a.lines.length || m.b.lines.length)).map((m, i) => (
                <article key={i} className="match-card">
                  <header>
                    <span className={m.a.result === 'W' ? 'won' : m.a.result === 'L' ? 'lost' : ''}>{m.a.team}</span>
                    <strong>{m.a.score ?? '–'} – {m.b.score ?? '–'}</strong>
                    <span className={m.b.result === 'W' ? 'won' : m.b.result === 'L' ? 'lost' : ''}>{m.b.team}</span>
                  </header>
                  <div className="match-sides">
                    {[m.a, m.b].map((side, si) => (
                      <ul key={si}>
                        {side.lines.map((l, li) => {
                          const mon = dex[l.pokemon]
                          return (
                            <li key={li}>
                              {mon && (
                                <PokemonLink id={l.pokemon} title={mon.name}>
                                  <img src={spriteUrl(mon)} alt="" width={32} height={26} loading="lazy" />
                                </PokemonLink>
                              )}
                              <span className="ml-name">
                                <PokemonLink id={l.pokemon}>{mon?.name ?? l.pokemon}</PokemonLink>
                              </span>
                              <span className="ml-kd" title={`${l.kills} KOs, ${l.deaths} deaths`}>
                                <em className="k">{l.kills}</em>/<em className="d">{l.deaths}</em>
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function Rules({ league }: { league: League }) {
  const rules = league.rules
  if (!rules?.sections.length) {
    return <p className="panel-note">No rules found in the sheet. Re-run the import to pick them up.</p>
  }

  return (
    <div className="rulebook">
      {(rules.title || rules.subtitle) && (
        <section className="panel rulebook-head">
          {rules.title && <h2>{rules.title}</h2>}
          {rules.subtitle && <p className="panel-note">{rules.subtitle}</p>}
        </section>
      )}

      <div className="rulebook-grid">
        {rules.sections.map((section) => (
          <section key={section.heading} className="panel rule-section">
            <h3>{section.heading}</h3>
            {section.notes.map((note) => (
              <p key={note} className="rule-callout">{note}</p>
            ))}
            <dl>
              {section.items.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      {rules.footer && <p className="panel-note rulebook-footer">{rules.footer}</p>}
    </div>
  )
}

/**
 * The league's tiebreak order, applied in full.
 *
 * Head-to-head sits last and only separates two players who are level on
 * everything else, so it is resolved from the schedule rather than stored:
 * whoever won more of the series they played against each other.
 */
function rankStandings(league: League): Standing[] {
  const headToHead = (a: Standing, b: Standing) => {
    let wins = 0
    for (const m of league.schedule) {
      if (m.scoreA === null || m.scoreB === null) continue
      const aOnA = m.a.includes(a.player), bOnB = m.b.includes(b.player)
      const aOnB = m.b.includes(a.player), bOnA = m.a.includes(b.player)
      if (aOnA && bOnB) wins += m.scoreA > m.scoreB ? 1 : m.scoreA < m.scoreB ? -1 : 0
      else if (aOnB && bOnA) wins += m.scoreB > m.scoreA ? 1 : m.scoreB < m.scoreA ? -1 : 0
    }
    return wins
  }

  const rate = (won: number, total: number) => (total ? won / total : 0)

  return [...league.standings]
    .sort((a, b) =>
      b.points - a.points
      || rate(b.wins, b.wins + b.losses) - rate(a.wins, a.wins + a.losses)
      || rate(b.gamesWon, b.gamesWon + b.gamesLost) - rate(a.gamesWon, a.gamesWon + a.gamesLost)
      || b.monDiff - a.monDiff
      || headToHead(b, a)
      || a.name.localeCompare(b.name))
    .map((s, i) => ({ ...s, rank: i + 1 }))
}

function Standings({ league }: { league: League }) {
  const ranked = rankStandings(league)
  // Reporting and roster changes write to the database. The spreadsheet season
  // is read-only at the source, so those controls do not appear for it.
  const editable = currentSeason().source === 'database'
  const [open, setOpen] = useState<'report' | 'players' | null>(null)
  const refresh = () => { reloadSeason(currentSeason().id) }

  return (
    <section className="panel">
      <div className="standings-head">
        {editable && (
          <div className="standings-actions">
            <button type="button" onClick={() => setOpen('report')}>Report a match</button>
            <button type="button" onClick={() => setOpen('players')}>Add / remove players</button>
          </div>
        )}
        {/* The tiebreaks in the order they apply, sitting where the columns they
            refer to are — one line, so it reads as a caption and not a paragraph. */}
        <p className="sort-note">
          Pts → Match Win % → Game Win % → Diff → Head-to-head
        </p>
      </div>
      {open === 'report' && (
        <ReportMatch league={league} onClose={() => setOpen(null)} onSaved={refresh} />
      )}
      {open === 'players' && (
        <ManagePlayers league={league} onClose={() => setOpen(null)} onSaved={refresh} />
      )}
      <div className="table-scroll">
        <table className="stat-table standings-table">
          <thead>
            <tr>
              <th>#</th><th className="col-name">Player</th><th className="col-abil">Team</th>
              <th>W</th><th>L</th>
              <th title="Series won as a share of series played">Match Win %</th>
              <th>GW</th><th>GL</th>
              <th title="Individual games won as a share of games played">Game Win %</th>
              <th title="Pokémon remaining differential">Diff</th><th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((s) => {
              const played = s.wins + s.losses
              const gamesPlayed = s.gamesWon + s.gamesLost
              const medal = MEDALS[s.rank]
              return (
                <tr key={s.player} className={medal ? `medal-row medal-${s.rank}` : ''}>
                  <td className="rank-cell">
                    {medal ? <span className="medal" title={medal.label}>{medal.icon}</span> : s.rank}
                  </td>
                  <th scope="row" className="col-name"><span>{s.name}</span></th>
                  <td className="col-abil">{s.team ?? <em className="none">TBD</em>}</td>
                  <td>{s.wins}</td>
                  <td>{s.losses}</td>
                  <td>{played ? `${Math.round((s.wins / played) * 100)}%` : '—'}</td>
                  <td>{s.gamesWon}</td>
                  <td>{s.gamesLost}</td>
                  <td>{gamesPlayed ? `${Math.round((s.gamesWon / gamesPlayed) * 100)}%` : '—'}</td>
                  <td className={s.monDiff > 0 ? 'pos' : s.monDiff < 0 ? 'neg' : ''}>
                    {s.monDiff > 0 ? `+${s.monDiff}` : s.monDiff}
                  </td>
                  <td><strong>{s.points}</strong></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * The players, in ranking order, each opening onto their team.
 *
 * Ordered by where they stand rather than by seed or by name, so the list reads
 * as the league currently is. A player's Pokémon are theirs alone — nobody else
 * can draft them — so a Pokémon's league-wide totals are that player's totals
 * for it, and no separate per-player tally is needed.
 */
function Players({ league, dex }: { league: League; dex: Record<string, LeaguePokemon> }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const totals = useMemo(
    () => totalsFromMatches(league.matchStats ?? []),
    [league.matchStats],
  )
  const standing = useMemo(
    () => Object.fromEntries(league.standings.map((s) => [s.player, s])),
    [league.standings],
  )

  const ordered = useMemo(
    () => [...league.players].sort(
      (a, b) => (standing[a.id]?.rank ?? Infinity) - (standing[b.id]?.rank ?? Infinity)
        || a.seed - b.seed,
    ),
    [league.players, standing],
  )

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => ordered.filter((p) => {
    if (!q) return true
    if (p.name.toLowerCase().includes(q) || p.team?.toLowerCase().includes(q)) return true
    return (league.rosters[p.id] ?? []).some(
      (pick) => (dex[pick.pokemon]?.name ?? pick.pokemon).toLowerCase().includes(q),
    )
  }), [ordered, league.rosters, dex, q])

  // A search for a Pokémon is a question about whose team it is on, and the
  // answer is inside the row. Searching opens what it found.
  const isOpen = (id: string) => (q ? true : open === id)

  return (
    <>
      <div className="controls">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search player, team, or Pokémon…" aria-label="Search players"
        />
        <span className="count">{visible.length} of {league.players.length}</span>
      </div>

      <section className="panel">
        <ul className="player-list">
          {visible.map((p) => {
            const picks = [...(league.rosters[p.id] ?? [])].sort(
              (a, b) => byTier(a.tier, b.tier) || (dex[b.pokemon]?.bst ?? 0) - (dex[a.pokemon]?.bst ?? 0),
            )
            const s = standing[p.id]
            const showing = isOpen(p.id)
            return (
              <li key={p.id} className={showing ? 'is-open' : undefined}>
                <button
                  type="button"
                  className="player-head"
                  aria-expanded={showing}
                  onClick={() => setOpen(showing && !q ? null : p.id)}
                >
                  <span className="player-caret" aria-hidden="true">{showing ? '▾' : '▸'}</span>
                  {s?.rank ? <span className="player-rank">{s.rank}</span> : null}
                  <span className="player-name">{p.name}</span>
                  <span className="player-team">{p.team ?? '—'}</span>
                  {s && (
                    <span className="player-record">
                      {s.wins}–{s.losses}
                      <em>{s.points} pts</em>
                    </span>
                  )}
                  <span className="player-count">{picks.length}</span>
                </button>

                {showing && (
                  <div className="player-body">
                    {s && (
                      <dl className="player-stats">
                        {([
                          ['Record', `${s.wins}–${s.losses}`],
                          ['Games', `${s.gamesWon}–${s.gamesLost}`],
                          ['Differential', s.monDiff > 0 ? `+${s.monDiff}` : `${s.monDiff}`],
                          ['Points', `${s.points}`],
                        ] as [string, string][]).map(([k, v]) => (
                          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                        ))}
                      </dl>
                    )}
                    {picks.length === 0 ? (
                      <p className="panel-note">No team drafted yet.</p>
                    ) : (
                      <ul className="player-picks">
                        {picks.map((pick) => {
                          const mon = dex[pick.pokemon]
                          if (!mon) return null
                          const t = totals[pick.pokemon]
                          return (
                            <li key={pick.pokemon}>
                              <PokemonLink id={pick.pokemon} title={mon.name}>
                                <img src={spriteUrl(mon)} alt="" width={44} height={36} loading="lazy" />
                              </PokemonLink>
                              <span className="pick-name">
                                <PokemonLink id={pick.pokemon}>{mon.name}</PokemonLink>
                              </span>
                              <span className="pick-types">
                                {mon.types.map((ty) => <TypeChip key={ty} type={ty} />)}
                              </span>
                              <span className={tierClass(pick.tier)}>{pick.tier}</span>
                              <span className="pick-kd" title="KOs / deaths">
                                {t ? <><b>{t.kills}</b> / {t.deaths}</> : <em>—</em>}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

/**
 * The matches, and the games inside them.
 *
 * A match is a best-of-three, so its 2-1 is a summary of three battles that
 * each had their own story. Any game reported from a replay can be opened to
 * see who knocked out what, and links back to the replay itself.
 *
 * Matches imported from the spreadsheet have no games underneath — the sheet
 * never recorded them — so they render exactly as they always did.
 */
function Matches({ league, dex }: { league: League; dex: PokemonDex }) {
  const people = useMemo(() => byId(league.players), [league.players])
  const weeks = useMemo(
    () => [...new Set(league.schedule.map((m) => m.week))].sort((a, b) => a - b),
    [league.schedule],
  )
  const [open, setOpen] = useState<string | null>(null)
  const label = (ids: string[]) => ids.map((p) => people[p]?.name ?? p).join(' + ')

  return (
    <div className="schedule">
      {weeks.map((week) => (
        <section key={week} className="panel">
          <h3>Week {week}</h3>
          <ul className="match-list">
            {league.schedule.filter((m) => m.week === week).map((m, i) => {
              const done = m.scoreA !== null && m.scoreB !== null
              // Outline the result: green on the winner, red on the loser.
              const cls = (isA: boolean) => {
                if (!done) return 'side'
                if (m.scoreA === m.scoreB) return 'side drew'
                const won = isA ? m.scoreA! > m.scoreB! : m.scoreB! > m.scoreA!
                return `side ${won ? 'won' : 'lost'}`
              }
              const games = m.games ? [...m.games].sort((x, y) => x.number - y.number) : []
              const shown = games.find((g) => open === `${week}-${i}-${g.number}`)
              return (
                <li key={i} className={games.length ? 'has-games' : undefined}>
                  <div className="match-row">
                    <span className={cls(true)}>{label(m.a)}</span>
                    <span className="score-cell">
                      <span className="score">{done ? `${m.scoreA} – ${m.scoreB}` : 'vs'}</span>
                      {/* One chip per game, read from the left side's point of
                          view, so a 2-1 shows as W L W and the shape of the
                          series is legible without opening anything. */}
                      {games.length > 0 && (
                        <span className="game-chips">
                          {games.map((g) => {
                            const key = `${week}-${i}-${g.number}`
                            const winner = g.winner === 'a' ? label(m.a)
                              : g.winner === 'b' ? label(m.b) : null
                            return (
                              <button
                                key={g.number}
                                type="button"
                                className={`game-chip${g.winner === 'a' ? ' won' : ' lost'}${
                                  open === key ? ' is-open' : ''}`}
                                aria-expanded={open === key}
                                title={`Game ${g.number}${winner ? ` — won by ${winner}` : ''}`}
                                onClick={() => setOpen(open === key ? null : key)}
                              >
                                {g.winner === 'a' ? 'W' : 'L'}
                              </button>
                            )
                          })}
                        </span>
                      )}
                    </span>
                    <span className={cls(false)}>{label(m.b)}</span>
                  </div>

                  {shown && (
                    <div className="game-open">
                      <div className="game-open-head">
                        <strong>Game {shown.number}</strong>
                        {shown.winner && (
                          <span>won by {shown.winner === 'a' ? label(m.a) : label(m.b)}</span>
                        )}
                        {shown.survivors !== null && (
                          <span className="game-survivors">{shown.survivors} left</span>
                        )}
                        {shown.replayUrl && (
                          <a
                            className="game-replay"
                            href={shown.replayUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Replay ↗
                          </a>
                        )}
                      </div>
                      <div className="game-detail">
                        <GameSide title={label(m.a)} lines={shown.a} dex={dex} league={league} />
                        <GameSide title={label(m.b)} lines={shown.b} dex={dex} league={league} />
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** One team's Pokémon in one game, worst-hit last. */
function GameSide({
  title, lines, dex, league,
}: { title: string; lines: GameLine[]; dex: PokemonDex; league: League }) {
  const board = league.board
  const sorted = [...lines].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
  return (
    <div className="game-side">
      <h4>{title}</h4>
      <ul>
        {sorted.map((l) => {
          const mon = dex[l.pokemon]
          const name = mon?.name ?? board[l.pokemon]?.name ?? l.pokemon
          return (
            <li key={l.pokemon} className={l.kills || l.deaths ? undefined : 'idle'}>
              <PokemonLink id={l.pokemon} title={name}>
                {mon && <img src={spriteUrl(mon)} alt="" width={36} height={30} loading="lazy" />}
                <span>{name}</span>
              </PokemonLink>
              <span className="game-kd" title={`${l.kills} KOs, fainted ${l.deaths} times`}>
                <b>{l.kills}</b> / {l.deaths}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Board columns, in display order. `get` returns the value each one sorts on. */
const BOARD_COLUMNS = [
  { key: 'name', label: 'Pokémon', numeric: false },
  { key: 'tier', label: 'Tier', numeric: false },
  { key: 'bst', label: 'BST', numeric: true },
  ...BST_ORDER.map((k) => ({ key: k, label: STAT_LABELS[k], numeric: true })),
  { key: 'draftedBy', label: 'Drafted by', numeric: false },
  { key: 'note', label: 'Note', numeric: false },
] as const

type SortKey = (typeof BOARD_COLUMNS)[number]['key']

/** Draft-board order, best first — matches how the sheet groups its sections. */
const TIER_PILLS = ['Top', 'High', 'Mid', 'Low', 'Banned'] as const

function Board({ league, dex }: { league: League; dex: Record<string, LeaguePokemon> }) {
  const [query, setQuery] = useState('')
  // Empty set means "no filter" rather than "show nothing", so the board starts
  // complete and each pill narrows it.
  const [tiers, setTiers] = useState<Set<string>>(new Set())
  const [avail, setAvail] = useState<Set<'available' | 'drafted'>>(new Set())
  // dir 0 means unsorted, so a column cycles through both directions and off.
  // Tier ascending is the default because TIER_RANK runs best-to-worst, so it
  // puts Top at the head of the board the way the sheet's own sections do.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 | 0 }>({ key: 'tier', dir: 1 })

  const toggleIn = <T,>(setter: (fn: (prev: Set<T>) => Set<T>) => void, value: T) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })

  const toggleSort = (key: SortKey) =>
    setSort((prev) => {
      // Numbers are most useful highest-first; text reads better A–Z.
      const first: 1 | -1 = BOARD_COLUMNS.find((c) => c.key === key)?.numeric ? -1 : 1
      if (prev.key !== key) return { key, dir: first }
      if (prev.dir === first) return { key, dir: (first === 1 ? -1 : 1) as 1 | -1 }
      if (prev.dir !== 0) return { key, dir: 0 }
      return { key, dir: first }
    })

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = Object.entries(league.board)
      .filter(([id, e]) => {
        if (tiers.size && !tiers.has(e.tier)) return false
        if (avail.size && !avail.has(e.draftedBy ? 'drafted' : 'available')) return false
        if (!q) return true
        return e.name.toLowerCase().includes(q) || dex[id]?.types.some((t) => t.toLowerCase() === q)
      })
      .map(([id, e]) => ({ id, entry: e, mon: dex[id] }))

    const { key, dir } = sort
    if (!dir) return list
    return list.sort((a, b) => {
      // Within a tier the strongest first, and that tiebreak keeps its own
      // direction — flipping the tier order should not also flip BST.
      if (key === 'tier') {
        return byTier(a.entry.tier, b.entry.tier) * dir
          || (b.mon?.bst ?? 0) - (a.mon?.bst ?? 0)
      }
      if (key === 'bst') return ((a.mon?.bst ?? 0) - (b.mon?.bst ?? 0)) * dir
      if (key === 'name') return a.entry.name.localeCompare(b.entry.name) * dir
      if (key === 'draftedBy' || key === 'note') {
        // Empty cells sort last regardless of direction; they carry no signal.
        const av = a.entry[key] ?? '', bv = b.entry[key] ?? ''
        if (!av !== !bv) return av ? -1 : 1
        return av.localeCompare(bv) * dir
      }
      return ((a.mon?.baseStats[key] ?? 0) - (b.mon?.baseStats[key] ?? 0)) * dir
    })
  }, [league.board, dex, query, tiers, avail, sort])

  const counts = useMemo(() => {
    const c: Record<string, number> = { available: 0, drafted: 0 }
    for (const e of Object.values(league.board)) {
      c[e.tier] = (c[e.tier] ?? 0) + 1
      c[e.draftedBy ? 'drafted' : 'available']++
    }
    return c
  }, [league.board])

  return (
    <>
      {/* Search and its filters share one row, so the whole control set reads
          left to right instead of stacking. */}
      <div className="board-controls">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the board…" aria-label="Search draft board"
        />
        <div className="pill-group" role="group" aria-label="Filter by draft tier">
          {TIER_PILLS.map((t) => (
            <button
              key={t} type="button"
              className={`pill pill-${t.toLowerCase()}${tiers.has(t) ? ' is-active' : ''}`}
              aria-pressed={tiers.has(t)}
              onClick={() => toggleIn(setTiers, t)}
            >
              {t}<em>{counts[t] ?? 0}</em>
            </button>
          ))}
        </div>
        <span className="pill-divider" aria-hidden="true" />
        <div className="pill-group" role="group" aria-label="Filter by availability">
          {(['available', 'drafted'] as const).map((a) => (
            <button
              key={a} type="button"
              className={`pill pill-${a}${avail.has(a) ? ' is-active' : ''}`}
              aria-pressed={avail.has(a)}
              onClick={() => toggleIn(setAvail, a)}
            >
              {a === 'available' ? 'Available' : 'Drafted'}<em>{counts[a]}</em>
            </button>
          ))}
        </div>
        {(tiers.size > 0 || avail.size > 0) && (
          <button
            type="button" className="pill pill-clear"
            onClick={() => { setTiers(new Set()); setAvail(new Set()) }}
          >
            Clear
          </button>
        )}
        {/* Explains the row colouring in the table below. */}
        <dl className="board-key">
          <div><dt className="swatch-open" /><dd>available</dd></div>
          <div><dt className="swatch-taken" /><dd>taken</dd></div>
        </dl>
        <span className="count">{rows.length} shown</span>
      </div>

      <section className="panel">
        <div className="table-scroll">
          <table className="stat-table board-table">
            <thead>
              <tr>
                {BOARD_COLUMNS.map((c) => {
                  const active = sort.key === c.key && sort.dir !== 0
                  return (
                    <th
                      key={c.key}
                      className={`sortable${c.key === 'name' ? ' col-name' : ''}${c.key === 'draftedBy' || c.key === 'note' ? ' col-abil' : ''}${active ? ' is-sorted' : ''}`}
                      aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => toggleSort(c.key)} title="Click to cycle ascending, descending, off">
                        {c.label}
                        <span className="sort-arrow">{active ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map(({ id, entry, mon }) => (
                <tr key={id} className={entry.draftedBy ? 'row-taken' : 'row-open'}>
                  <th scope="row" className="col-name">
                    {mon && (
                      <PokemonLink id={id} title={entry.name}>
                        <img src={spriteUrl(mon)} alt="" width={40} height={32} loading="lazy" />
                      </PokemonLink>
                    )}
                    <span>
                      <PokemonLink id={id} className="pick-name">{entry.name}</PokemonLink>
                      {mon && (
                        <span className="row-types">
                          {mon.types.map((t) => <TypeChip key={t} type={t} />)}
                        </span>
                      )}
                    </span>
                  </th>
                  <td><span className={tierClass(entry.tier)}>{entry.tier}</span></td>
                  <td>{mon?.bst ?? '—'}</td>
                  {BST_ORDER.map((k) => <td key={k}>{mon?.baseStats[k] ?? '—'}</td>)}
                  <td className="col-abil">{entry.draftedBy ?? <em className="none">available</em>}</td>
                  <td className="col-abil">{entry.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 300 && (
          <p className="panel-note">Showing the first 300 of {rows.length}. Narrow your search to see more.</p>
        )}
      </section>
    </>
  )
}
