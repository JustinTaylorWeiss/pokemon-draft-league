import { useEffect, useMemo, useState } from 'react'
import { loadPokemon, spriteUrl } from '../../data/load'
import type { PokemonDex } from '../../data/types'
import {
  byId, byTier, loadLeague, mergeDex, subscribeLeague, tierClass, totalsFromMatches,
  type League, type LeaguePokemon, type PokemonTotals,
} from '../../data/league'
import { BST_ORDER, STAT_LABELS } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
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
      {tab === 'rosters' && <Rosters league={league} dex={dex} />}
      {tab === 'schedule' && <Schedule league={league} />}
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

/** A full week is every player paired off: 20 players, 4 per match. */
const WEEK_MATCHES = 5

/**
 * The ranking shown when no column is sorted: best differential first, then
 * kills per game, then raw kills, then fewest deaths. Each step only decides
 * rows the one before it left tied.
 */
const byPowerRanking = (a: PokemonTotals, b: PokemonTotals) =>
  b.diff - a.diff
  || b.killsPerGame - a.killsPerGame
  || b.kills - a.kills
  || a.deaths - b.deaths

type StatSort = 'kills' | 'deaths' | 'diff' | 'gamesPlayed' | 'killsPerGame' | 'name'

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
  const [week, setWeek] = useState<number | 'all'>('all')
  const [query, setQuery] = useState('')

  const matches = useMemo(() => league.matchStats ?? [], [league.matchStats])

  /** Recomputed per week filter, so the board reflects whatever is selected. */
  const totals = useMemo(() => {
    const scoped = week === 'all' ? matches : matches.filter((m) => m.week === week)
    return Object.values(totalsFromMatches(scoped))
  }, [matches, week])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return totals
      .filter((t) => !q || dex[t.pokemon]?.name.toLowerCase().includes(q))
      // Kills per game breaks ties: two Pokémon on the same total are separated
      // by how few games it took. The tiebreak keeps its own direction so it
      // stays meaningful when the column is flipped.
      .sort((a, b) => {
        const nameA = dex[a.pokemon]?.name ?? ''
        const nameB = dex[b.pokemon]?.name ?? ''
        if (!sort.dir) return byPowerRanking(a, b) || nameA.localeCompare(nameB)
        if (sort.key === 'name') return nameA.localeCompare(nameB) * sort.dir
        // dir -1 is descending, so subtract in ascending order and flip.
        return (a[sort.key] - b[sort.key]) * sort.dir
          || b.killsPerGame - a.killsPerGame
          || nameA.localeCompare(nameB)
      })
  }, [totals, sort, query, dex])

  const weeks = useMemo(() => [...new Set(matches.map((m) => m.week))].sort((a, b) => a - b), [matches])
  const played = matches.filter((m) => m.a.lines.length || m.b.lines.length)

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
        <div className="pill-group" role="group" aria-label="Filter by week">
          <button
            type="button" className={`pill${week === 'all' ? ' is-active' : ''}`}
            onClick={() => setWeek('all')}
          >
            All weeks<em>{played.length}</em>
          </button>
          {weeks.map((w) => {
            const n = matches.filter((m) => m.week === w && (m.a.lines.length || m.b.lines.length)).length
            // Five matches is a full week; anything short is still being played
            // or recorded, and the colour says which at a glance.
            const state = n >= WEEK_MATCHES ? 'is-complete' : 'is-partial'
            return (
              <button
                key={w} type="button"
                className={`pill week-pill ${state}${week === w ? ' is-active' : ''}`}
                onClick={() => setWeek(w)} disabled={!n}
                title={`${n} of ${WEEK_MATCHES} matches recorded`}
              >
                Week {w}
              </button>
            )
          })}
        </div>
        <span className="count">{rows.length} Pokémon</span>
      </div>

      <section className="panel">
        <div className="table-scroll">
          <table className="stat-table stats-table">
            <thead>
              <tr>
                <th className="rank-col">#</th>
                {([['name', 'Pokémon'], ['gamesPlayed', 'Games'], ['kills', 'Kills'],
                   ['killsPerGame', 'K/Game'], ['deaths', 'Deaths'],
                   ['diff', '+/-']] as [StatSort, string][]).map(([key, label]) => (
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
        {weeks.filter((w) => week === 'all' || w === week).map((w) => (
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
                              <span className="ml-kd" title={`${l.kills} kills, ${l.deaths} deaths`}>
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

function Standings({ league }: { league: League }) {
  return (
    <section className="panel">
      <div className="table-scroll">
        <table className="stat-table standings-table">
          <thead>
            <tr>
              <th>#</th><th className="col-name">Player</th><th className="col-abil">Team</th>
              <th>W</th><th>L</th><th>Win%</th><th>GW</th><th>GL</th>
              <th title="Pokémon remaining differential">Diff</th><th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {league.standings.map((s) => {
              const played = s.wins + s.losses
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

function Rosters({ league, dex }: { league: League; dex: Record<string, LeaguePokemon> }) {
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return league.players.filter((p) => {
      if (!league.rosters[p.id]?.length) return false
      if (!q) return true
      if (p.name.toLowerCase().includes(q) || p.team?.toLowerCase().includes(q)) return true
      return league.rosters[p.id].some((pick) => dex[pick.pokemon]?.name.toLowerCase().includes(q))
    })
  }, [league, dex, query])

  return (
    <>
      <div className="controls">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search player, team, or Pokémon…" aria-label="Search rosters"
        />
        <span className="count">{visible.length} of {league.players.length}</span>
      </div>
      <div className="roster-grid">
        {visible.map((p) => {
          // Best picks first, so the shape of a roster reads at a glance.
          const picks = [...league.rosters[p.id]].sort(
            (a, b) => byTier(a.tier, b.tier) || (dex[b.pokemon]?.bst ?? 0) - (dex[a.pokemon]?.bst ?? 0),
          )
          return (
            <section key={p.id} className="panel roster-card">
              <header>
                <h3>{p.team ?? p.name}</h3>
                {p.team && <span className="panel-note">{p.name}</span>}
              </header>
              <ul>
                {picks.map((pick) => {
                  const mon = dex[pick.pokemon]
                  if (!mon) return null
                  return (
                    <li key={pick.pokemon}>
                      <PokemonLink id={pick.pokemon} title={mon.name}>
                        <img src={spriteUrl(mon)} alt="" width={44} height={36} loading="lazy" />
                      </PokemonLink>
                      <span className="pick-name">
                        <PokemonLink id={pick.pokemon}>{mon.name}</PokemonLink>
                      </span>
                      <span className="pick-types">
                        {mon.types.map((t) => <TypeChip key={t} type={t} />)}
                      </span>
                      <span className={tierClass(pick.tier)}>{pick.tier}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}

function Schedule({ league }: { league: League }) {
  const people = useMemo(() => byId(league.players), [league.players])
  const weeks = useMemo(
    () => [...new Set(league.schedule.map((m) => m.week))].sort((a, b) => a - b),
    [league.schedule],
  )
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
              return (
                <li key={i}>
                  <span className={cls(true)}>{label(m.a)}</span>
                  <span className="score">{done ? `${m.scoreA} – ${m.scoreB}` : 'vs'}</span>
                  <span className={cls(false)}>{label(m.b)}</span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 | 0 }>({ key: 'bst', dir: -1 })

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
      if (key === 'tier') return byTier(a.entry.tier, b.entry.tier) * dir
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
