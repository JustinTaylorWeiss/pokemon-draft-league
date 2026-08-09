import { useEffect, useMemo, useState } from 'react'
import { loadPokemon, spriteUrl } from '../../data/load'
import type { Pokemon, PokemonDex } from '../../data/types'
import { STAT_LABELS, BST_ORDER } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'

const PAGE = 200

export function Dex() {
  const [dex, setDex] = useState<PokemonDex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState('all')

  useEffect(() => { loadPokemon().then(setDex, (e: Error) => setError(e.message)) }, [])

  const tiers = useMemo(() => {
    if (!dex) return []
    return [...new Set(Object.values(dex).map((p) => p.tier).filter(Boolean) as string[])].sort()
  }, [dex])

  const entries = useMemo(() => {
    if (!dex) return []
    const q = query.trim().toLowerCase()
    return Object.entries(dex)
      .filter(([id, p]) => {
        if (tier !== 'all' && p.tier !== tier) return false
        return !q || p.name.toLowerCase().includes(q) || id.includes(q)
          || p.types.some((t) => t.toLowerCase() === q)
      })
      .sort((a, b) => b[1].bst - a[1].bst)
  }, [dex, query, tier])

  if (error) return <p className="error">Could not load data: {error}</p>
  if (!dex) return <p className="loading">Loading dex…</p>

  return (
    <div className="dex">
      <div className="controls">
        <input
          type="search" placeholder="Search by name or type…" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search Pokémon"
        />
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Filter by tier">
          <option value="all">All tiers</option>
          {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="count">{entries.length} of {Object.keys(dex).length}</span>
      </div>

      <ul className="dex-grid">
        {entries.slice(0, PAGE).map(([id, p]) => <Card key={id} p={p} />)}
      </ul>
      {entries.length > PAGE && (
        <p className="panel-note">Showing the first {PAGE} of {entries.length}. Narrow your search to see more.</p>
      )}
    </div>
  )
}

function Card({ p }: { p: Pokemon }) {
  return (
    <li className="dex-card">
      <img src={spriteUrl(p)} alt="" loading="lazy" width={68} height={56} />
      <div>
        <div className="dex-card-head">
          <span className="name">{p.name}</span>
          {p.tier && <span className="tier">{p.tier}</span>}
        </div>
        <div className="dex-types">{p.types.map((t) => <TypeChip key={t} type={t} />)}</div>
        <div className="dex-stats">
          {BST_ORDER.map((k) => (
            <span key={k}><em>{STAT_LABELS[k]}</em>{p.baseStats[k]}</span>
          ))}
          <span className="bst"><em>BST</em>{p.bst}</span>
        </div>
      </div>
    </li>
  )
}
