import { useEffect, useMemo, useState } from 'react'
import { loadCore, loadLearnsets } from '../../data/load'
import type { AbilityDex, LearnsetDex, MoveDex, PokemonDex, TypeChart } from '../../data/types'
import { byId, loadLeague, mergeDex, type League } from '../../data/league'
import { TeamEditor, type Team, type TeamEntry } from './TeamEditor'
import { Overview } from './Overview'
import { DraftSummary } from './DraftSummary'
import { SpeedTiers } from './SpeedTiers'
import { DefensiveChart } from './DefensiveChart'
import { CoveragePanel } from './CoveragePanel'
import { LearnedMoves } from './LearnedMoves'
import './quick-matchup.css'

type Step = 'team1' | 'team2' | 'results'

interface Core {
  pokemon: PokemonDex
  moves: MoveDex
  abilities: AbilityDex
  typechart: TypeChart
}

const STORAGE_KEY = 'quick-matchup:teams'
const emptyTeam = (name: string): Team => ({ name, members: [] })

/** Only ids are persisted; the dex is re-joined on load so data updates apply. */
function saveTeams(one: Team, two: Team) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      one: { name: one.name, ids: one.members.map((m) => m.id) },
      two: { name: two.name, ids: two.members.map((m) => m.id) },
    }))
  } catch { /* private browsing — not worth surfacing */ }
}

function restoreTeams(dex: PokemonDex): { one: Team; two: Team } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const hydrate = (t: { name: string; ids: string[] }): Team => ({
      name: t.name ?? '',
      members: (t.ids ?? []).filter((id) => dex[id]).map((id) => ({ id, pokemon: dex[id] })),
    })
    return { one: hydrate(parsed.one), two: hydrate(parsed.two) }
  } catch {
    return null
  }
}

