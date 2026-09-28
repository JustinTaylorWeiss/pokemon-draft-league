import { useMemo } from 'react'
import { speedTiers, statAtLevel, RULES, type Rules } from '../../lib/stats'
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
  /** Which numbers the spreads are spent in. */
  rules: Rules
  selected: string | null
  onSelect: (id: string | null) => void
}

/**
 * Both teams' speeds interleaved in one ranked list, which is the only way to
 * see who actually outruns whom. Each Pokémon appears once per spread and
 * multiplier combination its side has switched on.
 *
 * Five columns: the base stat, then what it is at this level on IVs alone,
 * with max EVs on top, and with a positive nature on top of that — and then
 * every tier the filters allow.
 *
 * Selection and the filter live in the parent so the shared card header can own
 * them while this renders only the body.
 */
export function SpeedTiersBody({
  teamOne, teamTwo, preMega, filterOne, filterTwo, level, rules, selected, onSelect,
}: Props) {
  const most = RULES[rules].max
  const unit = RULES[rules].unit
  const hasIvs = RULES[rules].ivs

  const side = useMemo(() => {
    const map = new Map<string, 'one' | 'two'>()
    for (const m of teamOne.members) map.set(m.id, 'one')
    for (const m of teamTwo.members) if (!map.has(m.id)) map.set(m.id, 'two')
    return map
  }, [teamOne.members, teamTwo.members])

  const all = useMemo(() => speedTiers([
    ...teamOne.members.map((m) => ({ ...m, enabled: filterOne })),
    ...teamTwo.members.map((m) => ({ ...m, enabled: filterTwo })),
  ], level, rules), [teamOne.members, teamTwo.members, filterOne, filterTwo, level, rules])

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
          * The same Pokemon's Speed with one more thing added each time:
          * nothing spent, then everything in the stat, then a positive
          * nature on top of that. Each heading spells out what is in it,
          * because a column of Speeds is worthless if you have to remember
          * which spread it belongs to — and four of them side by side is
          * exactly the arithmetic a draft argument runs on.
          *
          * Named in whichever numbers are being spent: Gen 9's columns say
          * IVs and EVs, and Champions' say SP and mention no IVs, having
          * none. The first column is the untrained Speed either way.
          *
          * All of them run in Base's order, since each is a function of it,
          * so a row reads straight across.
          */}
        <div className="speed-level">
          <h3 title={hasIvs
            ? `31 IVs, no EVs, neutral nature, at level ${level}`
            : `Nothing spent, neutral nature, at level ${level}`}
          >
            Lv {level}{hasIvs && <span>+ IVs</span>}
          </h3>
          <ul>
            {bases.map((b) => (
              <li key={b.id} className={rowClass(b.id)}>
                <button type="button" onClick={() => toggle(b.id)} title={title(b.id, b.pokemon.name)}>
                  <strong>{statAtLevel(b.pokemon.baseStats.spe, 0, 1, false, 31, level, rules)}</strong>
                  <Sprite pokemon={b.pokemon} width={32} height={26} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="speed-evs">
          <h3 title={`${most} ${unit}${hasIvs ? ', 31 IVs' : ''}, neutral nature, at level ${level}`}>
            Lv {level} <span>{hasIvs && '+ IVs '}+ Max {unit}</span>
          </h3>
          <ul>
            {bases.map((b) => (
              <li key={b.id} className={rowClass(b.id)}>
                <button type="button" onClick={() => toggle(b.id)} title={title(b.id, b.pokemon.name)}>
                  <strong>{statAtLevel(b.pokemon.baseStats.spe, most, 1, false, 31, level, rules)}</strong>
                  <Sprite pokemon={b.pokemon} width={32} height={26} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="speed-max">
          <h3 title={`${most} ${unit}${hasIvs ? ', 31 IVs' : ''}, a positive nature, at level ${level}`}>
            Lv {level} <span>{hasIvs && '+ IVs '}+ Max {unit} + Nature</span>
          </h3>
          <ul>
            {bases.map((b) => (
              <li key={b.id} className={rowClass(b.id)}>
                <button type="button" onClick={() => toggle(b.id)} title={title(b.id, b.pokemon.name)}>
                  <strong>{statAtLevel(b.pokemon.baseStats.spe, most, 1.1, false, 31, level, rules)}</strong>
                  <Sprite pokemon={b.pokemon} width={32} height={26} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="speed-groups">
          <h3>Lv {level} Tiers</h3>
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
