import { useMemo, useState } from 'react'
import { byId, playerLabel, type League, type LeagueDex } from '../../data/league'
import { Widget } from '../../components/Widget'
import { TeamEditor, type Team, type TeamEntry } from './TeamEditor'

type Side = 'one' | 'two'

interface Props {
  dex: LeagueDex
  league: League | null
  teamOne: Team
  teamTwo: Team
  setTeamOne: (t: Team) => void
  setTeamTwo: (t: Team) => void
  onDone: () => void
}

/** Which drafted rosters have been folded into each side, so they can be undone. */
type Sources = Record<Side, string[]>

export function MatchupBuilder({
  dex, league, teamOne, teamTwo, setTeamOne, setTeamTwo, onDone,
}: Props) {
  const [sources, setSources] = useState<Sources>({ one: [], two: [] })

  const team = (side: Side) => (side === 'one' ? teamOne : teamTwo)
  const setTeam = (side: Side) => (side === 'one' ? setTeamOne : setTeamTwo)

  const people = useMemo(() => (league ? byId(league.players) : {}), [league])
  const drafted = useMemo(
    () => league?.players.filter((p) => league.rosters[p.id]?.length) ?? [],
    [league],
  )

  const canAnalyze = teamOne.members.length > 0 && teamTwo.members.length > 0

  /** A scheduled match fills both sides at once and replaces whatever is there. */
  const loadScheduledMatch = (key: string) => {
    if (!league || !key) return
    const [week, idx] = key.split(':').map(Number)
    const match = league.schedule.filter((m) => m.week === week)[idx]
    if (!match) return
    const build = (ids: string[]): Team => {
      const seen = new Set<string>()
      const members: TeamEntry[] = []
      for (const pid of ids) {
        for (const pick of league.rosters[pid] ?? []) {
          if (seen.has(pick.pokemon) || !dex[pick.pokemon]) continue
          seen.add(pick.pokemon)
          members.push({ id: pick.pokemon, pokemon: dex[pick.pokemon] })
        }
      }
      return { name: ids.map((p) => people[p]?.name ?? p).join(' + '), members }
    }
    setTeamOne(build(match.a))
    setTeamTwo(build(match.b))
    setSources({ one: match.a, two: match.b })
  }

  /** Rosters accumulate, so a side can be several players pooled together. */
  const addRoster = (side: Side, playerId: string) => {
    if (!league || !playerId || sources[side].includes(playerId)) return
    const picks = league.rosters[playerId] ?? []
    const current = team(side)
    const seen = new Set(current.members.map((m) => m.id))
    const added = picks
      .filter((p) => dex[p.pokemon] && !seen.has(p.pokemon))
      .map((p) => ({ id: p.pokemon, pokemon: dex[p.pokemon] }))

    const nextSources = [...sources[side], playerId]
    setSources({ ...sources, [side]: nextSources })
    setTeam(side)({
      name: nextSources.map((p) => people[p]?.name ?? p).join(' + '),
      members: [...current.members, ...added],
    })
  }

  /**
   * Drops only the Pokémon this player brought that no other loaded roster on
   * this side also supplies, so removing one partner leaves the other intact.
   */
  const removeRoster = (side: Side, playerId: string) => {
    if (!league) return
    const remaining = sources[side].filter((p) => p !== playerId)
    const kept = new Set(remaining.flatMap((p) => (league.rosters[p] ?? []).map((x) => x.pokemon)))
    const drop = new Set(
      (league.rosters[playerId] ?? []).map((p) => p.pokemon).filter((id) => !kept.has(id)),
    )
    setSources({ ...sources, [side]: remaining })
    setTeam(side)({
      name: remaining.map((p) => people[p]?.name ?? p).join(' + '),
      members: team(side).members.filter((m) => !drop.has(m.id)),
    })
  }

  const clearSide = (side: Side) => {
    setSources({ ...sources, [side]: [] })
    setTeam(side)({ name: side === 'one' ? 'Team 1' : 'Team 2', members: [] })
  }

  return (
    <div className="builder">
      <div className="builder-columns">
        <div className="builder-sources">
        {/* ---- 1. a scheduled match ---- */}
        <section className="builder-col">
          <h3>From a scheduled match</h3>
          <p className="builder-hint">Fills both sides at once.</p>
          {league && league.schedule.length > 0 ? (
            <select
              value="" onChange={(e) => loadScheduledMatch(e.target.value)}
              aria-label="Load a scheduled match"
            >
              <option value="">Choose a week and match…</option>
              {[...new Set(league.schedule.map((m) => m.week))].sort((a, b) => a - b).map((week) => (
                <optgroup key={week} label={`Week ${week}`}>
                  {league.schedule.filter((m) => m.week === week).map((m, i) => {
                    const name = (ids: string[]) => ids.map((p) => people[p]?.name ?? p).join(' + ')
                    return (
                      <option key={i} value={`${week}:${i}`}>
                        {name(m.a)} vs {name(m.b)}
                        {m.scoreA !== null ? `  (${m.scoreA}–${m.scoreB})` : ''}
                      </option>
                    )
                  })}
                </optgroup>
              ))}
            </select>
          ) : (
            <p className="builder-empty">No schedule loaded.</p>
          )}
        </section>

        {/* ---- 2. drafted rosters, any number per side ---- */}
        <section className="builder-col">
          <h3>From drafted teams</h3>
          <p className="builder-hint">Add as many rosters as you like to each side.</p>
          {drafted.length ? (
            (['one', 'two'] as Side[]).map((side) => (
              <div key={side} className={`builder-side accent-${side}`}>
                <div className="builder-side-head">
                  <span>{side === 'one' ? 'Team 1' : 'Team 2'}</span>
                  {sources[side].length > 0 && (
                    <button type="button" className="link-btn" onClick={() => clearSide(side)}>Clear</button>
                  )}
                </div>
                <select
                  value="" onChange={(e) => addRoster(side, e.target.value)}
                  aria-label={`Add a roster to ${side === 'one' ? 'Team 1' : 'Team 2'}`}
                >
                  <option value="">Add a player…</option>
                  {drafted
                    .filter((p) => !sources[side].includes(p.id))
                    .map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
                </select>
                <ul className="source-chips">
                  {sources[side].map((p) => (
                    <li key={p}>
                      {people[p]?.name ?? p}
                      <button
                        type="button" onClick={() => removeRoster(side, p)}
                        aria-label={`Remove ${people[p]?.name ?? p}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="builder-empty">No drafted rosters loaded.</p>
          )}
        </section>

          <div className="builder-actions">
            <span className="builder-counts">
              {teamOne.members.length} vs {teamTwo.members.length} Pokémon
            </span>
            <button type="button" className="btn builder-done" disabled={!canAnalyze} onClick={onDone}>
              Done
            </button>
          </div>
        </div>

        {/* ---- 3. build by hand: both sides visible at once ---- */}
        <section className="builder-col builder-col-custom">
          <Widget footnote="Type a name and pick from the list, or paste a whole team.">
            <div className="custom-teams">
              {(['one', 'two'] as Side[]).map((side) => (
                <div key={side} className={`custom-team accent-${side}`}>
                  <h4>{side === 'one' ? 'Team 1' : 'Team 2'}</h4>
                  <TeamEditor
                    dex={dex}
                    team={team(side)}
                    onChange={setTeam(side)}
                    accent={side}
                    league={league}
                    showRosterPicker={false}
                  />
                </div>
              ))}
            </div>
          </Widget>
        </section>
      </div>
    </div>
  )
}
