import { useMemo, useState } from 'react'
import { spriteUrl } from '../../data/load'
import type { TypeChart } from '../../data/types'
import { BATTLE_TYPES, defensiveChart } from '../../lib/matchup'
import type { Team } from './TeamEditor'

interface Props {
  team: Team
  chart: TypeChart
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

export function DefensiveChart({ team, chart }: Props) {
  const [useAbilities, setUseAbilities] = useState(true)

  const { rows, summary } = useMemo(
    () => defensiveChart(chart, team.members, useAbilities),
    [chart, team.members, useAbilities],
  )

  if (!rows.length) return null

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Defensive Type Chart</h2>
        <label className="toggle">
          <input type="checkbox" checked={useAbilities} onChange={(e) => setUseAbilities(e.target.checked)} />
          <span>Abilities</span>
        </label>
      </header>

      <div className="table-scroll">
        <table className="type-table">
          <thead>
            <tr>
              <th className="corner" />
              {BATTLE_TYPES.map((t) => (
                <th key={t} className={`type-head type-${t.toLowerCase()}`}>{t.slice(0, 3)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="mon-cell">
                  <img src={spriteUrl(row.pokemon)} alt={row.pokemon.name} title={row.pokemon.name} width={40} height={32} />
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
      <p className="panel-note">
        Delta is resists minus weaknesses. Negative columns are types this team struggles to switch into.
      </p>
    </section>
  )
}
