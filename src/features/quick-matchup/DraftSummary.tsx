import { useMemo } from 'react'
import { spriteUrl, toId } from '../../data/load'
import type { AbilityDex, StatKey } from '../../data/types'
import { BST_ORDER, STAT_LABELS, summarize } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { useFitToBox } from '../../lib/useFitToBox'

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

/** `neutral` is owned by the parent card so the slider can live in its header. */
export function DraftSummaryBody(
  { team, neutral, abilities, zoom }: {
    team: Team; neutral: number; abilities: AbilityDex | null; zoom: number
  },
) {

  const rows = useMemo(
    () => [...team.members].sort((a, b) => b.pokemon.bst - a.pokemon.bst),
    [team.members],
  )

  const totals = useMemo(() => {
    const cols: Record<string, number[]> = {}
    for (const k of BST_ORDER) cols[k] = rows.map((r) => r.pokemon.baseStats[k])
    cols.bst = rows.map((r) => r.pokemon.bst)
    return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, summarize(v)]))
  }, [rows])

  // Every row matters at a glance, so the table shrinks to fit a short window
  // rather than hiding its tail behind a scrollbar.
  const fitRef = useFitToBox<HTMLDivElement>(zoom)

  if (!rows.length) return null

  return (
    <div className="fit-box" ref={fitRef}>
    <table className="stat-table summary-table">
          <thead>
            <tr>
              <th className="col-name">Name</th>
              <th className="col-types">Types</th>
              <th className="col-abil">Abilities</th>
              {BST_ORDER.map((k) => <th key={k}>{STAT_LABELS[k]}</th>)}
              <th>BST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, pokemon }) => {
              return (
                <tr key={id}>
                  <th scope="row" className="col-name">
                    <PokemonLink id={id} title={pokemon.name}>
                      <img src={spriteUrl(pokemon)} alt="" width={44} height={36} />
                    </PokemonLink>
                    <span>
                      <PokemonLink id={id}>{pokemon.name}</PokemonLink>
                    </span>
                  </th>
                  <td className="col-types">
                    {pokemon.types.map((t) => <TypeChip key={t} type={t} />)}
                  </td>
                  <td className="col-abil">
                    {/* Plain text: the description still shows on hover. */}
                    {Object.values(pokemon.abilities).map((name, i) => (
                      <span key={name} title={abilities?.[toId(name)]?.shortDesc || name}>
                        {i > 0 && ', '}{name}
                      </span>
                    ))}
                  </td>
                  {BST_ORDER.map((k: StatKey) => (
                    <td key={k} style={{ background: heat(pokemon.baseStats[k], neutral) }}>
                      {pokemon.baseStats[k]}
                    </td>
                  ))}
                  <td style={{ background: heat(pokemon.bst / 6, neutral) }}>{pokemon.bst}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            {(['average', 'median', 'max'] as const).map((agg) => (
              <tr key={agg}>
                <th scope="row" colSpan={3} className="agg-label">{agg}</th>
                {BST_ORDER.map((k) => (
                  <td key={k} style={{ background: heat(totals[k][agg], neutral) }}>{totals[k][agg]}</td>
                ))}
                <td style={{ background: heat(totals.bst[agg] / 6, neutral) }}>{totals.bst[agg]}</td>
              </tr>
            ))}
          </tfoot>
    </table>
    </div>
  )
}
