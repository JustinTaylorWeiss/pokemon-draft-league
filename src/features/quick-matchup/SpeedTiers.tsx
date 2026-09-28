import { Fragment, useMemo } from 'react'
import {
  speedRows, speedOf, speedAbility, statAtLevel, RULES,
  type Rules, type SpeedBuild,
} from '../../lib/stats'
import type { Team, TeamEntry } from './TeamEditor'
import { Sprite } from '../../components/Sprite'

interface Props {
  teamOne: Team
  teamTwo: Team
  /** 50 for VGC, 100 for singles ladders. */
  level: number
  /** Ids on the chart only as the forme a Mega starts in, named so on hover. */
  preMega: Set<string>
  /** Which numbers the spreads are spent in. */
  rules: Rules
  /** How one Pokémon is built, and how to change it. */
  buildOf: (id: string) => SpeedBuild
  onBuild: (id: string, next: Partial<SpeedBuild>) => void
  selected: string | null
  onSelect: (id: string | null) => void
}

/**
 * Both teams' speeds interleaved in one ranked list, which is the only way to
 * see who actually outruns whom.
 *
 * The left column is the controls: every Pokémon on either side with the four
 * things that decide its Speed — nature, what is spent in the stat, a Choice
 * Scarf, and its own ability where it has one that matters. It carries no
 * number of its own, deliberately; the numbers it produces are the three
 * columns to its right, and the point of the tab is watching them move.
 *
 * Those three are the build as set, the ceiling it could reach, and then the
 * interleaved ranking. The first two share a grid with the controls so each
 * Pokémon's row reads straight across; the ranking re-sorts as you go, so it
 * stands apart.
 *
 * Selection and the builds live in the parent so the shared card header can own
 * them while this renders only the body.
 */
export function SpeedTiersBody({
  teamOne, teamTwo, preMega, level, rules, buildOf, onBuild, selected, onSelect,
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

  /*
   * The controls list is ordered by base Speed and stays there. It is the
   * one place on the tab you go to change something, and a row that slid
   * out from under the pointer as you dragged its own slider would be
   * unusable — the ranking on the right is where the reordering belongs.
   */
  const bases = useMemo(() => {
    const seen = new Map<string, TeamEntry>()
    for (const m of [...teamOne.members, ...teamTwo.members]) if (!seen.has(m.id)) seen.set(m.id, m)
    return [...seen.values()].sort((a, b) => b.pokemon.baseStats.spe - a.pokemon.baseStats.spe)
  }, [teamOne.members, teamTwo.members])

  if (!bases.length) return null

  const ranked = speedRows(
    bases.map((b) => ({ id: b.id, pokemon: b.pokemon, build: buildOf(b.id) })),
    level, rules,
  )

  const toggle = (id: string) => onSelect(selected === id ? null : id)
  /** The only place it is said: why an undrafted forme is on the chart. */
  const title = (id: string, name: string) =>
    preMega.has(id) ? `${name} — before it Mega Evolves` : name
  const rowClass = (id: string) =>
    `side-${side.get(id)}${selected === id ? ' is-selected' : selected ? ' is-dimmed' : ''}`

  return (
    <div className="speed-layout">
      <div className="speed-board">
        <h3>Build</h3>
        <h3 title={`As set on the left, at level ${level}`}>Lv {level}</h3>
        <h3 title={`${most} ${unit}${hasIvs ? ', 31 IVs' : ''}, a positive nature, at level ${level}`}>
          Max <span>{unit} + Nature</span>
        </h3>

        {bases.map((b) => {
          const build = buildOf(b.id)
          const ability = speedAbility(b.pokemon)
          /* Clicking the one already on puts the nature back to neutral. */
          const bend = (to: number) => onBuild(b.id, { nature: build.nature === to ? 1 : to })
          return (
            <Fragment key={b.id}>
              <div className={`speed-build ${rowClass(b.id)}`}>
                <button
                  type="button" className="speed-who"
                  onClick={() => toggle(b.id)} title={title(b.id, b.pokemon.name)}
                >
                  <Sprite pokemon={b.pokemon} width={32} height={26} />
                  <span>{b.pokemon.name}</span>
                </button>

                <div className="speed-knobs">
                  <div className="speed-nature">
                    <button
                      type="button" className={build.nature < 1 ? 'is-on' : undefined}
                      aria-pressed={build.nature < 1} title="Negative nature"
                      onClick={() => bend(0.9)}
                    >
                      &minus;
                    </button>
                    <button
                      type="button" className={build.nature > 1 ? 'is-on' : undefined}
                      aria-pressed={build.nature > 1} title="Positive nature"
                      onClick={() => bend(1.1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button" className={`speed-flag${build.scarf ? ' is-on' : ''}`}
                    aria-pressed={build.scarf}
                    onClick={() => onBuild(b.id, { scarf: !build.scarf })}
                  >
                    Scarf
                  </button>
                  {ability && (
                    <button
                      type="button" className={`speed-flag${build.ability ? ' is-on' : ''}`}
                      aria-pressed={build.ability}
                      onClick={() => onBuild(b.id, { ability: !build.ability })}
                    >
                      {ability}
                    </button>
                  )}

                  <div className="speed-slider">
                    <input
                      type="range" min={0} max={most} step={RULES[rules].step}
                      value={build.ev}
                      aria-label={`${b.pokemon.name} Speed ${unit}`}
                      onChange={(e) => onBuild(b.id, { ev: Number(e.target.value) })}
                    />
                    <span>{build.ev} {unit}</span>
                  </div>
                </div>
              </div>

              <div className={`speed-num ${rowClass(b.id)}`}>
                <strong>{speedOf(b.pokemon, build, level, rules)}</strong>
              </div>
              <div className={`speed-num ${rowClass(b.id)}`}>
                <strong>{statAtLevel(b.pokemon.baseStats.spe, most, 1.1, false, 31, level, rules)}</strong>
              </div>
            </Fragment>
          )
        })}
      </div>

      <div className="speed-groups">
        <h3>Lv {level} Tiers</h3>
        <ul>
          {ranked.map((t) => (
            <li key={t.id} className={rowClass(t.id)}>
              <button type="button" onClick={() => toggle(t.id)} title={title(t.id, t.pokemon.name)}>
                <Sprite pokemon={t.pokemon} width={32} height={26} />
                {t.investment !== '0' && <span className="badge">{t.investment}</span>}
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
