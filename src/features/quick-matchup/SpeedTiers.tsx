import { useMemo, useState } from 'react'
import { spriteUrl } from '../../data/load'
import { speedTiers } from '../../lib/stats'
import type { Team, TeamEntry } from './TeamEditor'

interface Props {
  teamOne: Team
  teamTwo: Team
}

/**
 * Both teams' speeds interleaved in one ranked list, which is the only way to
 * see who actually outruns whom. Each Pokémon appears once per investment
 * spread it could plausibly run.
 */
export function SpeedTiers({ teamOne, teamTwo }: Props) {
  const [showZero, setShowZero] = useState(false)

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

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Speed Tiers</h2>
        <label className="toggle">
          <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
          <span>Show uninvested</span>
        </label>
      </header>

      <div className="speed-layout">
        <div className="speed-bases">
          <h3>Base Speed</h3>
          <ul>
            {bases.map((b) => (
              <li key={b.id} className={`side-${side.get(b.id)}`}>
                <strong>{b.pokemon.baseStats.spe}</strong>
                <img src={spriteUrl(b.pokemon)} alt={b.pokemon.name} title={b.pokemon.name} width={36} height={30} />
              </li>
            ))}
          </ul>
        </div>

        <div className="speed-groups">
          <h3>Speed Tier Groups <span>Lv 100</span></h3>
          <ul>
            {all.map((t, i) => (
              <li key={`${t.id}-${t.investment}-${t.ability ?? ''}-${i}`} className={`side-${side.get(t.id)}`}>
                <img src={spriteUrl(t.pokemon)} alt={t.pokemon.name} title={t.pokemon.name} width={36} height={30} />
                <span className="badge">{t.investment}</span>
                {t.ability && <span className="badge badge-ability">{t.ability}</span>}
                <strong>{t.speed}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
