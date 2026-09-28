import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { SpeedTiersBody } from './SpeedTiers'
import { SpeedFilter } from './SpeedFilter'
import { defaultSpeedFilter, speedFilterRows, RULES, type Rules,
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
   * Which numbers the spreads are named in. Champions spends 32 SP where
   * Gen 9 spends 252 EVs, and has no IVs to drop for a minimum-Speed row.
   */
  const [rules, setRules] = useState<Rules>('champions')
  const one = useMemo(() => withMegaBases(teamOne, dex), [teamOne, dex])
  const two = useMemo(() => withMegaBases(teamTwo, dex), [teamTwo, dex])
  const preMega = useMemo(() => new Set([...one.added, ...two.added]), [one.added, two.added])

  const [selected, setSelected] = useState<string | null>(null)

  // Both the row list and the defaults come off the combined roster, so the two
  // columns start symmetric the way DraftZone's do.
  const both = useMemo(
    () => [...one.team.members, ...two.team.members],
    [one.team.members, two.team.members],
  )
  // Which rows the filter offers depends on the rosters: the spreads and stages
  // are fixed, but an ability row only appears if someone actually has it.
  const rows = useMemo(() => speedFilterRows(both, rules), [both, rules])
  const [filterOne, setFilterOne] = useState<Set<string>>(() => defaultSpeedFilter(both, rules))
  const [filterTwo, setFilterTwo] = useState<Set<string>>(() => defaultSpeedFilter(both, rules))

  // A roster change can add or remove ability rows, so the defaults are
  // recomputed rather than left pointing at abilities nobody has any more.
  // A roster change, or a change of rules — the spread rows are named for
  // the numbers being spent, so the old keys stop matching anything.
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

  const reset = () => {
    setFilterOne(defaultSpeedFilter(both, rules))
    setFilterTwo(defaultSpeedFilter(both, rules))
  }

  return {
    actions: (
      <>
        {/* The same choice the EV calculator offers, in the bar rather
            than over the columns: this tab has no field row to put it in. */}
        {(['champions', 'gen9'] as const).map((r) => (
          <button
            key={r}
            type="button"
            className="pill-toggle"
            aria-pressed={rules === r}
            title={`${RULES[r].budget} ${RULES[r].unit}, ${RULES[r].max} to a stat`}
            onClick={() => setRules(r)}
          >
            {RULES[r].label}
          </button>
        ))}
        <SpeedFilter
        rows={rows}
        oneName={teamOne.name || 'Team 1'}
        twoName={teamTwo.name || 'Team 2'}
        filterOne={filterOne} filterTwo={filterTwo}
          onChange={setFilter} onReset={reset}
        />
      </>
    ),
    body: (
      <SpeedTiersBody
        teamOne={one.team} teamTwo={two.team} preMega={preMega}
        filterOne={filterOne} filterTwo={filterTwo} level={level} rules={rules}
        selected={selected} onSelect={setSelected}
      />
    ),
    footnote: selected
      ? 'Click again to clear the selection.'
      : 'Click a Pokémon to trace it through the tiers.',
  }
}
