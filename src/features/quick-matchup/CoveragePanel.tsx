import { useEffect, useMemo, useState } from 'react'
import { spriteUrl } from '../../data/load'
import type { LearnsetDex, MoveDex, SetDex, TypeChart, TypeName } from '../../data/types'
import { attackingTypes, coverage } from '../../lib/matchup'
import { TypeChip } from '../../components/TypeChip'
import type { Team } from './TeamEditor'

interface Props {
  attackers: Team
  defenders: Team
  chart: TypeChart
  moves: MoveDex
  learnsets: LearnsetDex
  useAbilities: boolean
  minPower: number
  /** Most-used sets; null while loading or when showing the full pool. */
  sets: SetDex | null
  /** Bumping this clears every per-Pokémon type exclusion. */
  resetKey: number
}

/**
 * Which of the opposing team each Pokémon can threaten. Type chips start with
 * everything the Pokémon can learn at the chosen power floor and can be toggled
 * off to ask "what if I only run these moves?" — the percentage recomputes
 * against the narrowed set.
 */
export function CoverageBody({
  attackers, defenders, chart, moves, learnsets, useAbilities, minPower, resetKey, sets,
}: Props) {
  // A Pokémon appears here only once it has been toggled; until then it uses
  // the default selection below.
  const [custom, setCustom] = useState<Record<string, Set<TypeName>>>({})
  useEffect(() => { setCustom({}) }, [resetKey])

  /** Every type the Pokémon could attack with, split by category. */
  const available = useMemo(() => {
    const out: Record<string, { physical: Set<TypeName>; special: Set<TypeName> }> = {}
    for (const m of attackers.members) {
      const pool = attackingTypes(learnsets[m.id], moves, minPower)
      // A set can include a move under the power floor; it still belongs here.
      const fromSet = attackingTypes(learnsets[m.id], moves, 0, sets?.[m.id]?.moves)
      out[m.id] = {
        physical: new Set([...pool.physical, ...fromSet.physical]),
        special: new Set([...pool.special, ...fromSet.special]),
      }
    }
    return out
  }, [attackers.members, learnsets, moves, minPower, sets])

  /** Ticked on load: what the Pokémon actually runs, per its most-used set. */
  const defaults = useMemo(() => {
    const out: Record<string, Set<TypeName>> = {}
    for (const m of attackers.members) {
      const set = sets?.[m.id]?.moves
      if (set) {
        const t = attackingTypes(learnsets[m.id], moves, 0, set)
        out[m.id] = new Set([...t.physical, ...t.special])
      } else {
        // No set on record, so fall back to everything it can throw.
        out[m.id] = new Set([...available[m.id].physical, ...available[m.id].special])
      }
    }
    return out
  }, [attackers.members, learnsets, moves, sets, available])

  const selected = useMemo(() => {
    const out: Record<string, Set<TypeName>> = {}
    for (const m of attackers.members) out[m.id] = custom[m.id] ?? defaults[m.id]
    return out
  }, [attackers.members, custom, defaults])

  /**
   * The moves behind each chip, so hovering a type says what it is actually
   * attacking with. Set moves come first and are marked; the rest follow by
   * base power, capped so a wide movepool does not produce a wall of text.
   */
  const moveNames = useMemo(() => {
    const out: Record<string, Record<string, string>> = {}
    for (const m of attackers.members) {
      const setMoves = new Set(sets?.[m.id]?.moves ?? [])
      const byKey: Record<string, { name: string; power: number; inSet: boolean }[]> = {}
      for (const moveId of Object.keys(learnsets[m.id] ?? {})) {
        const move = moves[moveId]
        if (!move || move.category === 'Status' || move.basePower <= 0) continue
        const inSet = setMoves.has(moveId)
        if (!inSet && move.basePower < minPower) continue
        const key = `${move.category}:${move.type}`
        ;(byKey[key] ??= []).push({ name: move.name, power: move.basePower, inSet })
      }
      out[m.id] = {}
      for (const [key, list] of Object.entries(byKey)) {
        list.sort((a, b) => Number(b.inSet) - Number(a.inSet) || b.power - a.power)
        const shown = list.slice(0, 4).map((x) => `${x.name} (${x.power})${x.inSet ? ' ★' : ''}`)
        const extra = list.length - shown.length
        out[m.id][key] = shown.join('\n') + (extra > 0 ? `\n+${extra} more` : '')
      }
    }
    return out
  }, [attackers.members, learnsets, moves, minPower, sets])

  const results = useMemo(
    () => coverage(chart, attackers.members, defenders.members, learnsets, moves, useAbilities, selected, minPower, sets ?? undefined),
    [chart, attackers.members, defenders.members, learnsets, moves, useAbilities, selected, minPower, sets],
  )

  const byId = useMemo(
    () => Object.fromEntries(defenders.members.map((m) => [m.id, m.pokemon])),
    [defenders.members],
  )

  const toggle = (attackerId: string, type: TypeName) =>
    setCustom((prev) => {
      const next = new Set(prev[attackerId] ?? selected[attackerId])
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return { ...prev, [attackerId]: next }
    })

  if (!attackers.members.length || !defenders.members.length) return null

  return (
    <ul className="coverage-list">
        {results.map((r) => {
          const on = selected[r.id]
          const chip = (category: 'Physical' | 'Special') => (t: TypeName) => {
            const list = moveNames[r.id]?.[`${category}:${t}`]
            return (
              <TypeChip
                key={t}
                type={t}
                muted={!on?.has(t)}
                onClick={() => toggle(r.id, t)}
                title={list ? `${t} — ${category}\n${list}` : t}
              />
            )
          }
          return (
            <li key={r.id} className="coverage-row">
              <div className="coverage-mon">
                <img src={spriteUrl(r.pokemon)} alt={r.pokemon.name} width={64} height={52} />
                <span>
                  {r.pokemon.name}
                  {sets && !sets[r.id] && <em className="no-set" title="No common set on record — showing its full movepool">full pool</em>}
                </span>
              </div>

              <div className="coverage-types">
                <div className="coverage-line">
                  <span className="cat-tag cat-physical">Phys</span>
                  {[...available[r.id].physical].sort().map(chip('Physical'))}
                  {!available[r.id].physical.size && <em className="none">none</em>}
                </div>
                <div className="coverage-line">
                  <span className="cat-tag cat-special">Spec</span>
                  {[...available[r.id].special].sort().map(chip('Special'))}
                  {!available[r.id].special.size && <em className="none">none</em>}
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
  )
}
