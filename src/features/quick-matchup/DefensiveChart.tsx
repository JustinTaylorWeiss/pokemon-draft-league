import { useMemo } from 'react'
import { spriteUrl } from '../../data/load'
import type { TypeChart } from '../../data/types'
import { BATTLE_TYPES, defensiveChart } from '../../lib/matchup'
import { TypeIconChip } from '../../components/TypeIcon'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { useFitToBox } from '../../lib/useFitToBox'
import { useFillHeight } from '../../lib/useFillHeight'

interface Props {
  team: Team
  chart: TypeChart
  useAbilities: boolean
}

/** Blank for neutral so the eye only catches the cells that matter. */
function cellClass(mult: number): string {
  if (mult === 0) return 'mx-immune'
  if (mult < 0.5) return 'mx-strong-resist'
  if (mult < 1) return 'mx-resist'
  if (mult === 1) return 'mx-neutral'
  if (mult <= 2) return 'mx-weak'
  return 'mx-strong-weak'
}

const label = (m: number) => (m === 1 ? '' : m === 0 ? '0' : String(m))

/** The Abilities toggle is owned by the parent card's header. */
export function DefensiveChartBody({ team, chart, useAbilities }: Props) {

  const { rows, summary } = useMemo(
    () => defensiveChart(chart, team.members, useAbilities),
    [chart, team.members, useAbilities],
  )

  const fitRef = useFitToBox<HTMLDivElement>()
  // Eighteen columns make this chart width-bound, so scaling it to fit leaves
  // height on the table. The row sprites grow to take it.
  const [fillRef, cellSize] = useFillHeight<HTMLDivElement>(rows.length)

  if (!rows.length) return null

  return (
    <div
      className="fit-box" ref={fitRef}
      style={{ ['--mon-cell' as string]: `${cellSize}px` }}
    >
        <table className="type-table" ref={fillRef}>
          <thead>
            <tr>
              <th className="corner" />
              {/* Icons, not rotated words: eighteen columns of vertical text
                  cost 73px of header and still had to be read sideways. */}
              {BATTLE_TYPES.map((t) => (
                <th key={t} className="type-head"><TypeIconChip type={t} size={18} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="mon-cell">
                  <PokemonLink id={row.id} title={row.pokemon.name}>
                    <img src={spriteUrl(row.pokemon)} alt={row.pokemon.name} width={40} height={32} />
                  </PokemonLink>
                </th>
                {BATTLE_TYPES.map((t) => (
                  <td key={t} className={cellClass(row.multipliers[t])}>{label(row.multipliers[t])}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Weak</th>
              {BATTLE_TYPES.map((t) => (
                <td key={t} className={summary.weaks[t] ? 'mx-weak' : ''}>{summary.weaks[t]}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Resist</th>
              {BATTLE_TYPES.map((t) => (
                <td key={t} className={summary.resists[t] ? 'mx-resist' : ''}>{summary.resists[t]}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Delta</th>
              {BATTLE_TYPES.map((t) => (
                <td
                  key={t}
                  className={summary.delta[t] > 0 ? 'mx-resist' : summary.delta[t] < 0 ? 'mx-weak' : ''}
                >
                  {summary.delta[t]}
                </td>
              ))}
            </tr>
          </tfoot>
      </table>
    </div>
  )
}
