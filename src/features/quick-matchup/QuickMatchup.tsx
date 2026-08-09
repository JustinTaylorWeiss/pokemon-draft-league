import { useEffect, useMemo, useState } from 'react'
import { loadCore, loadLearnsets, spriteUrl } from '../../data/load'
import type { AbilityDex, LearnsetDex, MoveDex, PokemonDex, TypeChart } from '../../data/types'
import { statAt100 } from '../../lib/stats'
import { TeamEditor, type Team } from './TeamEditor'
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
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('team1')
  const [teamOne, setTeamOne] = useState<Team>(() => emptyTeam('Team 1'))
  const [teamTwo, setTeamTwo] = useState<Team>(() => emptyTeam('Team 2'))
  const [perspective, setPerspective] = useState<'one' | 'two'>('one')

  useEffect(() => {
    loadCore().then((c) => {
      setCore(c)
      const saved = restoreTeams(c.pokemon)
      if (saved) { setTeamOne(saved.one); setTeamTwo(saved.two) }
    }, (err: Error) => setError(err.message))
  }, [])

  // Learnsets are the largest file, so they load in the background rather than
  // blocking the team builder that does not need them.
  useEffect(() => { loadLearnsets().then(setLearnsets, () => {}) }, [])

  useEffect(() => { if (core) saveTeams(teamOne, teamTwo) }, [core, teamOne, teamTwo])

  const canSubmit = teamOne.members.length > 0 && teamTwo.members.length > 0

  const [analyzed, other] = useMemo(
    () => (perspective === 'one' ? [teamOne, teamTwo] : [teamTwo, teamOne]),
    [perspective, teamOne, teamTwo],
  )

  if (error) return <p className="error">Could not load data: {error}</p>
  if (!core) return <p className="loading">Loading dex…</p>

  if (step !== 'results') {
    return (
      <div className="wizard">
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
          <TeamEditor dex={core.pokemon} team={teamOne} onChange={setTeamOne} accent="one" />
        ) : (
          <TeamEditor dex={core.pokemon} team={teamTwo} onChange={setTeamTwo} accent="two" />
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
      <div className="results-head">
        <button type="button" className="btn ghost sm" onClick={() => setStep('team1')}>Edit teams</button>
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

      <section className="panel rosters">
        {[teamOne, teamTwo].map((t, i) => (
          <div key={i} className={`roster-col accent-${i === 0 ? 'one' : 'two'}`}>
            <h3>{t.name || `Team ${i + 1}`}</h3>
            <ul>
              {[...t.members]
                .sort((a, b) => b.pokemon.baseStats.spe - a.pokemon.baseStats.spe)
                .map((m) => (
                  <li key={m.id}>
                    <img src={spriteUrl(m.pokemon)} alt="" width={44} height={36} />
                    <span>{m.pokemon.name}</span>
                    <strong title="Speed at Lv 100, 252 EVs, neutral nature">
                      {statAt100(m.pokemon.baseStats.spe)}
                    </strong>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <DraftSummary team={analyzed} />
      <SpeedTiers teamOne={teamOne} teamTwo={teamTwo} />
      <DefensiveChart team={analyzed} chart={core.typechart} />

      {learnsets ? (
        <>
          <CoveragePanel
            attackers={analyzed} defenders={other}
            chart={core.typechart} moves={core.moves} learnsets={learnsets}
          />
          <LearnedMoves team={analyzed} moves={core.moves} learnsets={learnsets} />
        </>
      ) : (
        <p className="loading">Loading learnsets…</p>
      )}
    </div>
  )
}
