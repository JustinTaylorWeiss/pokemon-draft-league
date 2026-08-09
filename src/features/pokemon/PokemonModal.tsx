import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  artworkUrl, loadAbilities, loadLearnsets, loadMoves, loadPokemon, loadSets,
  loadTypeChart, spriteUrl, toId,
} from '../../data/load'
import type {
  AbilityDex, LearnsetDex, Move, MoveDex, PokemonDex, SetDex, TypeChart, TypeName,
} from '../../data/types'
import { loadLeague, mergeDex, tierClass, type League, type LeaguePokemon } from '../../data/league'
import { BATTLE_TYPES, defensiveMultiplier } from '../../lib/matchup'
import { BST_ORDER, STAT_LABELS, statAt100 } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import { useProgressiveList } from '../../lib/useProgressiveList'
import { usePokemonModal } from './PokemonModalContext'
import './pokemon-modal.css'

/** Learn-source prefixes, in the order the sheet-style tables read best. */
const MOVE_GROUPS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: 'level', label: 'Level Up', match: (s) => s.startsWith('L') },
  { key: 'tm', label: 'TM', match: (s) => s.startsWith('M') },
  { key: 'egg', label: 'Egg Moves', match: (s) => s.startsWith('E') },
  { key: 'tutor', label: 'Tutor', match: (s) => s.startsWith('T') },
  { key: 'event', label: 'Event', match: (s) => s.startsWith('S') },
]

