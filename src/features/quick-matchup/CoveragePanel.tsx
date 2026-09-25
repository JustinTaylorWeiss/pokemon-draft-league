import { useEffect, useMemo, useState } from 'react'
import type { LearnsetDex, MoveDex, SetDex, TypeChart, TypeName } from '../../data/types'
import { attackingTypes, coverage } from '../../lib/matchup'
import { TypeChip } from '../../components/TypeChip'
import { MoveCategory } from '../../components/MoveCategory'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { Sprite } from '../../components/Sprite'

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
 *
 * Ordered by that percentage, because the question the panel answers is which
 * of your side gets through, and the answer should be readable off the top of
 * the list rather than hunted for down it.
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

  /**
   * Strongest first, with the Pokémon that have no most-used set on record
   * held back into their own group below.
   *
   * Their percentage is answering a different question — what the whole
   * movepool could do, not what the Pokémon is actually likely to be carrying
   * — so it reads high and ranking it against the rest would put an unknown
   * quantity above a known one. Saying it once over the group also beats the
   * tag this used to carry on every row.
   */
  const { ranked, noSet } = useMemo(() => {
    const byThreat = [...results].sort(
      (a, b) => b.percent - a.percent || a.pokemon.name.localeCompare(b.pokemon.name),
    )
    // Still loading: nothing is known to be missing a set yet.
    if (!sets) return { ranked: byThreat, noSet: [] as typeof byThreat }
    return {
      ranked: byThreat.filter((r) => sets[r.id]),
      noSet: byThreat.filter((r) => !sets[r.id]),
    }
  }, [results, sets])

  const toggle = (attackerId: string, type: TypeName) =>
    setCustom((prev) => {
      const next = new Set(prev[attackerId] ?? selected[attackerId])
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return { ...prev, [attackerId]: next }
    })

  if (!attackers.members.length || !defenders.members.length) return null

  const row = (r: (typeof results)[number]) => {
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
          <PokemonLink id={r.id} title={r.pokemon.name}>
            <Sprite pokemon={r.pokemon} width={64} height={52} />
          </PokemonLink>
          <span>
            <PokemonLink id={r.id}>{r.pokemon.name}</PokemonLink>
          </span>
        </div>

        <div className="coverage-types">
          <div className="coverage-line">
            <span className="cat-tag"><MoveCategory category="Physical" /></span>
            {[...available[r.id].physical].sort().map(chip('Physical'))}
            {!available[r.id].physical.size && <em className="none">none</em>}
          </div>
          <div className="coverage-line">
            <span className="cat-tag"><MoveCategory category="Special" /></span>
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
              <PokemonLink key={id} id={id} title={`Hits ${byId[id]?.name}`}>
                <Sprite pokemon={byId[id]} className="hit" width={38} height={32} />
              </PokemonLink>
            ))}
            {r.misses.map((id) => (
              <PokemonLink key={id} id={id} title={`No super-effective hit on ${byId[id]?.name}`}>
                <Sprite pokemon={byId[id]} className="miss" width={38} height={32} />
              </PokemonLink>
            ))}
          </div>
        </div>
      </li>
    )
  }

  return (
    <>
      {ranked.length > 0 && <ul className="coverage-list">{ranked.map(row)}</ul>}
      {noSet.length > 0 && (
        <>
          <p className="coverage-group-head">
            No most-used set on record — showing their full movepool
          </p>
          <ul className="coverage-list">{noSet.map(row)}</ul>
        </>
      )}
    </>
  )
}
