import { useMemo } from 'react'
import { speedTiers, statAtLevel } from '../../lib/stats'
import type { Team, TeamEntry } from './TeamEditor'
import { Sprite } from '../../components/Sprite'

interface Props {
  teamOne: Team
  teamTwo: Team
  /** Enabled filter rows per side, so each team can be viewed under its own. */
  filterOne: Set<string>
  filterTwo: Set<string>
  /** 50 for VGC, 100 for singles ladders. */
  level: number
  /** Ids on the chart only as the forme a Mega starts in, named so on hover. */
  preMega: Set<string>
  selected: string | null
  onSelect: (id: string | null) => void
}

/**
 * Both teams' speeds interleaved in one ranked list, which is the only way to
 * see who actually outruns whom. Each Pokémon appears once per spread and
 * multiplier combination its side has switched on.
 *
 * Four columns: the base stat, what it is at this level on perfect IVs
 * alone, what it is fully invested, and then every tier the filters allow.
 *
 * Selection and the filter live in the parent so the shared card header can own
 * them while this renders only the body.
 */
export function SpeedTiersBody({ teamOne, teamTwo, preMega, filterOne, filterTwo, level, selected, onSelect }: Props) {

  const side = useMemo(() => {
    const map = new Map<string, 'one' | 'two'>()
    for (const m of teamOne.members) map.set(m.id, 'one')
    for (const m of teamTwo.members) if (!map.has(m.id)) map.set(m.id, 'two')
    return map
  }, [teamOne.members, teamTwo.members])

  const all = useMemo(() => speedTiers([
    ...teamOne.members.map((m) => ({ ...m, enabled: filterOne })),
    ...teamTwo.members.map((m) => ({ ...m, enabled: filterTwo })),
  ], level), [teamOne.members, teamTwo.members, filterOne, filterTwo, level])

  const bases = useMemo(() => {
    const seen = new Map<string, TeamEntry>()
    for (const m of [...teamOne.members, ...teamTwo.members]) if (!seen.has(m.id)) seen.set(m.id, m)
    return [...seen.values()].sort((a, b) => b.pokemon.baseStats.spe - a.pokemon.baseStats.spe)
  }, [teamOne.members, teamTwo.members])

  if (!all.length) return null

  const toggle = (id: string) => onSelect(selected === id ? null : id)
  /** The only place it is said: why an undrafted forme is on the chart. */
  const title = (id: string, name: string) =>
    preMega.has(id) ? `${name} — before it Mega Evolves` : name
  const rowClass = (id: string) =>
    `side-${side.get(id)}${selected === id ? ' is-selected' : selected ? ' is-dimmed' : ''}`

  return (
    <div className="speed-layout">
        <div className="speed-bases">
          <h3>Base</h3>
          <ul>
            {bases.map((b) => (
              <li key={b.id} className={rowClass(b.id)}>
                <button type="button" onClick={() => toggle(b.id)} title={title(b.id, b.pokemon.name)}>
                  <strong>{b.pokemon.baseStats.spe}</strong>
                  <Sprite pokemon={b.pokemon} width={32} height={26} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/*
          * Base, then what that is at this level with perfect IVs and nothing
          * else — no EVs, no nature — and then the fully invested figure.
          * Three points on the same line, which is what makes them worth
          * putting side by side.
          *
          * All three run in Base's order, since each is a function of it, so
          * a row reads straight across.
          */}
        <div className="speed-level">
          <h3 title={`31 IVs, no EVs, neutral nature, at level ${level}`}>
            Lv {level} <span className="is-inline">+ IVs</span>
          </h3>
          <ul>
            {bases.map((b) => (
              <li key={b.id} className={rowClass(b.id)}>
                <button type="button" onClick={() => toggle(b.id)} title={title(b.id, b.pokemon.name)}>
                  <strong>{statAtLevel(b.pokemon.baseStats.spe, 0, 1, false, 31, level)}</strong>
                  <Sprite pokemon={b.pokemon} width={32} height={26} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="speed-max">
          <h3>Max <span className="is-inline">Lv {level}</span></h3>
          <ul>
            {bases.map((b) => (
              <li key={b.id} className={rowClass(b.id)}>
                <button type="button" onClick={() => toggle(b.id)} title={title(b.id, b.pokemon.name)}>
                  <strong>{statAtLevel(b.pokemon.baseStats.spe, 252, 1.1, false, 31, level)}</strong>
                  <Sprite pokemon={b.pokemon} width={32} height={26} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="speed-groups">
          <h3>Tiers <span>Lv {level}</span></h3>
          <ul>
            {all.map((t, i) => (
              <li key={`${t.id}-${t.investment}-${t.stage ?? ''}-${t.modifiers.join()}-${i}`} className={rowClass(t.id)}>
                <button type="button" onClick={() => toggle(t.id)} title={title(t.id, t.pokemon.name)}>
                  <Sprite pokemon={t.pokemon} width={32} height={26} />
                  <span className="badge">{t.investment}</span>
                  {t.stage && <span className="badge badge-stage">{t.stage}</span>}
                  {t.modifiers.map((m) => (
                    <span key={m} className="badge badge-ability">{m}</span>
                  ))}
                  <strong>{t.speed}</strong>
                </button>
              </li>
            ))}
          </ul>
      </div>
    </div>
  )
}
