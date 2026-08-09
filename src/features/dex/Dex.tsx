import { useEffect, useMemo, useState } from 'react'
import { loadAbilities, loadLearnsets, loadMoves, loadPokemon, spriteUrl, toId } from '../../data/load'
import type { AbilityDex, LearnsetDex, MoveDex, PokemonDex, StatKey, TypeName } from '../../data/types'
import { loadLeague, mergeDex, tierClass, type League, type LeaguePokemon } from '../../data/league'
import { STAT_LABELS, BST_ORDER } from '../../lib/stats'
import { BATTLE_TYPES } from '../../lib/matchup'
import { TypeChip } from '../../components/TypeChip'

const PAGE = 200

/** "any" is the do-nothing value for every dropdown. */
const ANY = 'any'
/** Type 2 only: matches Pokémon with a single type. */
const NONE = 'none'

type StatField = StatKey | 'bst'
type Comparator = 'gte' | 'lte' | 'eq'

const STAT_FIELDS: { key: StatField; label: string }[] = [
  ...BST_ORDER.map((k) => ({ key: k as StatField, label: STAT_LABELS[k] })),
  { key: 'bst', label: 'BST' },
]

const COMPARATORS: { key: Comparator; label: string }[] = [
  { key: 'gte', label: '≥' },
  { key: 'lte', label: '≤' },
  { key: 'eq', label: '=' },
]

const statValue = (mon: LeaguePokemon, field: StatField) =>
  field === 'bst' ? mon.bst : mon.baseStats[field]

interface StatFilter {
  field: StatField
  comparator: Comparator
  value: string
}

/** HP ≥ 0 matches everything, so a fresh row never changes the results. */
const newStatFilter = (): StatFilter => ({ field: 'hp', comparator: 'gte', value: '0' })

