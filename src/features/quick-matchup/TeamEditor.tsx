import { useMemo, useRef, useState } from 'react'
import type { Pokemon, PokemonDex } from '../../data/types'
import { spriteUrl } from '../../data/load'

export interface TeamEntry {
  id: string
  pokemon: Pokemon
}

export interface Team {
  name: string
  members: TeamEntry[]
}

interface Props {
  dex: PokemonDex
  team: Team
  onChange: (team: Team) => void
  accent: 'one' | 'two'
}

const MAX_SUGGESTIONS = 8

export function TeamEditor({ dex, team, onChange, accent }: Props) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!q) return []
    const taken = new Set(team.members.map((m) => m.id))
    const scored: { id: string; pokemon: Pokemon; rank: number }[] = []
    for (const [id, pokemon] of Object.entries(dex)) {
      if (taken.has(id)) continue
      const idx = id.indexOf(q)
      if (idx === -1) continue
      // Prefix matches first, then shorter names, so "great" finds Great Tusk.
      scored.push({ id, pokemon, rank: idx * 100 + id.length })
    }
    return scored.sort((a, b) => a.rank - b.rank).slice(0, MAX_SUGGESTIONS)
  }, [query, dex, team.members])

  const add = (id: string, pokemon: Pokemon) => {
    onChange({ ...team, members: [...team.members, { id, pokemon }] })
    setQuery('')
    setHighlight(0)
    inputRef.current?.focus()
  }

  const remove = (id: string) =>
    onChange({ ...team, members: team.members.filter((m) => m.id !== id) })

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!suggestions.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % suggestions.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = suggestions[highlight]
      if (pick) add(pick.id, pick.pokemon)
    } else if (e.key === 'Escape') setQuery('')
  }

  /**
   * Accepts a Showdown paste or a plain newline/comma list. Matching is done on
   * the same normalized id the dex is keyed by, so "Slowking-Galar" and
   * "slowkinggalar" both resolve.
   */
  const importList = (text: string) => {
    const taken = new Set(team.members.map((m) => m.id))
    const added: TeamEntry[] = []
    for (const rawLine of text.split(/[\n,]/)) {
      // Strip Showdown decorations: nickname parens, held item, gender.
      const line = rawLine.split('@')[0].replace(/\(([MF])\)/g, '').trim()
      if (!line || /^[-+]/.test(line)) continue
      const paren = line.match(/\(([^)]+)\)/)
      const candidate = paren ? paren[1] : line
      const key = candidate.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!key || taken.has(key) || !dex[key]) continue
      taken.add(key)
      added.push({ id: key, pokemon: dex[key] })
    }
    if (added.length) onChange({ ...team, members: [...team.members, ...added] })
    return added.length
  }

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  return (
    <div className={`team-editor accent-${accent}`}>
      <div className="team-editor-row">
        <label className="field">
          <span>Team Name</span>
          <input
            value={team.name}
            onChange={(e) => onChange({ ...team, name: e.target.value })}
            placeholder="Team Name"
          />
        </label>
        <button type="button" className="btn ghost" onClick={() => setImportOpen((v) => !v)}>
          Import
        </button>
      </div>

      {importOpen && (
        <div className="import-box">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'Paste a team — one Pokémon per line, or a Showdown export.'}
            rows={5}
          />
          <div className="import-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                const n = importList(importText)
                if (n) { setImportText(''); setImportOpen(false) }
              }}
            >
              Add {importText.trim() ? '' : 'Pokémon'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setImportOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="autocomplete">
        <label className="field">
          <span>Add Pokémon</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0) }}
            onKeyDown={onKeyDown}
            placeholder="Add Pokémon"
            autoComplete="off"
          />
        </label>
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={i === highlight ? 'is-active' : ''}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => add(s.id, s.pokemon)}
                >
                  <img src={spriteUrl(s.pokemon)} alt="" width={40} height={30} />
                  <span>{s.pokemon.name}</span>
                  {s.pokemon.tier && <em>{s.pokemon.tier}</em>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="roster">
        {team.members.map((m) => (
          <li key={m.id}>
            <img src={spriteUrl(m.pokemon)} alt="" width={48} height={40} />
            <span className="roster-name">{m.pokemon.name}</span>
            <span className="roster-bst">{m.pokemon.bst}</span>
            <button type="button" className="icon-btn" onClick={() => remove(m.id)} aria-label={`Remove ${m.pokemon.name}`}>
              ✕
            </button>
          </li>
        ))}
        {!team.members.length && <li className="roster-empty">No Pokémon yet.</li>}
      </ul>
    </div>
  )
}
