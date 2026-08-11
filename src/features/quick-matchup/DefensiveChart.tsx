import { useMemo } from 'react'
import { spriteUrl } from '../../data/load'
import type { TypeChart } from '../../data/types'
import { BATTLE_TYPES, defensiveChart } from '../../lib/matchup'
import { TypeIconChip } from '../../components/TypeIcon'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { useFitToBox } from '../../lib/useFitToBox'

interface Props {
  team: Team
  chart: TypeChart
  useAbilities: boolean
}

/**
 * The three summary rows, drawn to the same square as the type chips and the
 * row sprites so the chart's left column and top row read as one set of tiles.
 * A cracked shield for what gets through, a whole one for what does not, and
 * the delta that literally is the difference between them.
 */
const SUMMARY_ROWS = [
  {
    key: 'weaks', label: 'Weak', tone: 'weak',
    path: 'M12 2l8.4 3.1v6.6c0 4.9-3.4 8.7-8.4 10.3-5-1.6-8.4-5.4-8.4-10.3V5.1L12 2zm-.6 3.6L6 7.6v4.1c0 3.2 2 5.9 5.4 7.3l-1.7-5 2.6-1.4-2.4-2.3 1.5-1.6-2.1-1.7 2.1-1.4zm1.2 0l1.9 2.4-2.2 1.5 2.4 2.2-2.7 1.5 1.9 5.4c3.4-1.4 5.5-4.1 5.5-7.4V7.6l-6.8-2z',
  },
  {
    key: 'resists', label: 'Resist', tone: 'resist',
    path: 'M12 2l8.4 3.1v6.6c0 4.9-3.4 8.7-8.4 10.3-5-1.6-8.4-5.4-8.4-10.3V5.1L12 2zm-1 13.6l5.9-5.9-1.7-1.7-4.2 4.2-2-2-1.7 1.7 3.7 3.7z',
  },
  {
    key: 'delta', label: 'Delta', tone: 'delta',
    path: 'M12 3.2L21.4 20.8H2.6L12 3.2zm0 4.9l-5.2 9.8h10.4L12 8.1z',
  },
] as const

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

  // Width only: all eighteen type columns stay on screen whatever the roster,
  // and a roster too tall for the card scrolls rather than shrinking the chart
  // until it cannot be read.
  const fitRef = useFitToBox<HTMLDivElement>('width')

  if (!rows.length) return null

  return (
    <div className="fit-box" ref={fitRef}>
        <table className="type-table">
          <thead>
            <tr>
              <th className="corner" />
              {/* Icons, not rotated words: eighteen columns of vertical text
                  cost 73px of header and still had to be read sideways. */}
              {BATTLE_TYPES.map((t) => (
                <th key={t} className="type-head"><TypeIconChip type={t} size={28} /></th>
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
            {SUMMARY_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="summary-cell">
                  <span className={`summary-chip tone-${row.tone}`} title={row.label}>
                    <svg viewBox="0 0 24 24" width="28" height="28" role="img" aria-label={row.label} focusable="false">
                      <title>{row.label}</title>
                      <path d={row.path} fill="currentColor" />
                    </svg>
                    <span className="summary-chip-label">{row.label}</span>
                  </span>
                </th>
                {BATTLE_TYPES.map((t) => {
                  const value = summary[row.key][t]
                  const tone = row.key === 'delta'
                    ? (value > 0 ? 'mx-resist' : value < 0 ? 'mx-weak' : '')
                    : value ? (row.key === 'weaks' ? 'mx-weak' : 'mx-resist') : ''
                  return <td key={t} className={tone}>{value}</td>
                })}
              </tr>
            ))}
          </tfoot>
      </table>
    </div>
  )
}
