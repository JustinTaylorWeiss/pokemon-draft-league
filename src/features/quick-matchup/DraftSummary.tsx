import { useMemo, useState } from 'react'
import { spriteUrl } from '../../data/load'
import type { StatKey } from '../../data/types'
import { BST_ORDER, STAT_LABELS, bulk, summarize } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import type { Team } from './TeamEditor'

/**
 * Colors a stat relative to the neutral value: below is red, above is green.
 * The scale saturates 60 points out from neutral so the extremes stay readable.
 */
function heat(value: number, neutral: number): string {
  const spread = Math.max(-1, Math.min(1, (value - neutral) / 60))
  const alpha = Math.abs(spread) * 0.55
  return spread >= 0
    ? `rgba(46, 160, 120, ${alpha.toFixed(3)})`
    : `rgba(200, 60, 70, ${alpha.toFixed(3)})`
}

export function DraftSummary({ team }: { team: Team }) {
  const [neutral, setNeutral] = useState(80)

  const rows = useMemo(
    () => [...team.members].sort((a, b) => b.pokemon.bst - a.pokemon.bst),
    [team.members],
  )

  const totals = useMemo(() => {
    const cols: Record<string, number[]> = {}
    for (const k of BST_ORDER) cols[k] = rows.map((r) => r.pokemon.baseStats[k])
    cols.bst = rows.map((r) => r.pokemon.bst)
    cols.pbulk = rows.map((r) => bulk(r.pokemon.baseStats).physical)
    cols.sbulk = rows.map((r) => bulk(r.pokemon.baseStats).special)
    return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, summarize(v)]))
  }, [rows])

  if (!rows.length) return null

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Draft Summary</h2>
        <label className="neutral-control">
          <span>Neutral</span>
          <input
            type="range" min={40} max={140} value={neutral}
            onChange={(e) => setNeutral(Number(e.target.value))}
          />
          <output>{neutral}</output>
        </label>
      </header>

      <div className="table-scroll">
        <table className="stat-table">
          <thead>
            <tr>
              <th className="col-name">Name</th>
              <th className="col-abil">Abilities</th>
              {BST_ORDER.map((k) => <th key={k}>{STAT_LABELS[k]}</th>)}
              <th>BST</th>
              <th title="HP x Def / 100">P.Bulk</th>
              <th title="HP x SpD / 100">S.Bulk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, pokemon }) => {
              const b = bulk(pokemon.baseStats)
              return (
                <tr key={id}>
                  <th scope="row" className="col-name">
                    <img src={spriteUrl(pokemon)} alt="" width={44} height={36} />
                    <span>
                      {pokemon.name}
                      <span className="row-types">
                        {pokemon.types.map((t) => <TypeChip key={t} type={t} />)}
                      </span>
                    </span>
                  </th>
                  <td className="col-abil">{Object.values(pokemon.abilities).join(', ')}</td>
                  {BST_ORDER.map((k: StatKey) => (
                    <td key={k} style={{ background: heat(pokemon.baseStats[k], neutral) }}>
                      {pokemon.baseStats[k]}
                    </td>
                  ))}
                  <td style={{ background: heat(pokemon.bst / 6, neutral) }}>{pokemon.bst}</td>
                  <td style={{ background: heat(b.physical, neutral) }}>{b.physical}</td>
                  <td style={{ background: heat(b.special, neutral) }}>{b.special}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            {(['average', 'median', 'max'] as const).map((agg) => (
              <tr key={agg}>
                <th scope="row" colSpan={2} className="agg-label">{agg}</th>
                {BST_ORDER.map((k) => (
                  <td key={k} style={{ background: heat(totals[k][agg], neutral) }}>{totals[k][agg]}</td>
                ))}
                <td style={{ background: heat(totals.bst[agg] / 6, neutral) }}>{totals.bst[agg]}</td>
                <td style={{ background: heat(totals.pbulk[agg], neutral) }}>{totals.pbulk[agg]}</td>
                <td style={{ background: heat(totals.sbulk[agg], neutral) }}>{totals.sbulk[agg]}</td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <p className="panel-note">
        Bulk columns are HP × the matching defense ÷ 100 — BST hides that HP multiplies with defenses instead of adding to them.
      </p>
    </section>
  )
}
