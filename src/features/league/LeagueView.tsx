import { useEffect, useMemo, useState } from 'react'
import { loadPokemon, spriteUrl } from '../../data/load'
import type { PokemonDex } from '../../data/types'
import {
  byId, byTier, loadLeague, mergeDex, tierClass, type League, type LeaguePokemon,
} from '../../data/league'
import { BST_ORDER, STAT_LABELS } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import type { LeagueTab } from './tabs'
import './league.css'

export function LeagueView({ tab }: { tab: LeagueTab }) {
  const [league, setLeague] = useState<League | null>(null)
  const [rawDex, setRawDex] = useState<PokemonDex | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([loadLeague(), loadPokemon()]).then(
      ([l, d]) => { setLeague(l); setRawDex(d) },
      (err: Error) => setError(err.message),
    )
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

  const { meta } = league

  return (
    <div className="league">
      <section className="panel league-meta">
        <h2>{meta.name ?? 'Draft League'}</h2>
        <p className="panel-note league-meta-line">
          {[meta.format, meta.regulation && `Reg ${meta.regulation}`, meta.seriesLength,
            meta.weeks && `${meta.weeks} weeks`, meta.picksPerPlayer && `${meta.picksPerPlayer} picks each`]
            .filter(Boolean).join(' · ')}
        </p>
      </section>

      {tab === 'standings' && <Standings league={league} />}
      {tab === 'rosters' && <Rosters league={league} dex={dex} />}
      {tab === 'schedule' && <Schedule league={league} />}
      {tab === 'board' && <Board league={league} dex={dex} />}
    </div>
  )
}

/** Podium markers for the top three, keyed by rank. */
const MEDALS: Record<number, { icon: string; label: string }> = {
  1: { icon: '🥇', label: '1st' },
  2: { icon: '🥈', label: '2nd' },
  3: { icon: '🥉', label: '3rd' },
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
                      <img src={spriteUrl(mon)} alt="" width={44} height={36} loading="lazy" />
                      <span className="pick-name">{mon.name}</span>
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'bst', dir: -1 })

  const toggleIn = <T,>(setter: (fn: (prev: Set<T>) => Set<T>) => void, value: T) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 1 ? -1 : 1 }
        // Numbers are most useful highest-first; text reads better A–Z.
        : { key, dir: BOARD_COLUMNS.find((c) => c.key === key)?.numeric ? -1 : 1 },
    )

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
        <span className="count">{rows.length} shown</span>
      </div>

      <section className="panel">
        <div className="table-scroll">
          <table className="stat-table board-table">
            <thead>
              <tr>
                {BOARD_COLUMNS.map((c) => {
                  const active = sort.key === c.key
                  return (
                    <th
                      key={c.key}
                      className={`sortable${c.key === 'name' ? ' col-name' : ''}${c.key === 'draftedBy' || c.key === 'note' ? ' col-abil' : ''}${active ? ' is-sorted' : ''}`}
                      aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => toggleSort(c.key)}>
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
                <tr key={id}>
                  <th scope="row" className="col-name">
                    {mon && <img src={spriteUrl(mon)} alt="" width={40} height={32} loading="lazy" />}
                    <span>
                      <span className={entry.draftedBy ? 'name-taken' : 'name-open'}>{entry.name}</span>
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
