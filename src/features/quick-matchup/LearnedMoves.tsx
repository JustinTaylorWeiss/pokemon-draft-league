import { memo, useMemo, useState } from 'react'
import type { LearnsetDex, MoveDex, Pokemon, TypeName } from '../../data/types'
import { MOVE_TAGS, tagsFor, type MoveTag } from '../../lib/matchup'
import { TypeChip } from '../../components/TypeChip'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { useProgressiveList } from '../../lib/useProgressiveList'
import { Sprite } from '../../components/Sprite'

interface Props {
  team: Team
  /** Built by the parent, which survives tab switches — see buildMoveRows. */
  rows: Row[]
  byId: Record<string, Pokemon>
}

export interface Row {
  id: string
  name: string
  type: TypeName
  category: string
  basePower: number
  tags: MoveTag[]
  learners: string[]
}

/**
 * Every move anyone on the team can learn, with the Pokémon that learn it.
 * Filtering by tag is how you answer "who has hazard control?" at a glance.
 */
/**
 * Every move anyone on the team can learn, joined to the Pokémon that learn it.
 *
 * Kept out of the component because this walks the whole team's learnsets, and
 * the component unmounts every time the card's tab changes — recomputing it on
 * each toggle is what made switching back to Learned Moves stall.
 */
export function buildMoveRows(team: Team, moves: MoveDex, learnsets: LearnsetDex): Row[] {
  const learners = new Map<string, string[]>()
  for (const m of team.members) {
    for (const moveId of Object.keys(learnsets[m.id] ?? {})) {
      if (!moves[moveId]) continue
      const list = learners.get(moveId)
      if (list) list.push(m.id)
      else learners.set(moveId, [m.id])
    }
  }
  return [...learners.entries()]
    .map(([id, who]) => {
      const mv = moves[id]
      return {
        id, name: mv.name, type: mv.type, category: mv.category,
        basePower: mv.basePower, tags: tagsFor(mv), learners: who,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function LearnedMovesBody({ team, rows, byId }: Props) {
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<Set<MoveTag>>(new Set())

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (activeTags.size && !r.tags.some((t) => activeTags.has(t))) return false
      if (!q) return true
      return r.name.toLowerCase().includes(q) || r.type.toLowerCase() === q
        || r.category.toLowerCase() === q
    })
  }, [rows, query, activeTags])

  // 300+ cards holding 800 sprites, so they mount over several frames.
  const limit = useProgressiveList(visible.length, team.name)

  const toggleTag = (t: MoveTag) =>
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  if (!team.members.length) return null

  return (
    <>
      <div className="moves-controls">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search move or type…" aria-label="Search moves"
        />
        <span className="count moves-count">{visible.length} of {rows.length}</span>
        <div className="tag-row">
          {MOVE_TAGS.map((t) => (
            <button
              key={t} type="button"
              className={`tag-btn${activeTags.has(t) ? ' is-active' : ''}`}
              onClick={() => toggleTag(t)}
            >
              {t}
            </button>
          ))}
          {activeTags.size > 0 && (
            <button type="button" className="tag-btn clear" onClick={() => setActiveTags(new Set())}>Clear</button>
          )}
        </div>
      </div>

      <ul className="move-grid">
        {visible.slice(0, limit).map((r) => <MoveCard key={r.id} row={r} byId={byId} />)}
      </ul>
      {!visible.length && <p className="widget-note">No moves match those filters.</p>}
    </>
  )
}

/**
 * Memoised because the grid mounts in chunks: without this, every chunk
 * re-renders each card already on screen, so the cost of finishing a 300-card
 * list grows with the square of its length and the final frames stall.
 * `row` and `byId` are both built in memos upstream, so the comparison holds.
 */
const MoveCard = memo(function MoveCard({ row, byId }: { row: Row; byId: Record<string, Pokemon> }) {
  return (
    <li className="move-card">
      <div className="move-head">
        <span className="move-name">{row.name}</span>
        <TypeChip type={row.type} />
      </div>
      <div className="move-meta">
        <span>{row.category}</span>
        {row.basePower > 0 && <span>{row.basePower} BP</span>}
      </div>
      {row.tags.length > 0 && (
        <div className="move-tags">{row.tags.map((t) => <span key={t}>{t}</span>)}</div>
      )}
      <div className="move-learners">
        {row.learners.map((id) => (
          <PokemonLink key={id} id={id} title={byId[id]?.name}>
            <Sprite pokemon={byId[id]} width={34} height={28} />
          </PokemonLink>
        ))}
      </div>
    </li>
  )
})
