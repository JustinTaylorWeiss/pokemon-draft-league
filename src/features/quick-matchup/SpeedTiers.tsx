import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  speedRows, speedTiers, speedOf, speedAbility, stageLabel, SPEED_ITEMS, RULES,
  type Rules, type SpeedBuild, type SpeedItem,
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
  /** The control for those, which belongs over the column it governs. */
  filter: ReactNode
  /** Which ones are out of the rankings, and how to put one back. */
  hiddenOf: (id: string) => boolean
  onHide: (id: string) => void
  /** How one Pokémon is built, and how to change it. */
  buildOf: (id: string) => SpeedBuild
  onBuild: (id: string, next: Partial<SpeedBuild>) => void
  selected: string | null
  onSelect: (id: string | null) => void
}

/** +6 down to −6, listed the way a stat rises: the best is at the top. */
const STAGES = [6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6]

/** A Pokémon on its own side's column, under the build it has been given. */
function BuildRow({
  entry, side, build, onBuild, level, rules, klass, title, onSelect, hidden, onHide,
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
  hidden: boolean
  onHide: () => void
}) {
  const ability = speedAbility(entry.pokemon)
  /* Clicking the one already on puts the nature back to neutral. */
  const bend = (to: number) => onBuild(entry.id, { nature: build.nature === to ? 1 : to })

  return (
    <li className={`speed-build side-${side} ${klass}${hidden ? ' is-hidden' : ''}`}>
      {/*
        * The bar sits on the name line rather than down with the toggles:
        * what is in the stat is the thing you reach for first and the
        * thing the number beside it answers, so the two read together.
        * An input cannot live inside a button, which is why the name is
        * its own button in a row rather than the row itself.
        */}
      <div className="speed-top">
        <button type="button" className="speed-who" onClick={onSelect} title={title}>
          <Sprite pokemon={entry.pokemon} width={32} height={26} />
          <span>{entry.pokemon.name}</span>
        </button>
        <div className="speed-slider">
          <input
            type="range" min={0} max={RULES[rules].max} step={RULES[rules].step}
            value={build.ev}
            aria-label={`${entry.pokemon.name} Speed ${RULES[rules].unit}`}
            onChange={(e) => onBuild(entry.id, { ev: Number(e.target.value) })}
          />
          <span>{build.ev}<em>{RULES[rules].unit}</em></span>
        </div>
        <strong>{speedOf(entry.pokemon, build, level, rules)}</strong>
        {/* Up here rather than among the toggles: it is not one of them —
            they all change the number and this one decides whether to
            look at it — and the toggles want the whole of their line. */}
        <button
          type="button" className={`speed-flag speed-hide${hidden ? ' is-on' : ''}`}
          aria-pressed={hidden} onClick={onHide}
          title={hidden ? 'Put it back in the rankings' : 'Take it out of the rankings'}
        >
          Hide
        </button>
      </div>

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
        <select
          className={`speed-stage${build.stage ? ' is-on' : ''}`}
          value={build.stage} title="Boost stage"
          aria-label={`${entry.pokemon.name} Speed stage`}
          onChange={(e) => onBuild(entry.id, { stage: Number(e.target.value) })}
        >
          {STAGES.map((n) => (
            <option key={n} value={n}>{stageLabel(n) ?? '\u00b10'}</option>
          ))}
        </select>
        <select
          className={`speed-stage${build.item ? ' is-on' : ''}`}
          value={build.item} title="Held item"
          aria-label={`${entry.pokemon.name} held item`}
          onChange={(e) => onBuild(entry.id, { item: e.target.value as SpeedItem })}
        >
          {SPEED_ITEMS.map((i) => (
            <option key={i || 'none'} value={i}>{i === 'Choice Scarf' ? 'Scarf' : i || 'No item'}</option>
          ))}
        </select>
        <button
          type="button" className={`speed-flag${build.paralysis ? ' is-on' : ''}`}
          aria-pressed={build.paralysis} title="Paralysed"
          onClick={() => onBuild(entry.id, { paralysis: !build.paralysis })}
        >
          Para
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
  teamOne, teamTwo, preMega, level, rules, filterOne, filterTwo, filter,
  buildOf, onBuild, hiddenOf, onHide, selected, onSelect,
}: Props) {
  const most = RULES[rules].max

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
    team.members
      // A Mega's base forme is not a second pick and gets no second set of
      // controls; it is the Mega's own row, read before it Mega Evolves,
      // and it appears in the rankings on the Mega's build.
      .filter((m) => !preMega.has(m.id))
      .sort((a, b) => b.pokemon.baseStats.spe - a.pokemon.baseStats.spe)
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

  /* Hidden is about the Pokémon, not the build, so it empties out of
     both rankings — leaving it in one of them would only raise the
     question of why it was still there. */
  const shown = everyone.filter((e) => !hiddenOf(e.id))
  const live = speedRows(
    shown.map((e) => ({ id: e.id, pokemon: e.pokemon, build: buildOf(e.id) })),
    level, rules,
  )
  /*
   * The chart, untouched by anything on the left: every spread, stage and
   * multiplier the filter has switched on for that Pokémon's side, one row
   * per combination. It is the reference the live column is read against,
   * and it moves only when the filter does.
   */
  const chart = speedTiers([
    ...teamOne.members.filter((m) => !hiddenOf(m.id)).map((m) => ({ ...m, enabled: filterOne })),
    ...teamTwo.members.filter((m) => !hiddenOf(m.id)).map((m) => ({ ...m, enabled: filterTwo })),
  ], level, rules)

  const toggle = (id: string) => onSelect(selected === id ? null : id)
  /** The only place it is said: why an undrafted forme is on the chart. */
  const title = (id: string, name: string) =>
    preMega.has(id) ? `${name} — before it Mega Evolves` : name
  const rowClass = (id: string) =>
    selected === id ? 'is-selected' : selected ? 'is-dimmed' : ''

  /*
   * Nothing is in the stat until you put it there, which is the honest
   * default and a spread nobody runs — so the first thing anyone does is
   * drag six sliders to the end. One button, and the same button back,
   * since a bare team is the other thing worth being one click from.
   */
  const column = (s: { key: 'one' | 'two'; name: string; members: TeamEntry[] }) => {
    const full = s.members.length > 0 && s.members.every((m) => {
      const b = buildOf(m.id)
      return b.ev === most && b.nature > 1
    })
    const fill = () => {
      for (const m of s.members) {
        onBuild(m.id, full ? { ev: 0, nature: 1 } : { ev: most, nature: 1.1 })
      }
    }
    return (
      <div className={`speed-side side-${s.key}`} key={s.key}>
        <h3>
          <span>{s.name}</span>
          {s.members.length > 0 && (
            <button
              type="button" className={`speed-fill${full ? ' is-on' : ''}`}
              aria-pressed={full} onClick={fill}
              title={full
                ? 'Put the whole side back to nothing spent and a neutral nature'
                : `Give the whole side ${most} ${RULES[rules].unit} and a positive nature`}
            >
              Max all
            </button>
          )}
        </h3>
        <ul>
          {s.members.map((m) => (
            <BuildRow
              key={m.id} entry={m} side={s.key} build={buildOf(m.id)} onBuild={onBuild}
              level={level} rules={rules} klass={rowClass(m.id)}
              title={title(m.id, m.pokemon.name)} onSelect={() => toggle(m.id)}
              hidden={hiddenOf(m.id)} onHide={() => onHide(m.id)}
            />
          ))}
        </ul>
      </div>
    )
  }

  const ranking = (rows: ReturnType<typeof speedRows>, label?: string) => (
      <ul aria-label={label}>
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
  )

  return (
    <div className="speed-layout">
      {/*
        * One side, what the two of them come to, the other side. The
        * ranking is between the teams because that is what it is between:
        * every row in it came from a column to its left or its right, and
        * a Pokemon's own row is never more than one column away.
        */}
      <div className="speed-live">
        {column(sides[0])}

        <div className="speed-groups">
          {/* No heading: it sits between the two columns it is the sum of,
              which says what it is more plainly than a line of text over
              it did. The blank keeps its list level with theirs. */}
          <div className="speed-head-blank" aria-hidden="true" />
          {ranking(live, 'Both teams at the builds set either side')}
        </div>

        {column(sides[1])}
      </div>

      {/* And the chart, which the three on the left cannot reach. Its own
          control sits on it rather than in the bar, because the bar is
          where the things that govern the whole tab live and this governs
          one column. */}
      <div className="speed-chart speed-groups">
        <div className="speed-chart-head">
          <h3 title="Every spread and multiplier the filter has switched on, whatever the builds say">
            <span>Speed tiers</span>
          </h3>
          {filter}
        </div>
        {ranking(chart)}
      </div>
    </div>
  )
}
