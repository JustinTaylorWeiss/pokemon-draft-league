import { statAtLevel } from '../../lib/stats'
import { TeamName } from '../../components/TeamName'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { Sprite } from '../../components/Sprite'

/**
 * The two rosters side by side, sorted fastest first. The right column is
 * mirrored — speed, name, sprite — so both teams read outward from the centre,
 * matching DraftZone's overview.
 *
 * The speed follows the level the rest of the panel is read at rather than
 * being fixed at 100: this sits beside three columns of tiers that move with
 * that picker, and a column that did not move with them was the one number on
 * the tab that meant something else.
 */
export function TeamsBody({ teamOne, teamTwo, level, solo }: {
  teamOne: Team
  teamTwo: Team
  /** 50 for VGC, 100 for singles ladders — the panel's own picker. */
  level: number
  /** One team on its own: the second column would be an empty half. */
  solo?: boolean
}) {
  return (
    <div className={`overview-wrapper${solo ? ' is-solo' : ''}`}>
      <TeamColumn team={teamOne} side="one" level={level} />
      {!solo && <TeamColumn team={teamTwo} side="two" level={level} alternate />}
    </div>
  )
}

function TeamColumn({ team, side, level, alternate }: {
  team: Team
  side: 'one' | 'two'
  level: number
  alternate?: boolean
}) {
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
            <span className="speed-cell" title={`Speed at Lv ${level}, 252 EVs, neutral nature`}>
              {statAtLevel(m.pokemon.baseStats.spe, 252, 1, false, 31, level)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
