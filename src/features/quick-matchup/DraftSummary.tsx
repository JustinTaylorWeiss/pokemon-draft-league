import { useMemo } from 'react'
import { spriteUrl, toId } from '../../data/load'
import type { AbilityDex, StatKey } from '../../data/types'
import { BST_ORDER, STAT_LABELS, summarize } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { usePokemonModal } from '../pokemon/PokemonModalContext'
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
  { team, neutral, abilities }: {
    team: Team; neutral: number; abilities: AbilityDex | null
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

  // Any part of a row opens that Pokemon, not just its name and sprite.
  const { open } = usePokemonModal()

  // Every row matters at a glance, so the table shrinks to fit a short window
  // rather than hiding its tail behind a scrollbar.
  const fitRef = useFitToBox<HTMLDivElement>()

  if (!rows.length) return null

  return (
    <div className="fit-box fit-wide" ref={fitRef}>
    <table className="stat-table summary-table">
          <thead>
            <tr>
              <th className="col-name">Name</th>
              <th className="col-abil">Abilities</th>
              {BST_ORDER.map((k) => <th key={k}>{STAT_LABELS[k]}</th>)}
              <th>BST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, pokemon }) => {
              // Two at most: the cell is two lines tall and a third name would
              // push past it. The rest are counted rather than truncated, so it
              // is clear something was left out.
              const abilityNames = Object.values(pokemon.abilities)
              const shown = abilityNames.slice(0, 2)
              const extra = abilityNames.length - shown.length
              return (
                <tr key={id} className="row-link" onClick={() => open(id)}>
                  <th scope="row" className="col-name">
                    {/* An inner flex row, not a flex cell: making the `th`
                        itself a flex container drops it out of the table's
                        layout and it stops filling the row. */}
                    <span className="name-cell">
                      <PokemonLink id={id} title={pokemon.name}>
                        <img src={spriteUrl(pokemon)} alt="" width={44} height={36} />
                      </PokemonLink>
                      <span className="name-stack">
                        <PokemonLink id={id}>{pokemon.name}</PokemonLink>
                        <span className="row-types">
                          {pokemon.types.map((t) => <TypeChip key={t} type={t} />)}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td className="col-abil">
                    {/* Plain text: the description still shows on hover. */}
                    <span className="ability-lines">
                      {shown.map((name, i) => (
                        <span key={name} title={abilities?.[toId(name)]?.shortDesc || name}>
                          {i > 0 && ', '}{name}
                        </span>
                      ))}
                      {extra > 0 && <em className="ability-more">, +{extra} more</em>}
                    </span>
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
                <th scope="row" colSpan={2} className="agg-label">{agg}</th>
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