export function QuickMatchup() {
  const [core, setCore] = useState<Core | null>(null)
  const [learnsets, setLearnsets] = useState<LearnsetDex | null>(null)
  const [league, setLeague] = useState<League | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('team1')
  const [teamOne, setTeamOne] = useState<Team>(() => emptyTeam('Team 1'))
  const [teamTwo, setTeamTwo] = useState<Team>(() => emptyTeam('Team 2'))
  const [perspective, setPerspective] = useState<'one' | 'two'>('one')

  useEffect(() => {
    loadCore().then((c) => {
      setCore(c)
      const saved = restoreTeams(c.pokemon)
      if (!saved) return
      setTeamOne(saved.one)
      setTeamTwo(saved.two)
      // Both sides already filled means the last visit got as far as the
      // analysis; go straight back to it instead of re-walking the wizard.
      if (saved.one.members.length && saved.two.members.length) setStep('results')
    }, (err: Error) => setError(err.message))
  }, [])

  // Learnsets are the largest file, so they load in the background rather than
  // blocking the team builder that does not need them.
  useEffect(() => { loadLearnsets().then(setLearnsets, () => {}) }, [])

  // The league sheet is optional: the tool still works as a scratch pad if the
  // import has not been run.
  useEffect(() => { loadLeague().then(setLeague, () => {}) }, [])

  useEffect(() => { if (core) saveTeams(teamOne, teamTwo) }, [core, teamOne, teamTwo])

  /**
   * The spreadsheet outranks the Showdown dataset, so every panel reads from
   * this merged view rather than the raw dex.
   */
  const dex = useMemo(
    () => (core ? mergeDex(core.pokemon, league) : null),
    [core, league],
  )

  // Teams restored from storage were built against the raw dex. Re-point them
  // at the merged one when it arrives so sheet stats and names take effect.
  useEffect(() => {
    if (!dex) return
    const rehydrate = (t: Team): Team => ({
      ...t,
      members: t.members.map((m) => (dex[m.id] ? { id: m.id, pokemon: dex[m.id] } : m)),
    })
    setTeamOne(rehydrate)
    setTeamTwo(rehydrate)
  }, [dex])

  const canSubmit = teamOne.members.length > 0 && teamTwo.members.length > 0

  const [analyzed, other] = useMemo(
    () => (perspective === 'one' ? [teamOne, teamTwo] : [teamTwo, teamOne]),
    [perspective, teamOne, teamTwo],
  )

  if (error) return <p className="error">Could not load data: {error}</p>
  if (!core || !dex) return <p className="loading">Loading dex…</p>

  /**
   * A scheduled match is 2v2 partners, so each side is two players' rosters
   * pooled into one 14-Pokémon team — that is the pool the pair can actually
   * bring, and it is what the panels should analyze.
   */
  const loadScheduledMatch = (key: string) => {
    if (!league || !dex || !key) return
    const [week, idx] = key.split(':').map(Number)
    const m = league.schedule.filter((x) => x.week === week)[idx]
    if (!m) return
    const people = byId(league.players)
    const side = (ids: string[]): Team => {
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
    setTeamOne(side(m.a))
    setTeamTwo(side(m.b))
    setStep('results')
  }

  if (step !== 'results') {
    return (
      <div className="wizard">
        {league && league.schedule.length > 0 && (
          <label className="field schedule-picker">
            <span>Load a scheduled match</span>
            <select value="" onChange={(e) => loadScheduledMatch(e.target.value)}>
              <option value="">Choose a week and match…</option>
              {Array.from(new Set(league.schedule.map((m) => m.week))).sort((a, b) => a - b).map((week) => (
                <optgroup key={week} label={`Week ${week}`}>
                  {league.schedule.filter((m) => m.week === week).map((m, i) => {
                    const people = byId(league.players)
                    const label = (ids: string[]) => ids.map((p) => people[p]?.name ?? p).join(' + ')
                    return (
                      <option key={i} value={`${week}:${i}`}>
                        {label(m.a)} vs {label(m.b)}
                        {m.scoreA !== null ? `  (${m.scoreA}–${m.scoreB})` : ''}
                      </option>
                    )
                  })}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        <ol className="steps">
          <li className={step === 'team1' ? 'is-current' : 'is-done'}>
            <button type="button" onClick={() => setStep('team1')}>1. {teamOne.name || 'Team 1'}</button>
          </li>
          <li className={step === 'team2' ? 'is-current' : ''}>
            <button type="button" onClick={() => setStep('team2')} disabled={!teamOne.members.length}>
              2. {teamTwo.name || 'Team 2'}
            </button>
          </li>
        </ol>

        {step === 'team1' ? (
          <TeamEditor dex={dex} team={teamOne} onChange={setTeamOne} accent="one" league={league} />
        ) : (
          <TeamEditor dex={dex} team={teamTwo} onChange={setTeamTwo} accent="two" league={league} />
        )}

        <div className="wizard-actions">
          {step === 'team2' && (
            <button type="button" className="btn ghost" onClick={() => setStep('team1')}>Back</button>
          )}
          {step === 'team1' ? (
            <button
              type="button" className="btn" disabled={!teamOne.members.length}
              onClick={() => setStep('team2')}
            >
              Next
            </button>
          ) : (
            <button type="button" className="btn" disabled={!canSubmit} onClick={() => setStep('results')}>
              Analyze matchup
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="results">
      <div className="matchup-title">
        <button type="button" className="btn ghost sm edit-teams" onClick={() => setStep('team1')}>Edit</button>
        <h2>Quick Matchup</h2>
        <dl className="matchup-meta">
          <div><dt>Ruleset</dt><dd>{league?.meta.regulation ? `Gen 9 Reg ${league.meta.regulation.replace(/\s*\(.*$/, '')}` : 'Gen 9'}</dd></div>
          <div><dt>Format</dt><dd>{league?.meta.format?.replace(/\s*\(.*$/, '') ?? 'Singles'}</dd></div>
        </dl>
        <div className="perspective">
          <span>Analyzing</span>
          <div className="segmented">
            <button
              type="button" className={perspective === 'one' ? 'is-active' : ''}
              onClick={() => setPerspective('one')}
            >
              {teamOne.name || 'Team 1'}
            </button>
            <button
              type="button" className={perspective === 'two' ? 'is-active' : ''}
              onClick={() => setPerspective('two')}
            >
              {teamTwo.name || 'Team 2'}
            </button>
          </div>
        </div>
      </div>

      {/* Widgets carry their own intrinsic width and this container packs them,
          so the page reads as an uneven two-up grid the way DraftZone's does. */}
      <div className="matchup-container">
        <Overview teamOne={teamOne} teamTwo={teamTwo} />
        <DraftSummary team={analyzed} />
        <SpeedTiers teamOne={teamOne} teamTwo={teamTwo} />
        <DefensiveChart team={analyzed} chart={core.typechart} />

        {learnsets ? (
          <>
            <LearnedMoves team={analyzed} moves={core.moves} learnsets={learnsets} />
            <CoveragePanel
              attackers={analyzed} defenders={other}
              chart={core.typechart} moves={core.moves} learnsets={learnsets}
            />
          </>
        ) : (
          <p className="loading">Loading learnsets…</p>
        )}
      </div>
    </div>
  )
}
