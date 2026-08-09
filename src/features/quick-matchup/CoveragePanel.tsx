import { useMemo, useState } from 'react'
import { spriteUrl } from '../../data/load'
import type { LearnsetDex, MoveDex, TypeChart, TypeName } from '../../data/types'
import { attackingTypes, coverage } from '../../lib/matchup'
import { TypeChip } from '../../components/TypeChip'
import { Widget } from '../../components/Widget'
import type { Team } from './TeamEditor'

interface Props {
  attackers: Team
  defenders: Team
  chart: TypeChart
  moves: MoveDex
  learnsets: LearnsetDex
}

const POWER_STEPS = [0, 60, 75, 90]

/**
 * Which of the opposing team each Pokémon can threaten. Type chips start with
 * everything the Pokémon can learn at the chosen power floor and can be toggled
 * off to ask "what if I only run these moves?" — the percentage recomputes
 * against the narrowed set.
 */
export function CoveragePanel({ attackers, defenders, chart, moves, learnsets }: Props) {
  const [useAbilities, setUseAbilities] = useState(true)
  // 75 is roughly "a move you would actually click". At 0 nearly every Pokémon
  // reads 100% because Gen 9 TMs hand out weak coverage of half the type chart.
  const [minPower, setMinPower] = useState(75)
  const [deselected, setDeselected] = useState<Record<string, Set<TypeName>>>({})

  const available = useMemo(() => {
    const out: Record<string, { physical: Set<TypeName>; special: Set<TypeName> }> = {}
    for (const m of attackers.members) out[m.id] = attackingTypes(learnsets[m.id], moves, minPower)
    return out
  }, [attackers.members, learnsets, moves, minPower])

  const selected = useMemo(() => {
    const out: Record<string, Set<TypeName>> = {}
    for (const m of attackers.members) {
      const all = new Set<TypeName>([...available[m.id].physical, ...available[m.id].special])
      const off = deselected[m.id]
      out[m.id] = off ? new Set([...all].filter((t) => !off.has(t))) : all
    }
    return out
  }, [attackers.members, available, deselected])

  const results = useMemo(
    () => coverage(chart, attackers.members, defenders.members, learnsets, moves, useAbilities, selected, minPower),
    [chart, attackers.members, defenders.members, learnsets, moves, useAbilities, selected, minPower],
  )

  const byId = useMemo(
    () => Object.fromEntries(defenders.members.map((m) => [m.id, m.pokemon])),
    [defenders.members],
  )

  const toggle = (attackerId: string, type: TypeName) =>
    setDeselected((prev) => {
      const next = new Set(prev[attackerId] ?? [])
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return { ...prev, [attackerId]: next }
    })

  if (!attackers.members.length || !defenders.members.length) return null

  return (
    <Widget
      title="Coverage"
      width={584}
      actions={
        <>
          <label className="toggle">
            <span>Min BP</span>
            <select value={minPower} onChange={(e) => setMinPower(Number(e.target.value))}>
              {POWER_STEPS.map((p) => <option key={p} value={p}>{p || 'any'}</option>)}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={useAbilities} onChange={(e) => setUseAbilities(e.target.checked)} />
            <span>Abilities</span>
          </label>
          <button type="button" className="btn ghost sm" onClick={() => setDeselected({})}>Reset</button>
        </>
      }
      footnote="Percentages count opponents hit for at least 2×. Click a type to drop it from the calculation."
    >
      <ul className="coverage-list">
        {results.map((r) => {
          const off = deselected[r.id]
          const chip = (t: TypeName) => (
            <TypeChip
              key={t}
              type={t}
              muted={off?.has(t)}
              onClick={() => toggle(r.id, t)}
              title={off?.has(t) ? `Include ${t}` : `Exclude ${t}`}
            />
          )
          return (
            <li key={r.id} className="coverage-row">
              <div className="coverage-mon">
                <img src={spriteUrl(r.pokemon)} alt={r.pokemon.name} width={64} height={52} />
                <span>{r.pokemon.name}</span>
              </div>

              <div className="coverage-types">
                <div className="coverage-line">
                  <span className="cat-tag cat-physical">Phys</span>
                  {[...r.physical].sort().map(chip)}
                  {!r.physical.size && <em className="none">none</em>}
                </div>
                <div className="coverage-line">
                  <span className="cat-tag cat-special">Spec</span>
                  {[...r.special].sort().map(chip)}
                  {!r.special.size && <em className="none">none</em>}
                </div>
              </div>

              <div className="coverage-result">
                <div className="coverage-bar" title={`${r.hits.length} of ${defenders.members.length} hit super effectively`}>
                  <span className="bar-hit" style={{ width: `${r.percent}%` }}>{r.percent > 14 ? `${r.percent}%` : ''}</span>
                  <span className="bar-miss">{r.percent <= 86 ? `${100 - r.percent}%` : ''}</span>
                </div>
                <span className="coverage-count">
                  threatens {r.hits.length}/{defenders.members.length}
                </span>
                <div className="coverage-targets">
                  {r.hits.map((id) => (
                    <img key={id} className="hit" src={spriteUrl(byId[id])} alt={byId[id]?.name} title={`Hits ${byId[id]?.name}`} width={38} height={32} />
                  ))}
                  {r.misses.map((id) => (
                    <img key={id} className="miss" src={spriteUrl(byId[id])} alt={byId[id]?.name} title={`No super-effective hit on ${byId[id]?.name}`} width={38} height={32} />
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Widget>
  )
}
