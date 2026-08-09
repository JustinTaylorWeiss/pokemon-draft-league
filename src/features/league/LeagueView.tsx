import { useEffect, useMemo, useState } from 'react'
import { loadPokemon, spriteUrl } from '../../data/load'
import type { PokemonDex } from '../../data/types'
import { byId, loadLeague, tierClass, type League } from '../../data/league'
import { TypeChip } from '../../components/TypeChip'
import './league.css'

type Tab = 'standings' | 'rosters' | 'schedule' | 'board'

const TABS: { key: Tab; label: string }[] = [
  { key: 'standings', label: 'Standings' },
  { key: 'rosters', label: 'Rosters' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'board', label: 'Draft Board' },
]

export function LeagueView() {
  const [league, setLeague] = useState<League | null>(null)
  const [dex, setDex] = useState<PokemonDex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('standings')

  useEffect(() => {
    Promise.all([loadLeague(), loadPokemon()]).then(
      ([l, d]) => { setLeague(l); setDex(d) },
      (err: Error) => setError(err.message),
    )
  }, [])

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
        <div>
          <h2>{meta.name ?? 'Draft League'}</h2>
          <p className="panel-note">
            {[meta.format, meta.regulation && `Reg ${meta.regulation}`, meta.seriesLength,
              meta.weeks && `${meta.weeks} weeks`, meta.picksPerPlayer && `${meta.picksPerPlayer} picks each`]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <ul className="tier-limits">
          {Object.entries(meta.tierLimits).map(([tier, max]) => (
            <li key={tier}><span className={tierClass(tier)}>{tier}</span> max {max}</li>
          ))}
        </ul>
      </section>

      <nav className="sub-nav">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'standings' && <Standings league={league} />}
      {tab === 'rosters' && <Rosters league={league} dex={dex} />}
      {tab === 'schedule' && <Schedule league={league} />}
      {tab === 'board' && <Board league={league} dex={dex} />}
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
              return (
                <tr key={s.player}>
                  <td>{s.rank}</td>
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

function Rosters({ league, dex }: { league: League; dex: PokemonDex }) {
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
        {visible.map((p) => (
          <section key={p.id} className="panel roster-card">
            <header>
              <h3>{p.team ?? p.name}</h3>
              {p.team && <span className="panel-note">{p.name}</span>}
            </header>
            <ul>
              {league.rosters[p.id].map((pick) => {
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
        ))}
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
              const aWon = done && m.scoreA! > m.scoreB!
              return (
                <li key={i}>
                  <span className={`side${done ? (aWon ? ' won' : ' lost') : ''}`}>{label(m.a)}</span>
                  <span className="score">
                    {done ? `${m.scoreA} – ${m.scoreB}` : 'vs'}
                  </span>
                  <span className={`side${done ? (aWon ? ' lost' : ' won') : ''}`}>{label(m.b)}</span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Board({ league, dex }: { league: League; dex: PokemonDex }) {
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<string>('all')
  const [availability, setAvailability] = useState<'all' | 'available' | 'drafted'>('all')

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return Object.entries(league.board)
      .filter(([id, e]) => {
        if (tier !== 'all' && e.tier !== tier) return false
        if (availability === 'available' && e.draftedBy) return false
        if (availability === 'drafted' && !e.draftedBy) return false
        if (!q) return true
        return e.name.toLowerCase().includes(q)
          || dex[id]?.types.some((t) => t.toLowerCase() === q)
      })
      .sort((a, b) => (dex[b[0]]?.bst ?? 0) - (dex[a[0]]?.bst ?? 0))
  }, [league.board, dex, query, tier, availability])

  const tiers = useMemo(
    () => [...new Set(Object.values(league.board).map((e) => e.tier))],
    [league.board],
  )

  return (
    <>
      <div className="controls">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the board…" aria-label="Search draft board"
        />
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Filter by draft tier">
          <option value="all">All tiers</option>
          {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={availability}
          onChange={(e) => setAvailability(e.target.value as typeof availability)}
          aria-label="Filter by availability"
        >
          <option value="all">Drafted or not</option>
          <option value="available">Undrafted only</option>
          <option value="drafted">Drafted only</option>
        </select>
        <span className="count">{entries.length}</span>
      </div>

      <section className="panel">
        <div className="table-scroll">
          <table className="stat-table board-table">
            <thead>
              <tr>
                <th className="col-name">Pokémon</th>
                <th>Tier</th><th>BST</th><th className="col-abil">Drafted by</th><th className="col-abil">Note</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 300).map(([id, e]) => {
                const mon = dex[id]
                return (
                  <tr key={id} className={e.draftedBy ? 'is-drafted' : ''}>
                    <th scope="row" className="col-name">
                      {mon && <img src={spriteUrl(mon)} alt="" width={40} height={32} loading="lazy" />}
                      <span>
                        {e.name}
                        {mon && (
                          <span className="row-types">
                            {mon.types.map((t) => <TypeChip key={t} type={t} />)}
                          </span>
                        )}
                      </span>
                    </th>
                    <td><span className={tierClass(e.tier)}>{e.tier}</span></td>
                    <td>{mon?.bst ?? '—'}</td>
                    <td className="col-abil">{e.draftedBy ?? <em className="none">available</em>}</td>
                    <td className="col-abil">{e.note ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {entries.length > 300 && (
          <p className="panel-note">Showing the first 300 of {entries.length}. Narrow your search to see more.</p>
        )}
      </section>
    </>
  )
}
