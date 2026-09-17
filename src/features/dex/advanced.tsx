/**
 * The half of the dex search that is about a Pokemon rather than about a board:
 * its types, its ability, a move it learns, its stats.
 *
 * Shared because it is now asked in two places. The dex asks it of all 1,379
 * Pokemon; the draft list asks it of one season's board, behind an "Advanced
 * search" toggle, so a coach can find the Water-type under ten points that
 * knows Trick Room without leaving the board they are drafting from.
 *
 * What is not here is everything the two screens already ask differently — a
 * name, legality, Megas, cost. The draft list has its own controls for those,
 * sitting in a bar that stays put while the board scrolls, and a second set in
 * the advanced row would be two controls arguing over one answer.
 */
import { useEffect, useMemo, useState } from 'react'
import { loadAbilities, loadLearnsets, loadMoves, toId } from '../../data/load'
import type { AbilityDex, LearnsetDex, MoveDex, Pokemon, StatKey } from '../../data/types'
import { BATTLE_TYPES } from '../../lib/matchup'
import { BST_ORDER, STAT_LABELS } from '../../lib/stats'

/** "any" is the do-nothing value for every dropdown. */
export const ANY = 'any'
/** Type 2 only: matches Pokemon with a single type. */
export const NONE = 'none'

type StatField = StatKey | 'bst'
type Comparator = 'gte' | 'lte' | 'eq'

export interface StatFilter {
  field: StatField
  comparator: Comparator
  value: string
}

const STAT_FIELDS: { key: StatField; label: string }[] = [
  ...BST_ORDER.map((k) => ({ key: k as StatField, label: STAT_LABELS[k] })),
  { key: 'bst', label: 'BST' },
]

const COMPARATORS: { key: Comparator; label: string }[] = [
  { key: 'gte', label: '≥' },
  { key: 'lte', label: '≤' },
  { key: 'eq', label: '=' },
]

/** HP ≥ 0 matches everything, so a fresh row never changes the results. */
const newStatFilter = (): StatFilter => ({ field: 'hp', comparator: 'gte', value: '0' })

const statValue = (mon: Pokemon, field: StatField) =>
  (field === 'bst' ? mon.bst : mon.baseStats[field])

interface State {
  type1: string
  type2: string
  ability: string
  move: string
  stats: StatFilter[]
}

const empty = (): State => ({
  type1: ANY, type2: ANY, ability: '', move: '', stats: [newStatFilter()],
})

export interface Advanced {
  /** Whether anything here is narrowing the list. */
  active: boolean
  /** True if this Pokemon passes every condition set. */
  matches: (id: string, mon: Pokemon) => boolean
  /** The controls, for whichever screen is asking. */
  controls: React.ReactNode
  reset: () => void
  /** Which tables are still loading, for a screen that wants to say so. */
  pending: string[]
}

/**
 * The state, the controls and the predicate together, because they are only
 * ever wanted together and splitting them across three exports would make
 * every caller wire them back up.
 *
 * Abilities, moves and learnsets stream in behind whatever is already on
 * screen: they are three of the four biggest files the site ships and only
 * these filters need them, so nothing waits on them to render a list.
 */
