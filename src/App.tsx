import { useEffect, useMemo, useState } from 'react'
import { loadCore, spriteUrl } from './data/load'
import type { AbilityDex, MoveDex, Pokemon, PokemonDex, TypeChart } from './data/types'
import './App.css'

interface Core {
  pokemon: PokemonDex
  moves: MoveDex
  abilities: AbilityDex
  typechart: TypeChart
}

const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' } as const

export default function App() {
  const [core, setCore] = useState<Core | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState('all')

  useEffect(() => {
    loadCore().then(setCore, (err: Error) => setError(err.message))
  }, [])

  const entries = useMemo(() => {
    if (!core) return []
    const q = query.trim().toLowerCase()
    return Object.entries(core.pokemon)
      .filter(([id, p]) => {
        if (tier !== 'all' && p.tier !== tier) return false
        return !q || p.name.toLowerCase().includes(q) || id.includes(q)
          || p.types.some((t) => t.toLowerCase() === q)
      })
      .sort((a, b) => b[1].bst - a[1].bst)
  }, [core, query, tier])

  const tiers = useMemo(() => {
    if (!core) return []
    const seen = new Set<string>()
    for (const p of Object.values(core.pokemon)) if (p.tier) seen.add(p.tier)
    return [...seen].sort()
  }, [core])

  if (error) return <main className="app"><p className="error">Could not load data: {error}</p></main>
  if (!core) return <main className="app"><p className="loading">Loading dex…</p></main>

  return (
    <main className="app">
      <header className="masthead">
        <h1>Draft Dex</h1>
        <p className="subtitle">
          {Object.keys(core.pokemon).length} Pokémon · {Object.keys(core.moves).length} moves
          · {Object.keys(core.abilities).length} abilities · {core.typechart.types.length} types
          <span className="gen-note">Generation 9 only</span>
        </p>
      </header>

      <div className="controls">
        <input
          type="search"
          placeholder="Search by name or type…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search Pokémon"
        />
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Filter by tier">
          <option value="all">All tiers</option>
          {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="count">{entries.length} shown</span>
      </div>

      <ul className="grid">
        {entries.slice(0, 200).map(([id, p]) => <Card key={id} id={id} p={p} />)}
      </ul>
      {entries.length > 200 && (
        <p className="truncated">Showing the first 200 of {entries.length}. Narrow your search to see more.</p>
      )}
    </main>
  )
}

function Card({ id, p }: { id: string; p: Pokemon }) {
  return (
    <li className="card">
      <img src={spriteUrl(id)} alt="" loading="lazy" width={68} height={56} />
      <div className="card-body">
        <div className="card-head">
          <span className="name">{p.name}</span>
          {p.tier && <span className="tier">{p.tier}</span>}
        </div>
        <div className="types">
          {p.types.map((t) => <span key={t} className={`type type-${t.toLowerCase()}`}>{t}</span>)}
        </div>
        <div className="stats">
          {(Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[]).map((k) => (
            <span key={k} className="stat" title={`${STAT_LABELS[k]} ${p.baseStats[k]}`}>
              <em>{STAT_LABELS[k]}</em>{p.baseStats[k]}
            </span>
          ))}
          <span className="stat bst"><em>BST</em>{p.bst}</span>
        </div>
      </div>
    </li>
  )
}
