import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { SpeedTiersBody } from './SpeedTiers'
import { SpeedFilter } from './SpeedFilter'
import {
  bareBuild, defaultSpeedFilter, speedFilterRows,
  type Rules, type SpeedBuild,
} from '../../lib/stats'
import { isMega, megaBaseId, type LeagueDex } from '../../data/league'
import type { Team, TeamEntry } from './TeamEditor'

/**
 * The forme a Mega starts the battle in, added to the side that holds it.
 *
 * A Mega is not on the field until it Megas, and until then it is running the
 * base forme's Speed — Aerodactyl at 130 before it is Aerodactyl-Mega at 150.
 * Reading the tiers without that row answers the wrong half of the turn.
 *
 * Skipped when the side already holds the base as a pick of its own: this
 * league drafts the two apart, so a roster can legitimately carry both.
 */
function withMegaBases(team: Team, dex: LeagueDex): { team: Team; added: string[] } {
  const held = new Set(team.members.map((m) => m.id))
  const extra: TeamEntry[] = []
  for (const m of team.members) {
    if (!isMega(m.pokemon)) continue
    const baseId = megaBaseId(m.pokemon)
    const base = baseId ? dex[baseId] : null
    if (!baseId || !base || held.has(baseId)) continue
    held.add(baseId)
    extra.push({ id: baseId, pokemon: base })
  }
  return {
    team: extra.length ? { ...team, members: [...team.members, ...extra] } : team,
    added: extra.map((e) => e.id),
  }
}

/**
 * The speed tiers panel — its state, its header controls and its body — as one
 * unit that any card can host.
 *
 * It lives here rather than inside a card because which card owns it depends on
 * the layout: beside the teams list when there is room for two columns, and as
 * a tab of the analysis card when there is not.
 */
export function useSpeedTiersPanel(teamOne: Team, teamTwo: Team, dex: LeagueDex, level: number): {
  actions: ReactNode
  body: ReactNode
  footnote: string
} {
  /*
   * Champions, and only Champions, for as long as that is what the season
   * plays. The tab was given a toggle and it was a toggle between the
   * league's rules and rules the league does not use — one of the two
   * settings was always wrong and neither was worth a control in the bar.
   *
   * Kept as a value rather than written through the file, because the
   * season after this one may not be Champions and the difference is one
   * line either way. The EV calculator keeps its toggle: asking "what
   * would this cost in EVs" is a question someone might have there.
   */
  const rules: Rules = 'champions'
  const one = useMemo(() => withMegaBases(teamOne, dex), [teamOne, dex])
  const two = useMemo(() => withMegaBases(teamTwo, dex), [teamTwo, dex])
  const preMega = useMemo(() => new Set([...one.added, ...two.added]), [one.added, two.added])

  const [selected, setSelected] = useState<string | null>(null)

  /*
   * How each one is built, under its own name.
   *
   * The filter this replaces switched spreads and abilities on for a whole
   * side at once, and every Pokémon then appeared at every combination —
   * six Pokémon with two spreads and an ability between them made twenty
   * rows, most of them about builds nobody was running. One row each, at
   * the build you give it.
   */
  const [builds, setBuilds] = useState<Record<string, SpeedBuild>>({})
  const buildOf = (id: string) => builds[id] ?? bareBuild()
  const setBuild = (id: string, next: Partial<SpeedBuild>) =>
    setBuilds((prev) => ({ ...prev, [id]: { ...(prev[id] ?? bareBuild()), ...next } }))
  const reset = () => setBuilds({})
  const touched = Object.keys(builds).length > 0

  /*
   * And the filter, which drives the chart column on the right and nothing
   * else. The two are not the same question: the builds say what these
   * twelve Pokémon are actually running, and the chart says what the
   * spreads anyone might run come to. Neither answers for the other, which
   * is why both are on the tab.
   */
  const both = useMemo(
    () => [...one.team.members, ...two.team.members],
    [one.team.members, two.team.members],
  )
  const rows = useMemo(() => speedFilterRows(both, rules), [both, rules])
  const [filterOne, setFilterOne] = useState<Set<string>>(() => defaultSpeedFilter(both, rules))
  const [filterTwo, setFilterTwo] = useState<Set<string>>(() => defaultSpeedFilter(both, rules))

  // A roster change can add or remove ability rows, so the defaults are
  // recomputed rather than left pointing at abilities nobody has any more.
  useEffect(() => {
    setFilterOne(defaultSpeedFilter(both, rules))
    setFilterTwo(defaultSpeedFilter(both, rules))
  }, [both, rules])

  const setFilter = (side: 'one' | 'two', key: string, on: boolean) => {
    const apply = (prev: Set<string>) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    }
    if (side === 'one') setFilterOne(apply)
    else setFilterTwo(apply)
  }

  const resetFilter = () => {
    setFilterOne(defaultSpeedFilter(both, rules))
    setFilterTwo(defaultSpeedFilter(both, rules))
  }

  return {
    // The bar keeps only what governs the whole tab. The filter governs one
    // column, so it travels with it.
    actions: touched ? (
      <button type="button" onClick={reset}>Reset speeds</button>
    ) : null,
    body: (
      <SpeedTiersBody
        teamOne={one.team} teamTwo={two.team} preMega={preMega}
        level={level} rules={rules}
        filterOne={filterOne} filterTwo={filterTwo}
        filter={(
          <SpeedFilter
            rows={rows}
            oneName={teamOne.name || 'Team 1'}
            twoName={teamTwo.name || 'Team 2'}
            filterOne={filterOne} filterTwo={filterTwo}
            onChange={setFilter} onReset={resetFilter}
          />
        )}
        buildOf={buildOf} onBuild={setBuild}
        selected={selected} onSelect={setSelected}
      />
    ),
    footnote: selected
      ? 'Click again to clear the selection.'
      : 'Click a Pokémon to trace it through the tiers.',
  }
}