export function useAdvanced(idPrefix = 'adv'): Advanced {
  const [state, setState] = useState<State>(empty)
  const [abilities, setAbilities] = useState<AbilityDex | null>(null)
  const [moves, setMoves] = useState<MoveDex | null>(null)
  const [learnsets, setLearnsets] = useState<LearnsetDex | null>(null)

  useEffect(() => { loadAbilities().then(setAbilities, () => {}) }, [])
  useEffect(() => { loadMoves().then(setMoves, () => {}) }, [])
  useEffect(() => { loadLearnsets().then(setLearnsets, () => {}) }, [])

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
    const q = state.move.trim()
    if (!q || !moves) return null
    const key = toId(q)
    const exact = Object.entries(moves).find(([, m]) => toId(m.name) === key)
    if (exact) return new Set([exact[0]])
    const lower = q.toLowerCase()
    return new Set(Object.entries(moves)
      .filter(([, m]) => m.name.toLowerCase().includes(lower))
      .map(([id]) => id))
  }, [state.move, moves])

  // Only conditions that actually narrow anything count; the default HP >= 0
  // row is a placeholder, not a filter.
  const activeStats = useMemo(
    () => state.stats.filter((f) => {
      const n = Number(f.value)
      if (f.value.trim() === '' || !Number.isFinite(n)) return false
      return !(f.field === 'hp' && f.comparator === 'gte' && n === 0)
    }),
    [state.stats],
  )

  const matches = useMemo(() => {
    const abilityQuery = state.ability.trim().toLowerCase()
    return (id: string, mon: Pokemon) => {
      // The two type dropdowns describe a combination, not slots — order in the
      // dex is arbitrary, so Fire + Flying must find Charizard either way.
      if (state.type1 !== ANY && !mon.types.includes(state.type1 as never)) return false
      if (state.type2 === NONE) {
        if (mon.types.length !== 1) return false
      } else if (state.type2 !== ANY) {
        if (!mon.types.includes(state.type2 as never)) return false
        // Both dropdowns set to the same type would otherwise match any Pokemon
        // carrying it once.
        if (state.type1 === state.type2 && mon.types.length < 2) return false
      }

      // Every condition has to hold, so stacking rows narrows the list.
      for (const f of activeStats) {
        const v = statValue(mon, f.field)
        const n = Number(f.value)
        if (f.comparator === 'gte' && v < n) return false
        if (f.comparator === 'lte' && v > n) return false
        if (f.comparator === 'eq' && v !== n) return false
      }

      if (abilityQuery
        && !Object.values(mon.abilities).some((a) => a.toLowerCase().includes(abilityQuery))) {
        return false
      }

      if (moveIds) {
        const learnset = learnsets?.[id]
        if (!learnset) return false
        if (![...moveIds].some((mid) => learnset[mid])) return false
      }
      return true
    }
  }, [state.type1, state.type2, state.ability, activeStats, moveIds, learnsets])

  const active = Boolean(
    state.type1 !== ANY || state.type2 !== ANY
    || state.ability.trim() || state.move.trim() || activeStats.length,
  )

  const set = <K extends keyof State>(key: K, value: State[K]) =>
    setState((prev) => ({ ...prev, [key]: value }))

  const controls = (
    <>
      <label className="filter filter-type">
        <span>Type 1</span>
        <select value={state.type1} onChange={(e) => set('type1', e.target.value)}>
          <option value={ANY}>Any</option>
          {BATTLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      <label className="filter filter-type">
        <span>Type 2</span>
        <select value={state.type2} onChange={(e) => set('type2', e.target.value)}>
          <option value={ANY}>Any</option>
          <option value={NONE}>None</option>
          {BATTLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      <label className="filter filter-narrow">
        <span>Ability</span>
        <input
          type="search" value={state.ability} onChange={(e) => set('ability', e.target.value)}
          placeholder="Any" list={`${idPrefix}-abilities`}
        />
        <datalist id={`${idPrefix}-abilities`}>
          {abilityNames.map((a) => <option key={a} value={a} />)}
        </datalist>
      </label>

      <label className="filter filter-narrow">
        <span>Move</span>
        <input
          type="search" value={state.move} onChange={(e) => set('move', e.target.value)}
          placeholder="Any" list={`${idPrefix}-moves`}
        />
        <datalist id={`${idPrefix}-moves`}>
          {moveNames.map((m) => <option key={m} value={m} />)}
        </datalist>
      </label>

      <div className="filter filter-stat">
        <span>Stat</span>
        {state.stats.map((f, i) => {
          const update = (patch: Partial<StatFilter>) =>
            set('stats', state.stats.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <div className="stat-row" key={i}>
              <select
                value={f.field} onChange={(e) => update({ field: e.target.value as StatField })}
                aria-label={`Stat ${i + 1}`}
              >
                {STAT_FIELDS.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
              </select>
              <select
                value={f.comparator}
                onChange={(e) => update({ comparator: e.target.value as Comparator })}
                aria-label={`Comparison ${i + 1}`}
              >
                {COMPARATORS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <input
                type="number" value={f.value} min={0}
                onChange={(e) => update({ value: e.target.value })}
                aria-label={`Stat value ${i + 1}`}
              />
              {/* The first row adds; every row after it closes itself. */}
              {i === 0 ? (
                <button
                  type="button" className="stat-step"
                  onClick={() => set('stats', [...state.stats, newStatFilter()])}
                  aria-label="Add another stat condition" title="Add a stat condition"
                >
                  +
                </button>
              ) : (
                <button
                  type="button" className="stat-step"
                  onClick={() => set('stats', state.stats.filter((_, j) => j !== i))}
                  aria-label={`Remove stat condition ${i + 1}`} title="Remove this condition"
                >
                  −
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  return {
    active,
    matches,
    controls,
    reset: () => setState(empty()),
    pending: [!abilities && 'abilities', !moves && 'moves', !learnsets && 'learnsets']
      .filter(Boolean) as string[],
  }
}
