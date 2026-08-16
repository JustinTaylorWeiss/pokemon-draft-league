import { statAt100 } from '../../lib/stats'
import { TeamName } from '../../components/TeamName'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { Sprite } from '../../components/Sprite'

/**
 * The two rosters side by side, sorted fastest first. The right column is
 * mirrored — speed, name, sprite — so both teams read outward from the centre,
 * matching DraftZone's overview.
 */
export function TeamsBody({ teamOne, teamTwo }: { teamOne: Team; teamTwo: Team }) {
  return (
    <div className="overview-wrapper">
      <TeamColumn team={teamOne} side="one" />
      <TeamColumn team={teamTwo} side="two" alternate />
    </div>
  )
}

function TeamColumn({ team, side, alternate }: { team: Team; side: 'one' | 'two'; alternate?: boolean }) {
  const rows = [...team.members].sort(
    (a, b) => b.pokemon.baseStats.spe - a.pokemon.baseStats.spe,
  )

  return (
    <div className={`team-container accent-${side}${alternate ? ' alternate' : ''}`}>
      <div className="team-name-title">
        <TeamName name={team.name || (side === 'one' ? 'Team 1' : 'Team 2')} />
      </div>
      <div className="team-body">
        <div className="overview-row header">
          <span className="sprite-cell" />
          <span className="name-cell">Name</span>
          <span className="speed-cell">SPE</span>
        </div>
        {rows.map((m) => (
          <div key={m.id} className="overview-row">
            <span className="sprite-cell">
              <PokemonLink id={m.id} title={m.pokemon.name}>
                <Sprite pokemon={m.pokemon} width={46} height={40} />
              </PokemonLink>
            </span>
            <span className="name-cell" title={m.pokemon.name}>
              <PokemonLink id={m.id}>{m.pokemon.name}</PokemonLink>
            </span>
            <span className="speed-cell" title="Speed at Lv 100, 252 EVs, neutral nature">
              {statAt100(m.pokemon.baseStats.spe)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