export function PokemonModal() {
  const { openId, close } = usePokemonModal()
  const [dex, setDex] = useState<PokemonDex | null>(null)
  const [league, setLeague] = useState<League | null>(null)
  const [abilities, setAbilities] = useState<AbilityDex | null>(null)
  const [moves, setMoves] = useState<MoveDex | null>(null)
  const [learnsets, setLearnsets] = useState<LearnsetDex | null>(null)
  const [chart, setChart] = useState<TypeChart | null>(null)
  const [sets, setSets] = useState<SetDex | null>(null)
  // Groups are independent toggles, all on by default, so search covers the
  // whole movepool unless something is switched off.
  const [enabled, setEnabled] = useState<Set<string>>(new Set(MOVE_GROUPS.map((g) => g.key)))
  const [moveQuery, setMoveQuery] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  // Everything here is already cached by the loaders, so opening the modal
  // rarely costs a request.
  useEffect(() => {
    if (!openId) return
    loadPokemon().then(setDex, () => {})
    loadLeague().then(setLeague, () => {})
    loadAbilities().then(setAbilities, () => {})
    loadMoves().then(setMoves, () => {})
    loadTypeChart().then(setChart, () => {})
    loadSets().then(setSets, () => {})
    loadLearnsets().then(setLearnsets, () => {})
  }, [openId])

  // Escape closes, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [openId, close])

  useEffect(() => { setEnabled(new Set(MOVE_GROUPS.map((g) => g.key))); setMoveQuery('') }, [openId])

  const merged = useMemo(() => (dex ? mergeDex(dex, league) : null), [dex, league])
  const mon: LeaguePokemon | undefined = openId && merged ? merged[openId] : undefined

  const learnset = openId && learnsets ? learnsets[openId] : undefined

  /**
   * One row per move, tagged with every way it can be learned, so a move that
   * is both a TM and a level-up appears once rather than twice.
   */
  const allMoves = useMemo(() => {
    if (!learnset || !moves) return null
    const rows: { move: string; name: string; groups: string[]; level: number | null }[] = []
    for (const [moveId, sources] of Object.entries(learnset)) {
      const move = moves[moveId]
      if (!move) continue
      const groups: string[] = []
      let level: number | null = null
      for (const group of MOVE_GROUPS) {
        const hit = sources.find(group.match)
        if (!hit) continue
        groups.push(group.key)
        if (group.key === 'level') level = Number(hit.slice(1)) || 0
      }
      if (groups.length) rows.push({ move: moveId, name: move.name, groups, level })
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }, [learnset, moves])

  /** How many moves each group holds, for the toggle counts. */
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const row of allMoves ?? []) for (const g of row.groups) counts[g] = (counts[g] ?? 0) + 1
    return counts
  }, [allMoves])

  /** Enabled groups first, then the search across whatever remains. */
  const visibleMoves = useMemo(() => {
    const q = moveQuery.trim().toLowerCase()
    return (allMoves ?? []).filter((row) => {
      if (!row.groups.some((g) => enabled.has(g))) return false
      if (!q) return true
      const mv = moves?.[row.move]
      if (!mv) return false
      return mv.name.toLowerCase().includes(q)
        || mv.type.toLowerCase() === q
        || mv.category.toLowerCase() === q
        || mv.shortDesc.toLowerCase().includes(q)
    })
  }, [allMoves, enabled, moveQuery, moves])

  // A full movepool is too many rows to mount in one frame; they stream in.
  const rowLimit = useProgressiveList(visibleMoves.length, openId)

  if (!openId) return null

  const commonSetMoves = sets?.[openId]?.moves ?? []

  return (
    <div
      className="modal-backdrop"
      // Only a click on the backdrop itself closes; clicks inside bubble here
      // but originate from the dialog.
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="modal" role="dialog" aria-modal="true" aria-label={mon?.name ?? 'Pokémon'}
        ref={dialogRef} tabIndex={-1}
      >
        <button type="button" className="modal-close" onClick={close} aria-label="Close">✕</button>

        {!mon ? (
          <p className="loading modal-loading">Loading…</p>
        ) : (
          <>
            <header className="modal-head">
              <img className="modal-art" src={artworkUrl(mon.num)} alt="" width={150} height={150}
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = spriteUrl(mon) }} />
              <div className="modal-title">
                <span className="modal-num">#{String(mon.num).padStart(4, '0')}</span>
                <h2>{mon.name}</h2>
                <div className="modal-types">
                  {mon.types.map((t) => <TypeChip key={t} type={t} />)}
                </div>
                <dl className="modal-facts">
                  <div><dt>Height</dt><dd>{mon.heightm} m</dd></div>
                  <div><dt>Weight</dt><dd>{mon.weightkg} kg</dd></div>
                  <div><dt>Gender</dt><dd>{genderLabel(mon)}</dd></div>
                  <div><dt>Gen</dt><dd>{mon.gen}</dd></div>
                  {mon.eggGroups?.length ? (
                    <div><dt>Egg groups</dt><dd>{mon.eggGroups.join(', ')}</dd></div>
                  ) : null}
                  <div><dt>Smogon</dt><dd>{mon.tier ?? '—'}</dd></div>
                  {mon.draftTier && (
                    <div>
                      <dt>Draft tier</dt>
                      <dd><span className={tierClass(mon.draftTier)}>{mon.draftTier}</span></dd>
                    </div>
                  )}
                  {mon.onBoard && (
                    <div>
                      <dt>Drafted by</dt>
                      <dd>{mon.draftedBy ?? <em className="none">available</em>}</dd>
                    </div>
                  )}
                </dl>
                {mon.note && <p className="modal-note">{mon.note}</p>}
              </div>
            </header>

            <div className="modal-grid">
              <section className="modal-card">
                <h3>Base Stats</h3>
                <ul className="stat-bars">
                  {BST_ORDER.map((k) => (
                    <li key={k}>
                      <span className="stat-name">{STAT_LABELS[k]}</span>
                      <span className="stat-num">{mon.baseStats[k]}</span>
                      <span className="stat-track">
                        <span className={`stat-fill stat-${k}`} style={{ width: `${Math.min(100, (mon.baseStats[k] / 200) * 100)}%` }} />
                      </span>
                    </li>
                  ))}
                  <li className="stat-total">
                    <span className="stat-name">BST</span>
                    <span className="stat-num">{mon.bst}</span>
                    <span className="stat-track" />
                  </li>
                </ul>
                <p className="modal-hint">
                  Speed at Lv 100: {statAt100(mon.baseStats.spe)} neutral, {statAt100(mon.baseStats.spe, 252, 1.1)} boosted.
                </p>
              </section>

              <section className="modal-card">
                <h3>Abilities</h3>
                <ul className="ability-list">
                  {Object.entries(mon.abilities).map(([slot, name]) => (
                    <li key={slot}>
                      <span className="ability-name">
                        {name}
                        {slot === 'H' && <em>hidden</em>}
                      </span>
                      <span className="ability-desc">{abilities?.[toId(name)]?.shortDesc ?? ''}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="modal-card modal-wide">
                <h3>Damage Taken</h3>
                {chart ? (
                  <ul className="damage-grid">
                    {BATTLE_TYPES.map((t) => {
                      const m = defensiveMultiplier(chart, t, mon, true)
                      return (
                        <li key={t} className={`dmg dmg-${String(m).replace('.', '')}`}>
                          <TypeChip type={t} />
                          <span>{m === 1 ? '1×' : `${m}×`}</span>
                        </li>
                      )
                    })}
                  </ul>
                ) : <p className="loading">Loading type chart…</p>}
                <p className="modal-hint">Includes this Pokémon's abilities.</p>
              </section>

              {(mon.prevo || mon.evos?.length) && (
                <section className="modal-card">
                  <h3>Evolution</h3>
                  <div className="evo-line">
                    {/* prevo/evos are display names, not the ids the dex is keyed by. */}
                    {mon.prevo && merged?.[toId(mon.prevo)] && (
                      <EvoStep id={toId(mon.prevo)} mon={merged[toId(mon.prevo)]} />
                    )}
                    <EvoStep id={openId} mon={mon} current />
                    {mon.evos?.map((e) => merged?.[toId(e)] && (
                      <EvoStep key={e} id={toId(e)} mon={merged[toId(e)]} />
                    ))}
                  </div>
                </section>
              )}

              {commonSetMoves.length > 0 && moves && (
                <section className="modal-card">
                  <h3>Most-used Set</h3>
                  <ul className="set-moves">
                    {commonSetMoves.map((m) => moves[m] && (
                      <li key={m}>
                        <TypeChip type={moves[m].type} />
                        <span>{moves[m].name}</span>
                        <em>{moves[m].basePower > 0 ? `${moves[m].basePower} BP` : moves[m].category}</em>
                      </li>
                    ))}
                  </ul>
                  <p className="modal-hint">{sets?.[openId]?.format.replace(/^gen9/, 'Gen 9 ')}</p>
                </section>
              )}

              <section className="modal-card modal-wide">
                <h3>Moves</h3>
                {!allMoves ? <p className="loading">Loading moves…</p> : (
                  <>
                    <div className="move-controls">
                      <input
                        type="search" value={moveQuery}
                        onChange={(e) => setMoveQuery(e.target.value)}
                        placeholder="Search all moves…" aria-label="Search this Pokémon's moves"
                      />
                      <div className="move-tabs">
                        {MOVE_GROUPS.filter((g) => groupCounts[g.key]).map((g) => (
                          <button
                            key={g.key} type="button"
                            className={enabled.has(g.key) ? 'is-active' : ''}
                            aria-pressed={enabled.has(g.key)}
                            onClick={() => setEnabled((prev) => {
                              const next = new Set(prev)
                              if (next.has(g.key)) next.delete(g.key)
                              else next.add(g.key)
                              return next
                            })}
                          >
                            {g.label} <em>{groupCounts[g.key]}</em>
                          </button>
                        ))}
                      </div>
                      <span className="move-count">{visibleMoves.length} shown</span>
                    </div>
                    <div className="move-table-scroll">
                      <table className="move-table">
                        <thead>
                          <tr>
                            <th className="col-left">Move</th><th>Type</th><th>Cat</th>
                            <th>Pwr</th><th>Acc</th><th>PP</th>
                            <th className="col-left">Learned</th>
                            <th className="col-left">Effect</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleMoves.slice(0, rowLimit).map((row) => moves?.[row.move] && (
                            <MoveRow key={row.move} row={row} move={moves[row.move]} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!visibleMoves.length && (
                      <p className="modal-hint">
                        {enabled.size ? `Nothing matches “${moveQuery}”.` : 'Turn a group back on to see moves.'}
                      </p>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Memoised for the same reason the learned-moves grid is: the table mounts in
 * chunks, and without this each chunk re-renders every row already on screen,
 * so the last frames of a 234-move list stall.
 */
const MoveRow = memo(function MoveRow(
  { row, move }: { row: { move: string; groups: string[]; level: number | null }; move: Move },
) {
  return (
    <tr>
      <th scope="row" className="col-left">{move.name}</th>
      <td><TypeChip type={move.type} /></td>
      <td className="cat">{move.category.slice(0, 4)}</td>
      <td>{move.basePower || '—'}</td>
      <td>{move.accuracy === true ? '—' : `${move.accuracy}%`}</td>
      <td>{move.pp}</td>
      <td className="col-left learned">
        {row.groups.map((g) => (
          <span key={g} className="learn-tag">
            {g === 'level' && row.level !== null
              ? `Lv ${row.level}`
              : MOVE_GROUPS.find((x) => x.key === g)?.label}
          </span>
        ))}
      </td>
      <td className="col-left effect">{move.shortDesc}</td>
    </tr>
  )
})

function EvoStep({ id, mon, current }: { id: string; mon: LeaguePokemon; current?: boolean }) {
  const { open } = usePokemonModal()
  return (
    <button
      type="button"
      className={`evo-step${current ? ' is-current' : ''}`}
      onClick={() => open(id)}
      disabled={current}
    >
      <img src={spriteUrl(mon)} alt="" width={56} height={48} />
      <span>{mon.name}</span>
    </button>
  )
}

function genderLabel(mon: LeaguePokemon): string {
  if (mon.gender === 'N') return 'Genderless'
  if (mon.gender === 'M') return 'Male only'
  if (mon.gender === 'F') return 'Female only'
  if (mon.genderRatio) return `${Math.round(mon.genderRatio.M * 100)}% ♂ / ${Math.round(mon.genderRatio.F * 100)}% ♀`
  return '50% ♂ / 50% ♀'
}

export type { TypeName }
