import { useMemo, useState } from 'react'
import { spriteUrl } from '../../data/load'
import type { LearnsetDex, MoveDex, TypeName } from '../../data/types'
import { MOVE_TAGS, tagsFor, type MoveTag } from '../../lib/matchup'
import { TypeChip } from '../../components/TypeChip'
import type { Team } from './TeamEditor'

interface Props {
  team: Team
  moves: MoveDex
  learnsets: LearnsetDex
}

interface Row {
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
export function LearnedMovesBody({ team, moves, learnsets }: Props) {
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<Set<MoveTag>>(new Set())

  const rows = useMemo<Row[]>(() => {
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
  }, [team.members, moves, learnsets])

  const byId = useMemo(
    () => Object.fromEntries(team.members.map((m) => [m.id, m.pokemon])),
    [team.members],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (activeTags.size && !r.tags.some((t) => activeTags.has(t))) return false
      if (!q) return true
      return r.name.toLowerCase().includes(q) || r.type.toLowerCase() === q
        || r.category.toLowerCase() === q
    })
  }, [rows, query, activeTags])

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
        {visible.map((r) => (
          <li key={r.id} className="move-card">
            <div className="move-head">
              <span className="move-name">{r.name}</span>
              <TypeChip type={r.type} />
            </div>
            <div className="move-meta">
              <span>{r.category}</span>
              {r.basePower > 0 && <span>{r.basePower} BP</span>}
            </div>
            {r.tags.length > 0 && (
              <div className="move-tags">{r.tags.map((t) => <span key={t}>{t}</span>)}</div>
            )}
            <div className="move-learners">
              {r.learners.map((id) => (
                <img key={id} src={spriteUrl(byId[id])} alt="" title={byId[id]?.name} width={34} height={28} />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {!visible.length && <p className="widget-note">No moves match those filters.</p>}
    </>
  )
}
