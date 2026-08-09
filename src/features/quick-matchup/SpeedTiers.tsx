import { useMemo } from 'react'
import { spriteUrl } from '../../data/load'
import { speedTiers } from '../../lib/stats'
import type { Team, TeamEntry } from './TeamEditor'

interface Props {
  teamOne: Team
  teamTwo: Team
  showZero: boolean
  selected: string | null
  onSelect: (id: string | null) => void
}

/**
 * Both teams' speeds interleaved in one ranked list, which is the only way to
 * see who actually outruns whom. Each Pokémon appears once per investment
 * spread it could plausibly run.
 *
 * Selection and the Uninvested toggle live in the parent so the shared card
 * header can own them while this renders only the body.
 */
export function SpeedTiersBody({ teamOne, teamTwo, showZero, selected, onSelect }: Props) {

  const side = useMemo(() => {
    const map = new Map<string, 'one' | 'two'>()
    for (const m of teamOne.members) map.set(m.id, 'one')
    for (const m of teamTwo.members) if (!map.has(m.id)) map.set(m.id, 'two')
    return map
  }, [teamOne.members, teamTwo.members])

  const all = useMemo(() => {
    const entries = [...teamOne.members, ...teamTwo.members]
    return speedTiers(entries).filter((t) => showZero || t.investment !== '0')
  }, [teamOne.members, teamTwo.members, showZero])

  const bases = useMemo(() => {
    const seen = new Map<string, TeamEntry>()
    for (const m of [...teamOne.members, ...teamTwo.members]) if (!seen.has(m.id)) seen.set(m.id, m)
    return [...seen.values()].sort((a, b) => b.pokemon.baseStats.spe - a.pokemon.baseStats.spe)
  }, [teamOne.members, teamTwo.members])

  if (!all.length) return null

  const toggle = (id: string) => onSelect(selected === id ? null : id)
  const rowClass = (id: string) =>
    `side-${side.get(id)}${selected === id ? ' is-selected' : selected ? ' is-dimmed' : ''}`

  return (
    <div className="speed-layout">
        <div className="speed-bases">
          <h3>Base</h3>
          <ul>
            {bases.map((b) => (
              <li key={b.id} className={rowClass(b.id)}>
                <button type="button" onClick={() => toggle(b.id)} title={b.pokemon.name}>
                  <strong>{b.pokemon.baseStats.spe}</strong>
                  <img src={spriteUrl(b.pokemon)} alt={b.pokemon.name} width={32} height={26} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="speed-groups">
          <h3>Tiers <span>Lv 100</span></h3>
          <ul>
            {all.map((t, i) => (
              <li key={`${t.id}-${t.investment}-${t.ability ?? ''}-${i}`} className={rowClass(t.id)}>
                <button type="button" onClick={() => toggle(t.id)} title={t.pokemon.name}>
                  <img src={spriteUrl(t.pokemon)} alt={t.pokemon.name} width={32} height={26} />
                  <span className="badge">{t.investment}</span>
                  {t.ability && <span className="badge badge-ability">{t.ability}</span>}
                  <strong>{t.speed}</strong>
                </button>
              </li>
            ))}
          </ul>
      </div>
    </div>
  )
}
