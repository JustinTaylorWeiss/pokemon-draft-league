import { useMemo } from 'react'
import {
  speedRows, speedTiers, speedOf, speedAbility, RULES,
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
  /** Enabled filter rows per side, for the chart column on the right. */
  filterOne: Set<string>
  filterTwo: Set<string>
  /** How one Pokémon is built, and how to change it. */
  buildOf: (id: string) => SpeedBuild
  onBuild: (id: string, next: Partial<SpeedBuild>) => void
  selected: string | null
  onSelect: (id: string | null) => void
}

/** A Pokémon on its own side's column, under the build it has been given. */
function BuildRow({
  entry, side, build, onBuild, level, rules, klass, title, onSelect,
}: {
  entry: TeamEntry
  side: 'one' | 'two'
  build: SpeedBuild
  onBuild: (id: string, next: Partial<SpeedBuild>) => void
  level: number
  rules: Rules
  klass: string
  title: string
  onSelect: () => void
}) {
  const ability = speedAbility(entry.pokemon)
  /* Clicking the one already on puts the nature back to neutral. */
  const bend = (to: number) => onBuild(entry.id, { nature: build.nature === to ? 1 : to })

  return (
    <li className={`speed-build side-${side} ${klass}`}>
      <button type="button" className="speed-who" onClick={onSelect} title={title}>
        <Sprite pokemon={entry.pokemon} width={32} height={26} />
        <span>{entry.pokemon.name}</span>
        <strong>{speedOf(entry.pokemon, build, level, rules)}</strong>
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
          onClick={() => onBuild(entry.id, { scarf: !build.scarf })}
        >
          Scarf
        </button>
        <button
          type="button" className={`speed-flag${build.tailwind ? ' is-on' : ''}`}
          aria-pressed={build.tailwind}
          onClick={() => onBuild(entry.id, { tailwind: !build.tailwind })}
        >
          Tailwind
        </button>
        {ability && (
          <button
            type="button" className={`speed-flag${build.ability ? ' is-on' : ''}`}
            aria-pressed={build.ability}
            onClick={() => onBuild(entry.id, { ability: !build.ability })}
          >
            {ability}
          </button>
        )}

        <div className="speed-slider">
          <input
            type="range" min={0} max={RULES[rules].max} step={RULES[rules].step}
            value={build.ev}
            aria-label={`${entry.pokemon.name} Speed ${RULES[rules].unit}`}
            onChange={(e) => onBuild(entry.id, { ev: Number(e.target.value) })}
          />
          <span>{build.ev} {RULES[rules].unit}</span>
        </div>
      </div>
    </li>
  )
}

/**
 * Who outruns whom, in four columns.
 *
 * The two on the left are the teams, one each, and they are where the tab is
 * driven from: every Pokémon on that side with its nature, what is in the
 * stat, a Choice Scarf and its own ability where it has one that matters —
 * and, beside its name, what all of that comes to.
 *
 * The two on the right are those Pokémon ranked against each other, which is
 * the only way to read a matchup. One runs at the builds as set and moves as
 * you work; one runs at full investment and nothing else, and never moves.
 * The fixed one is the chart everyone already knows, and having it beside the
 * live one is what makes the live one legible — a Pokémon four places higher
 * than it sits there has been bought those four places.
 *
 * Selection and the builds live in the parent so the shared card header can own
 * them while this renders only the body.
 */
export function SpeedTiersBody({
  teamOne, teamTwo, preMega, level, rules, filterOne, filterTwo,
  buildOf, onBuild, selected, onSelect,
}: Props) {

  const side = useMemo(() => {
    const map = new Map<string, 'one' | 'two'>()
    for (const m of teamOne.members) map.set(m.id, 'one')
    for (const m of teamTwo.members) if (!map.has(m.id)) map.set(m.id, 'two')
    return map
  }, [teamOne.members, teamTwo.members])

  /*
   * Each side in base-Speed order, and it stays there. A team column is the
   * one place you go to change something, and a row that slid out from under
   * the pointer as you dragged its own slider would be unusable — the two
   * columns on the right are where reordering belongs.
   */
  const order = (team: Team) =>
    [...team.members].sort((a, b) => b.pokemon.baseStats.spe - a.pokemon.baseStats.spe)
  const sides: { key: 'one' | 'two'; name: string; members: TeamEntry[] }[] = [
    { key: 'one', name: teamOne.name || 'Team 1', members: order(teamOne) },
    { key: 'two', name: teamTwo.name || 'Team 2', members: order(teamTwo) },
  ]

  /** One of each, however many sides hold it: a ranking counts a Pokémon once. */
  const everyone = useMemo(() => {
    const seen = new Map<string, TeamEntry>()
    for (const m of [...teamOne.members, ...teamTwo.members]) if (!seen.has(m.id)) seen.set(m.id, m)
    return [...seen.values()]
  }, [teamOne.members, teamTwo.members])

  if (!everyone.length) return null

  const live = speedRows(
    everyone.map((e) => ({ id: e.id, pokemon: e.pokemon, build: buildOf(e.id) })),
    level, rules,
  )
  /*
   * The chart, untouched by anything on the left: every spread, stage and
   * multiplier the filter has switched on for that Pokémon's side, one row
   * per combination. It is the reference the live column is read against,
   * and it moves only when the filter does.
   */
  const chart = speedTiers([
    ...teamOne.members.map((m) => ({ ...m, enabled: filterOne })),
    ...teamTwo.members.map((m) => ({ ...m, enabled: filterTwo })),
  ], level, rules)

  const toggle = (id: string) => onSelect(selected === id ? null : id)
  /** The only place it is said: why an undrafted forme is on the chart. */
  const title = (id: string, name: string) =>
    preMega.has(id) ? `${name} — before it Mega Evolves` : name
  const rowClass = (id: string) =>
    selected === id ? 'is-selected' : selected ? 'is-dimmed' : ''

  const ranking = (heading: string, hint: string, rows: ReturnType<typeof speedRows>) => (
    <div className="speed-groups">
      <h3 title={hint}>{heading}</h3>
      <ul>
        {rows.map((t, i) => (
          <li
            key={`${t.id}-${t.investment}-${t.stage ?? ''}-${t.modifiers.join()}-${i}`}
            className={`side-${side.get(t.id)} ${rowClass(t.id)}`}
          >
            <button type="button" onClick={() => toggle(t.id)} title={title(t.id, t.pokemon.name)}>
              <Sprite pokemon={t.pokemon} width={32} height={26} />
              {t.investment !== '0' && <span className="badge">{t.investment}</span>}
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
  )

  return (
    <div className="speed-layout">
      {sides.map((s) => (
        <div className={`speed-side side-${s.key}`} key={s.key}>
          <h3>{s.name}</h3>
          <ul>
            {s.members.map((m) => (
              <BuildRow
                key={m.id} entry={m} side={s.key} build={buildOf(m.id)} onBuild={onBuild}
                level={level} rules={rules} klass={rowClass(m.id)}
                title={title(m.id, m.pokemon.name)} onSelect={() => toggle(m.id)}
              />
            ))}
          </ul>
        </div>
      ))}

      {ranking(`Lv ${level} Tiers`, 'Every Pokémon at the builds set on the left', live)}
      {ranking(
        'Chart',
        'Every spread and multiplier the filter has switched on, whatever the builds say',
        chart,
      )}
    </div>
  )
}
