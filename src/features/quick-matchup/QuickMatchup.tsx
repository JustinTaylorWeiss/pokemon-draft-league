import { useEffect, useMemo, useState } from 'react'
import { loadCore, loadLearnsets } from '../../data/load'
import type { AbilityDex, LearnsetDex, MoveDex, PokemonDex, TypeChart } from '../../data/types'
import { loadLeague, mergeDex, subscribeLeague, type League } from '../../data/league'
import type { Team } from './TeamEditor'
import { MatchupBuilder } from './MatchupBuilder'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { TeamsAndSpeed } from './TeamsAndSpeed'
import { AnalysisCard } from './AnalysisCard'
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
  // Matches the breakpoint the stylesheet stacks the cards at. Below it there
  // is only one column, so the speed tiers move into the analysis card and the
  // teams card — roster list and all — is dropped rather than stacked.
  const singleColumn = useMediaQuery('(max-width: 1175px)')

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
  useEffect(() => {
    loadLeague().then(setLeague, () => {})
    return subscribeLeague(setLeague)
  }, [])

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

  const [analyzed, other] = useMemo(
    () => (perspective === 'one' ? [teamOne, teamTwo] : [teamTwo, teamOne]),
    [perspective, teamOne, teamTwo],
  )

  if (error) return <p className="error">Could not load data: {error}</p>
  if (!core || !dex) return <p className="loading">Loading dex…</p>

  if (step !== 'results') {
    return (
      <MatchupBuilder
        dex={dex}
        league={league}
        teamOne={teamOne}
        teamTwo={teamTwo}
        setTeamOne={setTeamOne}
        setTeamTwo={setTeamTwo}
        onDone={() => setStep('results')}
      />
    )
  }

  return (
    <div className={`results${perspective === 'two' ? ' viewing-two' : ''}`}>
      {/* Its own bar under the main nav, matching the League Sheet's. */}
      <div className="subbar subbar-bleed">
        <div className="bar-inner matchup-bar">
          <button type="button" className="btn ghost sm" onClick={() => setStep('team1')}>Edit</button>
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
      </div>

      {/* Widgets carry their own intrinsic width and this container packs them,
          so the page reads as an uneven two-up grid the way DraftZone's does. */}
      <div className="matchup-container">
        {!singleColumn && <TeamsAndSpeed teamOne={teamOne} teamTwo={teamTwo} />}

        <AnalysisCard
          analyzed={analyzed} other={other}
          chart={core.typechart} moves={core.moves} learnsets={learnsets}
          teamOne={teamOne} teamTwo={teamTwo} hostSpeedTiers={singleColumn}
        />
      </div>
    </div>
  )
}
