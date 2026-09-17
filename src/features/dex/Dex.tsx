import { useEffect, useMemo, useState } from 'react'
import { loadPokemon, toId } from '../../data/load'
import type { PokemonDex, TypeName } from '../../data/types'
import {
  isMega, loadLeague, mergeDex, subscribeLeague, type League, type LeaguePokemon,
} from '../../data/league'
import { ANY, useAdvanced } from './advanced'
import { DraftValue } from '../../components/DraftValue'
import { TypeChip } from '../../components/TypeChip'
import { BST_ORDER, STAT_LABELS } from '../../lib/stats'
import { PokemonLink } from '../../components/PokemonLink'
import { LoadingBall } from '../../components/LoadingBall'
import { Sprite } from '../../components/Sprite'

const PAGE = 200


/**
 * Whether a Pokemon can be drafted this season.
 *
 * `legal` is the one the dex opens on. It is a dex of 1,379 Pokemon and a
 * season's board is a few hundred of them, so without this the first answer to
 * any search is mostly Pokemon nobody can have — and the thing a coach is
 * usually asking is "what can I take".
 *
 * `banned` is everything that is not: the rows a board marks Banned, and the
 * Pokemon a board never listed at all. They are one answer to the coach's
 * question even though they are two facts about the board.
 */
const LEGAL = 'legal'
const BANNED = 'banned'

/** Mega and Primal formes, against everything else. */
const MEGA = 'mega'
const PLAIN = 'plain'

export function Dex() {
  const [rawDex, setRawDex] = useState<PokemonDex | null>(null)
  const [league, setLeague] = useState<League | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [tier, setTier] = useState<string>(ANY)
  const [legality, setLegality] = useState<string>(LEGAL)
  const [megas, setMegas] = useState<string>(ANY)
  /** Types, ability, move and stats — shared with the draft list's own search. */
  const adv = useAdvanced('dex')

  useEffect(() => { loadPokemon().then(setRawDex, (e: Error) => setError(e.message)) }, [])
  useEffect(() => {
    loadLeague().then(setLeague, () => {})
    return subscribeLeague(setLeague)
  }, [])

  /** Sheet values win over the Showdown dataset wherever they overlap. */
  const dex = useMemo(() => (rawDex ? mergeDex(rawDex, league) : null), [rawDex, league])

  /**
   * The league values its board one way or the other, so this filter is
   * whichever it is: costs on a priced season, tiers on a banded one. Offering
   * tiers on a season that has none would be filtering by a number nobody is
   * shown.
   */
  const priced = useMemo(
    () => !!dex && Object.values(dex).some((p) => p.points != null),
    [dex],
  )
  /**
   * Whether there is a board to be legal against.
   *
   * Without this the dex is empty for the moment before the league loads, and
   * empty for good on All Time, which has no board of its own — every Pokemon
   * would read as illegal because nothing had said otherwise yet.
   */
  const hasBoard = useMemo(
    () => !!dex && Object.values(dex).some((p) => p.onBoard),
    [dex],
  )
  const tiers = useMemo(() => {
    if (!dex) return []
    if (priced) {
      return [...new Set(Object.values(dex).map((p) => p.points).filter((n) => n != null))]
        .sort((a, b) => (b as number) - (a as number))
        .map(String)
    }
    return [...new Set(Object.values(dex).map((p) => p.draftTier ?? p.tier).filter(Boolean) as string[])]
  }, [dex, priced])

  const results = useMemo(() => {
    if (!dex) return []
    const nameQuery = name.trim().toLowerCase()
    const nameKey = toId(name)

    return Object.entries(dex)
      .filter(([id, mon]) => {
        if (nameQuery && !mon.name.toLowerCase().includes(nameQuery) && !id.includes(nameKey)) return false

        if (hasBoard && legality !== ANY) {
          const legal = mon.onBoard && mon.draftTier !== 'Banned'
          if (legal !== (legality === LEGAL)) return false
        }

        if (megas !== ANY && isMega(mon) !== (megas === MEGA)) return false

        if (tier !== ANY) {
          const value = priced ? (mon.points == null ? null : String(mon.points)) : (mon.draftTier ?? mon.tier)
          if (value !== tier) return false
        }

        return adv.matches(id, mon)
      })
      .map(([id, mon]) => ({ id, mon }))
      // What it costs, dearest first: on a board priced one to twenty, that is
      // the question the list is usually being read to answer. Base stat total
      // breaks the ties, which is the order this list used to be in, and an
      // unpriced season falls back to it whole. Unpriced sorts last rather
      // than as zero — a Pokemon off the board has no cost, not a free one.
      .sort((a, b) => (b.mon.points ?? -1) - (a.mon.points ?? -1) || b.mon.bst - a.mon.bst)
  }, [dex, name, tier, legality, megas, hasBoard, priced, adv])

  // Back to how the dex opens, which is legal-only — not to no filters at all.
  const reset = () => {
    setName(''); setTier(ANY); setLegality(LEGAL); setMegas(ANY)
    adv.reset()
  }

  const anyFilterActive = Boolean(
    name.trim() || tier !== ANY || legality !== LEGAL || megas !== ANY || adv.active,
  )

  if (error) return <p className="error">Could not load data: {error}</p>
  if (!dex) return <LoadingBall label="Loading dex…" />

  const pending = adv.pending

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

        {hasBoard && (
          <label className="filter">
            <span>Legality</span>
            <select
              value={legality} onChange={(e) => setLegality(e.target.value)}
              title="Banned covers both the rows the board marks Banned and the Pokémon it never listed"
            >
              <option value={LEGAL}>Legal</option>
              <option value={BANNED}>Banned</option>
              <option value={ANY}>Any</option>
            </select>
          </label>
        )}

        <label className="filter">
          <span>Mega</span>
          <select value={megas} onChange={(e) => setMegas(e.target.value)}>
            <option value={ANY}>Any</option>
            <option value={MEGA}>Megas</option>
            <option value={PLAIN}>Non-Megas</option>
          </select>
        </label>

        <label className="filter">
          <span>{priced ? 'Cost' : 'Tier'}</span>
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value={ANY}>Any</option>
            {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        {adv.controls}

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

      <ul className="dex-grid">
        {results.slice(0, PAGE).map(({ id, mon }) => <Card key={id} id={id} mon={mon} />)}
      </ul>
      {!results.length && <p className="panel-note">Nothing matches these filters.</p>}
      {results.length > PAGE && (
        <p className="panel-note">Showing the first {PAGE} of {results.length}. Narrow the filters to see more.</p>
      )}
    </div>
  )
}

function Card({ id, mon }: { id: string; mon: LeaguePokemon }) {
  return (
    <li className="dex-card">
      <PokemonLink id={id} title={mon.name}>
        <Sprite pokemon={mon} width={68} height={56} />
      </PokemonLink>
      <div>
        <div className="dex-card-head">
          <span className="name"><PokemonLink id={id}>{mon.name}</PokemonLink></span>
          {/* The league's price where there is one, its tier where there is
              not, and Smogon's tier for anything the league never listed. */}
          <DraftValue mon={mon} fallback={mon.tier} />
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