export function Dex() {
  const [rawDex, setRawDex] = useState<PokemonDex | null>(null)
  const [league, setLeague] = useState<League | null>(null)
  const [abilities, setAbilities] = useState<AbilityDex | null>(null)
  const [moves, setMoves] = useState<MoveDex | null>(null)
  const [learnsets, setLearnsets] = useState<LearnsetDex | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [type1, setType1] = useState<string>(ANY)
  const [type2, setType2] = useState<string>(ANY)
  const [tier, setTier] = useState<string>(ANY)
  const [statFilters, setStatFilters] = useState<StatFilter[]>([newStatFilter()])
  const [ability, setAbility] = useState('')
  const [move, setMove] = useState('')

  useEffect(() => { loadPokemon().then(setRawDex, (e: Error) => setError(e.message)) }, [])
  useEffect(() => { loadLeague().then(setLeague, () => {}) }, [])
  // Only the ability and move filters need these, so they stream in behind the
  // Pokémon list rather than blocking it.
  useEffect(() => { loadAbilities().then(setAbilities, () => {}) }, [])
  useEffect(() => { loadMoves().then(setMoves, () => {}) }, [])
  useEffect(() => { loadLearnsets().then(setLearnsets, () => {}) }, [])

  /** Sheet values win over the Showdown dataset wherever they overlap. */
  const dex = useMemo(() => (rawDex ? mergeDex(rawDex, league) : null), [rawDex, league])

  const abilityNames = useMemo(
    () => (abilities ? [...new Set(Object.values(abilities).map((a) => a.name))].sort() : []),
    [abilities],
  )
  const moveNames = useMemo(
    () => (moves ? [...new Set(Object.values(moves).map((m) => m.name))].sort() : []),
    [moves],
  )

  /**
   * Move ids matching the typed text. An exact name wins outright; otherwise
   * every partial match counts, so "swords" finds Swords Dance without needing
   * the full name.
   */
  const moveIds = useMemo(() => {
    const q = move.trim()
    if (!q || !moves) return null
    const key = toId(q)
    const exact = Object.entries(moves).find(([, m]) => toId(m.name) === key)
    if (exact) return { ids: new Set([exact[0]]), label: exact[1].name }
    const lower = q.toLowerCase()
    const partial = Object.entries(moves).filter(([, m]) => m.name.toLowerCase().includes(lower))
    if (!partial.length) return { ids: new Set<string>(), label: q }
    return {
      ids: new Set(partial.map(([id]) => id)),
      label: partial.length === 1 ? partial[0][1].name : `${partial.length} moves matching “${q}”`,
    }
  }, [move, moves])

  const tiers = useMemo(() => {
    if (!dex) return []
    return [...new Set(Object.values(dex).map((p) => p.draftTier ?? p.tier).filter(Boolean) as string[])]
  }, [dex])

  // Only conditions that actually narrow anything count; the default HP >= 0
  // row is a placeholder, not a filter.
  const activeStats = useMemo(
    () => statFilters.filter((f) => {
      const n = Number(f.value)
      if (f.value.trim() === '' || !Number.isFinite(n)) return false
      return !(f.field === 'hp' && f.comparator === 'gte' && n === 0)
    }),
    [statFilters],
  )

  const results = useMemo(() => {
    if (!dex) return []
    const nameQuery = name.trim().toLowerCase()
    const nameKey = toId(name)
    const abilityQuery = ability.trim().toLowerCase()

    return Object.entries(dex)
      .filter(([id, mon]) => {
        if (nameQuery && !mon.name.toLowerCase().includes(nameQuery) && !id.includes(nameKey)) return false

        // The two type dropdowns describe a combination, not slots — order in
        // the dex is arbitrary, so Fire + Flying must find Charizard either way.
        if (type1 !== ANY && !mon.types.includes(type1 as TypeName)) return false
        if (type2 === NONE) {
          if (mon.types.length !== 1) return false
        } else if (type2 !== ANY) {
          if (!mon.types.includes(type2 as TypeName)) return false
          // Both dropdowns set to the same type would otherwise match any
          // Pokémon carrying it once.
          if (type1 === type2 && mon.types.length < 2) return false
        }

        if (tier !== ANY && (mon.draftTier ?? mon.tier) !== tier) return false

        // Every condition has to hold, so stacking rows narrows the list.
        for (const f of activeStats) {
          const v = statValue(mon, f.field)
          const n = Number(f.value)
          if (f.comparator === 'gte' && v < n) return false
          if (f.comparator === 'lte' && v > n) return false
          if (f.comparator === 'eq' && v !== n) return false
        }

        if (abilityQuery
          && !Object.values(mon.abilities).some((a) => a.toLowerCase().includes(abilityQuery))) return false

        if (moveIds) {
          const learnset = learnsets?.[id]
          if (!learnset) return false
          if (![...moveIds.ids].some((mid) => learnset[mid])) return false
        }

        return true
      })
      .map(([id, mon]) => ({ id, mon }))
      .sort((a, b) => b.mon.bst - a.mon.bst)
  }, [dex, name, type1, type2, tier, activeStats, ability, moveIds, learnsets])

  const reset = () => {
    setName(''); setType1(ANY); setType2(ANY); setTier(ANY)
    setStatFilters([newStatFilter()])
    setAbility(''); setMove('')
  }

  const anyFilterActive = Boolean(
    name.trim() || type1 !== ANY || type2 !== ANY || tier !== ANY || activeStats.length || ability.trim() || move.trim(),
  )

  if (error) return <p className="error">Could not load data: {error}</p>
  if (!dex) return <p className="loading">Loading dex…</p>

  const pending = [!abilities && 'abilities', !moves && 'moves', !learnsets && 'learnsets'].filter(Boolean)

  return (
    <div className="dex">
      <div className="filters">
        <label className="filter filter-wide">
          <span>Name</span>
          <input
            type="search" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Any"
          />
        </label>

        <label className="filter filter-type">
          <span>Type 1</span>
          <select value={type1} onChange={(e) => setType1(e.target.value)}>
            <option value={ANY}>Any</option>
            {BATTLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className="filter filter-type">
          <span>Type 2</span>
          <select value={type2} onChange={(e) => setType2(e.target.value)}>
            <option value={ANY}>Any</option>
            <option value={NONE}>None</option>
            {BATTLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className="filter">
          <span>Tier</span>
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value={ANY}>Any</option>
            {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <div className="filter filter-stat">
          <span>
            Stat
            <button
              type="button" className="stat-step"
              onClick={() => setStatFilters((f) => [...f, newStatFilter()])}
              aria-label="Add another stat condition" title="Add a stat condition"
            >
              +
            </button>
            <button
              type="button" className="stat-step"
              onClick={() => setStatFilters((f) => (f.length > 1 ? f.slice(0, -1) : f))}
              disabled={statFilters.length < 2}
              aria-label="Remove the last stat condition" title="Remove a stat condition"
            >
              −
            </button>
          </span>
          {statFilters.map((f, i) => {
            const update = (patch: Partial<StatFilter>) =>
              setStatFilters((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <div className="stat-row" key={i}>
                <select
                  value={f.field} onChange={(e) => update({ field: e.target.value as StatField })}
                  aria-label={`Stat ${i + 1}`}
                >
                  {STAT_FIELDS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <select
                  value={f.comparator} onChange={(e) => update({ comparator: e.target.value as Comparator })}
                  aria-label={`Comparison ${i + 1}`}
                >
                  {COMPARATORS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <input
                  type="number" value={f.value} min={0}
                  onChange={(e) => update({ value: e.target.value })}
                  aria-label={`Stat value ${i + 1}`}
                />
              </div>
            )
          })}
        </div>

        <label className="filter">
          <span>Ability</span>
          <input
            type="search" value={ability} onChange={(e) => setAbility(e.target.value)}
            placeholder="Any" list="ability-options"
          />
          <datalist id="ability-options">
            {abilityNames.map((a) => <option key={a} value={a} />)}
          </datalist>
        </label>

        <label className="filter">
          <span>Move</span>
          <input
            type="search" value={move} onChange={(e) => setMove(e.target.value)}
            placeholder="Any" list="move-options"
          />
          <datalist id="move-options">
            {moveNames.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>

        <div className="filter filter-actions">
          {/* Empty label row so the count lands on the controls' baseline
              rather than the labels above them. */}
          <span className="label-spacer" aria-hidden="true" />
          <div className="actions-row">
            <span className="count">{results.length} of {Object.keys(dex).length}</span>
            {anyFilterActive && (
              <button type="button" className="btn ghost sm" onClick={reset}>Reset</button>
            )}
          </div>
        </div>
      </div>

      {pending.length > 0 && <p className="panel-note">Loading {pending.join(', ')}…</p>}
      {move.trim() && moveIds && (
        <p className="panel-note">Filtering by {moveIds.label}.</p>
      )}

      <ul className="dex-grid">
        {results.slice(0, PAGE).map(({ id, mon }) => <Card key={id} mon={mon} />)}
      </ul>
      {!results.length && <p className="panel-note">Nothing matches these filters.</p>}
      {results.length > PAGE && (
        <p className="panel-note">Showing the first {PAGE} of {results.length}. Narrow the filters to see more.</p>
      )}
    </div>
  )
}

function Card({ mon }: { mon: LeaguePokemon }) {
  const badge = mon.draftTier ?? mon.tier
  return (
    <li className="dex-card">
      <img src={spriteUrl(mon)} alt="" loading="lazy" width={68} height={56} />
      <div>
        <div className="dex-card-head">
          <span className="name">{mon.name}</span>
          {badge && <span className={mon.draftTier ? tierClass(mon.draftTier) : 'tier'}>{badge}</span>}
        </div>
        <div className="dex-types">{mon.types.map((t: TypeName) => <TypeChip key={t} type={t} />)}</div>
        <div className="dex-stats">
          {BST_ORDER.map((k) => (
            <span key={k}><em>{STAT_LABELS[k]}</em>{mon.baseStats[k]}</span>
          ))}
          <span className="bst"><em>BST</em>{mon.bst}</span>
        </div>
        <div className="dex-abilities">{Object.values(mon.abilities).join(', ')}</div>
      </div>
    </li>
  )
}
